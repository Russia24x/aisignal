"use client";

/**
 * Lightweight i18n context (fa/en, RTL-aware).
 * Adding a language = add a JSON dictionary + list the code in
 * NEXT_PUBLIC_SUPPORTED_LOCALES. No routing changes needed (single-page app).
 *
 * Uses useSyncExternalStore over a tiny localStorage-backed store —
 * hydration-safe and effect-free (React 19 lint-clean).
 *
 * @module components/i18n/I18nProvider
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import fa from "@/i18n/fa.json";
import en from "@/i18n/en.json";

export type Locale = "fa" | "en";

const dictionaries: Record<Locale, unknown> = { fa, en };
const STORAGE_KEY = "pengu-locale";

/* ---------------- external store (SSR-safe) ---------------- */

const listeners = new Set<() => void>();

function readStored(): Locale {
  if (typeof window === "undefined") return "fa";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v && v in dictionaries ? (v as Locale) : "fa";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((f) => f());
}

/* ---------------- context ---------------- */

/** Resolve "a.b.c" style keys against the dictionary. */
function resolve(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

type TParams = Record<string, string | number>;

interface I18nContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (l: Locale) => void;
  t: (key: string, params?: TParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readStored, () => "fa" as Locale);

  const setLocale = useCallback((l: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
    document.documentElement.dir = l === "fa" ? "rtl" : "ltr";
    notify();
  }, []);

  // keep <html lang/dir> attributes in sync (external system — effect is the
  // correct tool here; no React state is involved)
  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  }, [locale]);

  const t = useCallback(
    (key: string, params?: TParams): string => {
      let out = resolve(dictionaries[locale], key);
      if (typeof out !== "string") out = resolve(dictionaries.en, key);
      if (typeof out !== "string") return key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          out = (out as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return out as string;
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: locale === "fa" ? "rtl" : "ltr", setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
