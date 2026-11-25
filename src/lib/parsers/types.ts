import type { Currency } from "@/lib/money";

export type BankCode = "isbank" | "vakifbank" | "ziraat" | "papara" | "other";

export const BANKS: { code: BankCode; name: string; short: string; color: string }[] = [
  { code: "isbank", name: "Türkiye İş Bankası", short: "İşbank", color: "#1d4fa0" },
  { code: "vakifbank", name: "VakıfBank", short: "VakıfBank", color: "#f2b705" },
  { code: "ziraat", name: "Ziraat Bankası", short: "Ziraat", color: "#e30a17" },
  { code: "papara", name: "Papara", short: "Papara", color: "#6c3ff5" },
  { code: "other", name: "Other / Cash", short: "Other", color: "#71717a" },
];

export const bankName = (code: string | null | undefined) =>
  BANKS.find((b) => b.code === code)?.short ?? "Other";

/** What the parser thinks this movement is, before category rules run. */
export type KindHint = "cash" | "transfer" | "income" | "fee" | null;

export interface ParsedTransaction {
  bank: BankCode;
  /** ISO timestamp with +03:00 offset */
  occurredAt: string;
  /** Signed: negative = money leaving you */
  amount: number;
  currency: Currency;
  description: string;
  merchant: string | null;
  counterparty: string | null;
  cardLast4: string | null;
  balanceAfter: number | null;
  installments: number | null;
  kindHint: KindHint;
  /** 0..1 — below 0.6 goes to the review queue */
  confidence: number;
}

export type ParseResult =
  | { status: "parsed"; tx: ParsedTransaction }
  | { status: "ignored"; reason: string; bank: BankCode }
  | { status: "failed"; reason: string; bank: BankCode };

export interface InboundMessage {
  text: string;
  sender?: string | null;
  /** When the phone / inbox received it — used when the text has no date */
  receivedAt?: string | Date | null;
  subject?: string | null;
}
