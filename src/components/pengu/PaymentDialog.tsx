"use client";

/**
 * PaymentDialog — pay a product price in PENGU (ERC-20) or ETH (native) and
 * have the server verify it on-chain (target plan §7 — generic token registry).
 *
 * Steps (all user-visible):
 *  1. summary: product, price, token selector, treasury, wallet balances
 *  2. "Pay from wallet" →
 *       PENGU: ERC-20 `transfer(treasury, amount)` via wagmi
 *       ETH  : native `sendTransaction` with the SIGNED QUOTE amount
 *  3. after the tx hash exists (receipt pending is fine) it is auto-filled
 *  4. "Verify & activate" → POST /api/payment/verify (server-side RPC check;
 *     non-PENGU payments include the signed quote)
 *  5. success → session refresh (entitlements update reactively)
 *
 * Security: the client never claims anything — it only submits a tx hash;
 * verification happens entirely server-side against the Abstract RPC.
 *
 * @module components/pengu/PaymentDialog
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useBalance, useWriteContract, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, parseUnits, formatUnits } from "viem";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { authFetch } from "@/lib/client-session";
import { publicConfig, formatPengu } from "@/lib/public-config";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaymentProduct {
  id: string;
  name: string;
  pricePengu: number;
}

interface Props {
  product: PaymentProduct | null;
  onClose: () => void;
}

type Phase = "idle" | "sending" | "sent" | "verifying" | "success";
type TokenKey = "PENGU" | "ETH";

interface PaymentConfig {
  tokens: { key: TokenKey; kind: "erc20" | "native"; address: string | null; decimals: number; symbol: string }[];
  quotes: Record<string, Record<string, { amountToken: number; quote: unknown }>>;
}

/** Classify a failed wallet send (AGW popup semantics + RPC errors). */
function classifySendError(err: unknown): string {
  const raw = String(err?.toString?.() ?? err ?? "");
  if (raw.includes("UserRejected") || raw.includes("User rejected")) return "rejected";
  // AGW cross-app-connect: window.open returned null (popup blocker)
  if (
    raw.includes("Failed to initialize request") ||
    (raw.includes("popup") && raw.includes("blocked"))
  ) {
    return "popup_blocked";
  }
  if (raw.includes("Request timeout") || raw.includes("timed out")) return "timeout";
  // agw-client 1.7.2+ throws an explicit insufficient-balance error; the
  // node reports "insufficient funds for gas" when ETH is missing.
  if (raw.toLowerCase().includes("insufficient")) return "insufficient_balance";
  return "send_failed";
}

/** Format a native ETH balance (18 decimals) for compact display. */
function formatEth(raw: bigint | undefined | null): string {
  if (raw === null || raw === undefined) return "—";
  return (Number(raw) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 5 });
}

