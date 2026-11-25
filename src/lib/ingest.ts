import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorize, ruleKeyFor, type CategoryRef, type UserRule } from "@/lib/categories";
import type { Account, Category, Profile, TxSource } from "@/lib/db-types";
import { getRates } from "@/lib/fx";
import { round2 } from "@/lib/money";
import { bankName, type ParsedTransaction } from "@/lib/parsers/types";
import { aiCategorize, isAiConfigured } from "@/lib/ai";
import { toTry } from "@/lib/advisor/engine";

export const hashRaw = (s: string) => createHash("sha256").update(s.trim().replace(/\s+/g, " ")).digest("hex");

export interface IngestItem {
  tx: ParsedTransaction;
  rawText?: string | null;
  rawHash?: string | null;
}

export interface IngestOptions {
  source: TxSource;
  /** Force all rows into this account (statement uploads) */
  accountId?: string | null;
  /** Ask Claude to categorize what the rules couldn't */
  aiCategorize?: boolean;
}

export interface IngestResult {
  inserted: { id: string; description: string; amount: number; status: string }[];
  duplicates: number;
  errors: string[];
}

interface Ctx {
  profile: Pick<Profile, "full_name" | "ai_enabled">;
  accounts: Account[];
  categories: Category[];
  rules: UserRule[];
}

async function loadCtx(db: SupabaseClient, userId: string): Promise<Ctx> {
  const [p, a, c, r] = await Promise.all([
    db.from("profiles").select("full_name, ai_enabled").eq("id", userId).single(),
    db.from("accounts").select("*").eq("user_id", userId),
    db.from("categories").select("*").eq("user_id", userId),
    db.from("category_rules").select("pattern, category_id").eq("user_id", userId),
  ]);
  return {
    profile: p.data ?? { full_name: null, ai_enabled: false },
    accounts: (a.data ?? []) as Account[],
    categories: (c.data ?? []) as Category[],
    rules: (r.data ?? []) as UserRule[],
  };
}

async function resolveAccount(db: SupabaseClient, userId: string, ctx: Ctx, tx: ParsedTransaction): Promise<string | null> {
  const ofBank = ctx.accounts.filter((a) => a.bank === tx.bank);
  if (tx.cardLast4) {
    const exact = ofBank.find((a) => a.last4 === tx.cardLast4);
    if (exact) return exact.id;
  }
  const preferred = ofBank.find((a) => !a.last4) ?? ofBank[0];
  if (preferred) return preferred.id;
  // First time we see this bank: create an account for it
  const { data } = await db
    .from("accounts")
    .insert({
      user_id: userId,
      name: tx.cardLast4 ? `${bankName(tx.bank)} •${tx.cardLast4}` : bankName(tx.bank),
      bank: tx.bank,
      type: tx.bank === "papara" ? "wallet" : "checking",
      last4: tx.cardLast4,
    })
    .select("*")
    .single();
  if (data) {
    ctx.accounts.push(data as Account);
    return data.id;
  }
  return null;
}

/**
 * Insert parsed transactions for a user. Works with either the user's own
 * client (RLS) or the admin client (webhooks) — userId is always explicit.
 */
