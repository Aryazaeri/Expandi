import type { AccountType } from "@/lib/advisor/engine";
import type { CategoryKind } from "@/lib/categories";
import type { Currency } from "@/lib/money";
import type { BankCode } from "@/lib/parsers/types";

export interface Profile {
  id: string;
  full_name: string | null;
  ingest_token: string;
  income_baseline: number | null;
  annual_inflation: number;
  emergency_months: number;
  min_savings_rate: number;
  ai_enabled: boolean;
}

export interface Account {
  id: string;
  name: string;
  bank: BankCode;
  type: AccountType;
  currency: Currency;
  last4: string | null;
  balance: number | null;
  balance_updated_at: string | null;
  include_in_net_worth: boolean;
}

export interface Category {
  id: string;
  slug: string | null;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  is_fixed: boolean;
  is_essential: boolean;
  monthly_budget: number | null;
  sort: number;
}

export type TxSource = "sms" | "email" | "statement" | "manual" | "ai";

export interface Transaction {
  id: string;
  account_id: string | null;
  occurred_at: string;
  amount: number;
  currency: Currency;
  amount_try: number;
  description: string;
  merchant: string | null;
  counterparty: string | null;
  category_id: string | null;
  source: TxSource;
  status: "confirmed" | "review";
  installments: number | null;
  notes: string | null;
  raw_text: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  currency: Currency;
  target_date: string | null;
  is_emergency_fund: boolean;
}

export interface IngestEvent {
  id: string;
  source: "sms" | "email" | "statement";
  sender: string | null;
  raw: string;
  status: "parsed" | "ai_parsed" | "ignored" | "failed" | "duplicate" | "dismissed";
  reason: string | null;
  transaction_id: string | null;
  created_at: string;
}

/** Postgres numeric comes back as string from PostgREST — coerce. */
export function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}
export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
