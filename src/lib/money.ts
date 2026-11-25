export type Currency = "TRY" | "USD" | "EUR" | "GBP" | "XAU";

export const CURRENCIES: { code: Currency; label: string; symbol: string }[] = [
  { code: "TRY", label: "Turkish Lira", symbol: "₺" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "XAU", label: "Gold (gram)", symbol: "gr" },
];

/**
 * Parse an amount written the Turkish way ("1.234,56") or the English way
 * ("1,234.56"). Returns null when the string is not a number.
 */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/\s/g, "").replace(/(TL|TRY|₺|USD|EUR|GBP|\$|€|£)/gi, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal separator.
    if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".");
    else normalized = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    const commaCount = s.split(",").length - 1;
    normalized = commaCount === 1 && decimals <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const decimals = s.length - lastDot - 1;
    const dotCount = s.split(".").length - 1;
    // "5.000" / "1.250.000" are Turkish thousands; "245.90" is a decimal.
    normalized = dotCount === 1 && decimals !== 3 ? s : s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function detectCurrency(s: string): Currency {
  const u = s.toUpperCase();
  if (/USD|\$|DOLAR/.test(u)) return "USD";
  if (/EUR|€|AVRO|EURO/.test(u)) return "EUR";
  if (/GBP|£|STERLIN/.test(u)) return "GBP";
  return "TRY";
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(
  amount: number,
  currency: Currency | string = "TRY",
  opts: { compact?: boolean; sign?: boolean; decimals?: number } = {},
): string {
  if (currency === "XAU") {
    return `${amount.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} gr`;
  }
  const key = `${currency}-${opts.compact}-${opts.sign}-${opts.decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      signDisplay: opts.sign ? "exceptZero" : "auto",
      maximumFractionDigits: opts.decimals ?? (opts.compact ? 1 : 2),
      minimumFractionDigits: opts.compact ? 0 : (opts.decimals ?? 2),
    });
    formatters.set(key, f);
  }
  return f.format(amount);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