export async function ingestTransactions(
  db: SupabaseClient,
  userId: string,
  items: IngestItem[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const result: IngestResult = { inserted: [], duplicates: 0, errors: [] };
  if (!items.length) return result;
  const ctx = await loadCtx(db, userId);
  const { rates } = await getRates(db);
  const catRefs: CategoryRef[] = ctx.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, kind: c.kind }));

  // Existing transactions in the window, for cross-source duplicate detection
  const times = items.map((i) => new Date(i.tx.occurredAt).getTime());
  const from = new Date(Math.min(...times) - 2 * 86400_000).toISOString();
  const to = new Date(Math.max(...times) + 2 * 86400_000).toISOString();
  const { data: existing } = await db
    .from("transactions")
    .select("id, occurred_at, amount_try, source, account_id")
    .eq("user_id", userId)
    .gte("occurred_at", from)
    .lte("occurred_at", to);
  const consumed = new Set<string>();

  const rows: Record<string, unknown>[] = [];
  const needsAi: number[] = [];

  for (const item of items) {
    const { tx } = item;
    const accountId = opts.accountId ?? (await resolveAccount(db, userId, ctx, tx));
    const amountTry = round2(toTry(tx.amount, tx.currency, rates));
    const t = new Date(tx.occurredAt).getTime();

    // Same purchase seen through another channel (SMS + e-mail + statement)?
    const dup = (existing ?? []).find(
      (e) =>
        !consumed.has(e.id) &&
        e.source !== opts.source &&
        Math.abs(Number(e.amount_try) - amountTry) < 0.015 &&
        Math.abs(new Date(e.occurred_at).getTime() - t) < 36 * 3600_000 &&
        (!accountId || !e.account_id || e.account_id === accountId ||
          ctx.accounts.find((a) => a.id === e.account_id)?.bank === tx.bank),
    );
    if (dup) {
      consumed.add(dup.id);
      result.duplicates++;
      continue;
    }

    const cat = categorize(tx, catRefs, ctx.rules, { ownName: ctx.profile.full_name });
    if (!cat.categoryId) needsAi.push(rows.length);
    rows.push({
      user_id: userId,
      account_id: accountId,
      occurred_at: tx.occurredAt,
      amount: round2(tx.amount),
      currency: tx.currency,
      amount_try: amountTry,
      description: tx.description,
      merchant: tx.merchant,
      counterparty: tx.counterparty,
      category_id: cat.categoryId,
      source: opts.source,
      status: tx.confidence < 0.6 ? "review" : "confirmed",
      installments: tx.installments,
      raw_text: item.rawText ?? null,
      raw_hash: item.rawHash ?? null,
    });

    // Keep account balances fresh from "Güncel bakiyeniz: ..." lines
    if (tx.balanceAfter !== null && accountId) {
      const acc = ctx.accounts.find((a) => a.id === accountId);
      if (acc && acc.currency === tx.currency && (!acc.balance_updated_at || acc.balance_updated_at < tx.occurredAt)) {
        await db.from("accounts").update({ balance: tx.balanceAfter, balance_updated_at: tx.occurredAt }).eq("id", accountId).eq("user_id", userId);
        acc.balance_updated_at = tx.occurredAt;
      }
    }
  }

  if (opts.aiCategorize !== false && needsAi.length && ctx.profile.ai_enabled && isAiConfigured()) {
    try {
      const slugCats = ctx.categories.filter((c) => c.slug).map((c) => ({ slug: c.slug!, name: c.name, kind: c.kind }));
      const picks = await aiCategorize(
        needsAi.map((idx) => ({
          i: idx,
          text: [rows[idx].merchant, rows[idx].counterparty, rows[idx].description].filter(Boolean).join(" | "),
          amount: rows[idx].amount_try as number,
        })),
        slugCats,
      );
      for (const [idx, slug] of picks) {
        const c = ctx.categories.find((x) => x.slug === slug);
        if (c && rows[idx]) rows[idx].category_id = c.id;
      }
    } catch (e) {
      result.errors.push(`AI categorization skipped: ${(e as Error).message}`);
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from("transactions")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,raw_hash", ignoreDuplicates: true })
      .select("id, description, amount_try, status");
    if (error) result.errors.push(error.message);
    for (const r of data ?? []) result.inserted.push({ id: r.id, description: r.description, amount: Number(r.amount_try), status: r.status });
  }
  // rows skipped by the raw_hash conflict (same SMS delivered twice)
  if (!result.errors.length) result.duplicates += rows.length - result.inserted.length;
  return result;
}

/** When a user re-categorizes a transaction, remember it for the merchant. */
export async function learnRule(db: SupabaseClient, userId: string, merchant: string | null, description: string, categoryId: string) {
  const key = ruleKeyFor(merchant, description);
  if (!key) return null;
  await db.from("category_rules").upsert({ user_id: userId, pattern: key, category_id: categoryId }, { onConflict: "user_id,pattern" });
  return key;
}
