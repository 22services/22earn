import { env } from "./env";

/** All money is integer cents. Never use floats for balances. */
export function formatMoney(cents: number, opts: { currency?: string; sign?: boolean } = {}) {
  const formatter = new Intl.NumberFormat(env.locale, {
    style: "currency",
    currency: opts.currency ?? env.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: opts.sign ? "exceptZero" : "auto",
  });
  return formatter.format(cents / 100);
}

/** "12.5" | "12,50" | "1 234.56" → 1250 | 1250 | 123456. Returns null when invalid. */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).trim().replace(/[\s $€£]/g, "");
  if (!cleaned) return null;
  // accept a comma as decimal separator when it is the last separator
  const normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [whole, frac = ""] = normalized.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** 1250 → "12.50" (provider APIs such as PayPal want a decimal string). */
export function centsToDecimalString(cents: number) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatCompact(n: number) {
  return new Intl.NumberFormat(env.locale, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat(env.locale).format(n);
}
