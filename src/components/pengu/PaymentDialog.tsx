"use client";

/**
 * PaymentDialog — pay a product price in PENGU (ERC-20 transfer) and have
 * the server verify it on-chain.
 *
 * Steps (all user-visible):
 *  1. summary: product, price, treasury, wallet PENGU balance
 *  2. "Pay from wallet" → ERC-20 `transfer(treasury, amount)` via wagmi
 *  3. after the tx hash exists (receipt pending is fine) it is auto-filled
 *  4. "Verify & activate" → POST /api/payment/verify (server-side RPC check)
 *  5. success → session refresh (entitlements update reactively)
 *
 * Security: the client never claims anything — it only submits a tx hash;
 * verification happens entirely server-side against the Abstract RPC.
 *
 * @module components/pengu/PaymentDialog
 */
import { useCallback, useMemo, useState } from "react";
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, parseUnits } from "viem";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useAuth } from "./useAuth";
import { publicConfig, formatPengu } from "@/lib/public-config";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck, Wallet } from "lucide-react";
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

export function PaymentDialog({ product, onClose }: Props) {
  const { t } = useI18n();
  const { address } = useAccount();
  const { refresh } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState("");
  const [manualHash, setManualHash] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: penguBalance } = useBalance({
    address,
    token: publicConfig.penguToken,
    chainId: publicConfig.chainId,
  });

  const { writeContractAsync } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: (txHash || undefined) as `0x${string}` | undefined,
    chainId: publicConfig.chainId,
    query: { enabled: !!txHash },
  });

  const balanceOk = useMemo(
    () => !penguBalance || !product || penguBalance.value >= parseUnits(String(product.pricePengu), 18),
    [penguBalance, product],
  );

  /** Trigger the ERC-20 transfer from the connected wallet. */
  const pay = useCallback(async () => {
    if (!product) return;
    setPhase("sending");
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: publicConfig.penguToken,
        abi: erc20Abi,
        functionName: "transfer",
        args: [publicConfig.treasury, parseUnits(String(product.pricePengu), 18)],
        chainId: publicConfig.chainId,
      });
      setTxHash(hash);
      setPhase("sent");
    } catch (err) {
      setPhase("idle");
      setError(String(err).includes("UserRejected") ? "rejected" : "send_failed");
    }
  }, [product, writeContractAsync]);

  /** Ask the server to verify the tx and grant access. */
  const verify = useCallback(
    async (hash: string) => {
      if (!product || !hash) return;
      setPhase("verifying");
      setError(null);
      try {
        const res = await fetch("/api/payment/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash: hash, product: product.id }),
        });
        const data = await res.json();
        if (data.ok) {
          setPhase("success");
          await refresh();
        } else {
          setPhase("sent");
          setError(data.error ?? "VERIFY_FAILED");
        }
      } catch {
        setPhase("sent");
        setError("NETWORK");
      }
    },
    [product, refresh],
  );

  const explorerTx = (hash: string) => `${publicConfig.explorerUrl}/tx/${hash}`;

  if (!product) return null;

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
                  <span className="font-mono font-black text-primary">
                    {product.pricePengu} PENGU
                  </span>
                }
              />
              <Row
                label={t("payment.balance")}
                value={
                  <span className={cn("font-mono text-sm", balanceOk ? "text-buy" : "text-sell")}>
                    {formatPengu(penguBalance?.value)} PENGU
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
            </div>

            {/* step 1: pay */}
            <Button
              onClick={pay}
              disabled={phase === "sending" || phase === "sent" || !balanceOk}
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
                  {t("payment.payNow")} — {product.pricePengu} PENGU
                </>
              )}
            </Button>

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
                    {t("payment.waiting")}
                  </div>
                )}
                <Button
                  onClick={() => verify(txHash || manualHash)}
                  disabled={!(txHash || manualHash) || phase === "verifying"}
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