export function PaymentDialog({ product, onClose }: Props) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState("");
  const [manualHash, setManualHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  // "already paid" path: reveal the manual tx-hash input without sending
  // from this browser (e.g. the user transferred from the Abstract Portal).
  const [showManual, setShowManual] = useState(false);
  // token selector (target plan §7) — PENGU default, ETH optional
  const [tokenKey, setTokenKey] = useState<TokenKey>("PENGU");
  const [config, setConfig] = useState<PaymentConfig | null>(null);

  // fetch payment config (token registry + signed quotes) when a product opens
  useEffect(() => {
    if (!product) return;
    setTokenKey("PENGU");
    setConfig(null);
    fetch("/api/payment/config")
      .then((r) => r.json())
      .then((d) => setConfig(d.ok ? d : null))
      .catch(() => setConfig(null));
  }, [product]);

  const ethQuote = useMemo(() => {
    if (!product || !config) return null;
    return config.quotes?.[product.id]?.ETH ?? null;
  }, [product, config]);

  const { data: penguBalance } = useBalance({
    address,
    token: publicConfig.penguToken,
    chainId: publicConfig.chainId,
  });

  // Native ETH balance — used for payment (native path) AND gas (ERC-20 path):
  // plain ERC-20 transfers are NOT gas-sponsored on Abstract.
  const { data: ethBalance } = useBalance({
    address,
    chainId: publicConfig.chainId,
  });
  const lowGas = ethBalance !== undefined && ethBalance.value <= 0n;

  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({
    hash: (txHash || undefined) as `0x${string}` | undefined,
    chainId: publicConfig.chainId,
    query: { enabled: !!txHash },
  });

  // required amount for the selected token
  const required = useMemo(() => {
    if (!product) return null;
    if (tokenKey === "PENGU") return { amount: product.pricePengu, symbol: "PENGU" };
    if (ethQuote) return { amount: ethQuote.amountToken, symbol: "ETH" };
    return null;
  }, [product, tokenKey, ethQuote]);

  const activeBalance = tokenKey === "PENGU" ? penguBalance?.value : ethBalance?.value;
  const balanceOk = useMemo(() => {
    if (!required || activeBalance === undefined) return true;
    const decimals = tokenKey === "PENGU" ? 18 : 18;
    return activeBalance >= parseUnits(String(required.amount), decimals);
  }, [activeBalance, required, tokenKey]);

  /** Trigger the payment from the connected wallet (ERC-20 or native). */
  const pay = useCallback(async () => {
    if (!product || !required) return;
    setPhase("sending");
    setError(null);
    try {
      let hash: `0x${string}`;
      if (tokenKey === "PENGU") {
        hash = await writeContractAsync({
          address: publicConfig.penguToken,
          abi: erc20Abi,
          functionName: "transfer",
          args: [publicConfig.treasury, parseUnits(String(product.pricePengu), 18)],
          chainId: publicConfig.chainId,
        });
      } else {
        if (!ethQuote) throw new Error("NO_ETH_QUOTE");
        hash = await sendTransactionAsync({
          to: publicConfig.treasury,
          value: parseUnits(String(ethQuote.amountToken), 18),
          chainId: publicConfig.chainId,
        });
      }
      setTxHash(hash);
      setPhase("sent");
    } catch (err) {
      setPhase("idle");
      setError(classifySendError(err));
    }
  }, [product, required, tokenKey, ethQuote, writeContractAsync, sendTransactionAsync]);

  /** Ask the server to verify the tx and mint the entitlement. */
  const verify = useCallback(
    async (hash: string) => {
      if (!product || !hash) return;
      setPhase("verifying");
      setError(null);
      try {
        const body: Record<string, unknown> = { txHash: hash, product: product.id };
        if (tokenKey !== "PENGU" && ethQuote) body.quote = ethQuote.quote;
        const res = await authFetch("/api/payment/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
          setPhase("success");
          await refresh();
        } else {
          // wallet-sent tx keeps the step-2 UI; a manual-pasted hash that
          // failed returns to the manual entry state (phase stays "idle")
          setPhase(txHash && txHash === hash ? "sent" : "idle");
          setShowManual(!txHash || txHash !== hash);
          setError(data.error ?? "VERIFY_FAILED");
        }
      } catch {
        setPhase(txHash ? "sent" : "idle");
        setShowManual(!txHash);
        setError("NETWORK");
      }
    },
    [product, refresh, txHash, tokenKey, ethQuote],
  );

  /**
   * Auto-verify once the receipt lands on-chain with status success —
   * the user should not have to click "Verify" manually when the chain
   * has already confirmed the transfer. Manual verify stays available
   * as a fallback (e.g. for hashes pasted from an external wallet).
   */
  const autoVerified = useRef<string | null>(null);
  useEffect(() => {
    if (
      receipt.data?.status === "success" &&
      txHash &&
      phase === "sent" &&
      autoVerified.current !== txHash
    ) {
      autoVerified.current = txHash;
      void verify(txHash);
    }
  }, [receipt.data, txHash, phase, verify]);

  const explorerTx = (hash: string) => `${publicConfig.explorerUrl}/tx/${hash}`;

  if (!product) return null;

  const tokens: TokenKey[] = (config?.tokens ?? [{ key: "PENGU" } as { key: TokenKey }])
    .map((x) => x.key)
    .filter((k) => k === "PENGU" || k === "ETH");

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-card max-w-md border-border/70 sm:max-w-lg" dir="auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-extrabold">
            <Wallet className="size-5 text-primary" />
            {t("payment.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("payment.payFromConnected", { address: `${address?.slice(0, 8)}…${address?.slice(-6)}` })}
          </DialogDescription>
        </DialogHeader>

        {phase !== "success" ? (
          <div className="space-y-4">
            {/* summary */}
            <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/30 p-4">
              <Row label={t("payment.product")} value={<span className="font-bold">{product.name}</span>} />
              <Row
                label={t("payment.amount")}
                value={
                  required ? (
                    <span className="font-mono font-black text-primary" dir="ltr">
                      {required.amount} {required.symbol}
                    </span>
                  ) : (
                    <span className="font-mono font-black text-primary">{product.pricePengu} PENGU</span>
                  )
                }
              />
              {/* token selector (plan §7) */}
              {tokens.length > 1 && phase === "idle" && (
                <Row
                  label={t("payment.payWith")}
                  value={
                    <span className="inline-flex overflow-hidden rounded-lg border border-border/60" role="group">
                      {tokens.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setTokenKey(k)}
                          disabled={k === "ETH" && !ethQuote}
                          className={cn(
                            "px-3 py-1 text-xs font-bold transition-colors",
                            tokenKey === k
                              ? "bg-primary text-primary-foreground"
                              : "bg-transparent text-muted-foreground hover:bg-muted",
                            k === "ETH" && !ethQuote && "cursor-not-allowed opacity-40",
                          )}
                        >
                          {k === "PENGU" ? "PENGU" : "ETH"}
                        </button>
                      ))}
                    </span>
                  }
                />
              )}
              {tokenKey === "ETH" && ethQuote && (
                <p className="text-[10px] leading-5 text-muted-foreground">
                  ≈ {product.pricePengu} PENGU · {t("payment.quoteNote")}
                </p>
              )}
              <Row
                label={t("payment.balance")}
                value={
                  <span className={cn("font-mono text-sm", balanceOk ? "text-buy" : "text-sell")}>
                    {tokenKey === "PENGU"
                      ? `${formatPengu(penguBalance?.value)} PENGU`
                      : `${formatEth(ethBalance?.value)} ETH`}
                    {!balanceOk && ` — ${t("payment.insufficient")}`}
                  </span>
                }
              />
              <Row
                label={t("payment.sendTo")}
                value={
                  <button
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard?.writeText(publicConfig.treasury)}
                    title={publicConfig.treasury}
                  >
                    {publicConfig.treasury.slice(0, 10)}…{publicConfig.treasury.slice(-8)}
                    <Copy className="size-3" />
                  </button>
                }
              />
              <Row
                label={t("payment.gasLabel")}
                value={
                  <span
                    className={cn("font-mono text-sm", lowGas ? "text-sell" : "text-muted-foreground")}
                    dir="ltr"
                    title={t("payment.gasHint")}
                  >
                    {formatEth(ethBalance?.value)} ETH
                  </span>
                }
              />
              {lowGas && (
                <p className="text-[11px] font-semibold leading-5 text-sell">
                  ⚠ {t("payment.noGas")}
                </p>
              )}
            </div>

            {/* step 1: pay */}
            <Button
              onClick={pay}
              disabled={phase === "sending" || phase === "sent" || !balanceOk || !required}
              className="w-full gap-2 text-base font-bold"
              size="lg"
            >
              {phase === "sending" ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  {t("payment.waiting")}
                </>
              ) : (
                <>
                  <Wallet className="size-5" />
                  {t("payment.payNow")} — {required ? `${required.amount} ${required.symbol}` : `${product.pricePengu} PENGU`}
                </>
              )}
            </Button>

            {/* already-paid path: paste a tx hash sent from anywhere */}
            {phase === "idle" && !showManual && (
              <button
                type="button"
                onClick={() => setShowManual(true)}
                className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("payment.alreadyPaid")}
              </button>
            )}
            {phase === "idle" && showManual && (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">{t("payment.txHashLabel")}</span>
                  <button
                    type="button"
                    onClick={() => setShowManual(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <Input
                  dir="ltr"
                  value={manualHash}
                  onChange={(e) => setManualHash(e.target.value.trim())}
                  placeholder={t("payment.txHashPlaceholder")}
                  className="font-mono text-xs"
                />
                {tokenKey === "ETH" && (
                  <p className="text-[10px] text-muted-foreground">{t("payment.manualPenguOnly")}</p>
                )}
                <Button
                  onClick={() => verify(manualHash)}
                  disabled={!manualHash}
                  className="w-full gap-2 font-bold"
                >
                  <ShieldCheck className="size-4" />
                  {t("payment.submitTx")}
                </Button>
              </div>
            )}

            {/* step 2: tx hash + verify */}
            {(phase === "sent" || phase === "verifying") && (
              <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">{t("payment.txHashLabel")}</span>
                  {txHash && (
                    <a
                      href={explorerTx(txHash)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {t("payment.viewOnExplorer")} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <Input
                  dir="ltr"
                  value={txHash || manualHash}
                  onChange={(e) => setManualHash(e.target.value.trim())}
                  placeholder={t("payment.txHashPlaceholder")}
                  className="font-mono text-xs"
                  readOnly={!!txHash}
                />
                {receipt.isLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("payment.waitingConfirmation")}
                  </div>
                )}
                {receipt.data?.status === "success" && phase !== "verifying" && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-buy">
                    <CheckCircle2 className="size-3.5" />
                    {t("payment.confirmed")}
                  </div>
                )}
                {receipt.data?.status === "reverted" && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-sell">
                    <AlertTriangle className="size-3.5" />
                    {t("payment.errors.TX_FAILED")}
                  </div>
                )}
                <Button
                  onClick={() => verify(txHash || manualHash)}
                  disabled={
                    !(txHash || manualHash) ||
                    phase === "verifying" ||
                    // wallet-sent tx: wait for the receipt (auto-verify will
                    // fire); manually pasted hashes can be verified right away
                    (!!txHash && !manualHash && receipt.isLoading)
                  }
                  className="w-full gap-2 font-bold"
                >
                  {phase === "verifying" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t("payment.verifying")}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-4" />
                      {t("payment.verify")}
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* errors */}
            {error && (
              <Alert variant="destructive" className="py-3 text-xs">
                <AlertDescription>
                  {error === "rejected"
                    ? t("wallet.signFailed")
                    : error === "NETWORK"
                      ? t("common.error")
                      : error === "popup_blocked"
                        ? t("wallet.error.POPUP_BLOCKED")
                        : error === "timeout"
                          ? t("wallet.error.TIMEOUT")
                          : t(`payment.errors.${error}` as never, { defaultValue: error })}
                </AlertDescription>
              </Alert>
            )}

            <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
              {t("engine.securityBody")}
            </p>
          </div>
        ) : (
          /* success */
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-buy/15 text-buy ring-2 ring-buy/40">
              <CheckCircle2 className="size-9" />
            </span>
            <div className="text-xl font-black">{t("payment.success")}</div>
            {txHash && (
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
              >
                {txHash.slice(0, 18)}…{txHash.slice(-10)}
                <ExternalLink className="size-3" />
              </a>
            )}
            <Badge className="gap-1 bg-buy/15 text-buy ring-1 ring-buy/30">
              <ShieldCheck className="size-3.5" />
              {product.name}
            </Badge>
            <Button onClick={onClose} className="mt-2 w-full font-bold" size="lg">
              {t("common.close")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span dir="auto">{value}</span>
    </div>
  );
}
