"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import { requireUser } from "@/lib/auth";
import { aiCategorize, aiParseMessage, isAiConfigured } from "@/lib/ai";
import { toTry } from "@/lib/advisor/engine";
import { getRates, refreshRates, todayTr } from "@/lib/fx";
import { hashRaw, ingestTransactions, learnRule } from "@/lib/ingest";
import { round2 } from "@/lib/money";
import { parseBankMessage } from "@/lib/parsers/message";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
const done = (message?: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};
const fail = (error: string): ActionResult => ({ ok: false, error });

const Currency = z.enum(["TRY", "USD", "EUR", "GBP", "XAU"]);
const Bank = z.enum(["isbank", "vakifbank", "ziraat", "papara", "other"]);

// ---------------------------------------------------------------- auth

export async function signOut() {
  const { db } = await requireUser();
  await db.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------- transactions

export async function setTransactionCategory(id: string, categoryId: string | null, learn: boolean): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const { data: tx, error } = await db
    .from("transactions")
    .update({ category_id: categoryId, status: "confirmed" })
    .eq("id", id)
    .select("merchant, description")
    .single();
  if (error) return fail(error.message);
  if (learn && categoryId && tx) {
    const key = await learnRule(db, userId, tx.merchant, tx.description, categoryId);
    if (key) {
      // apply to other uncategorized transactions from the same merchant
      const { data: others } = await db.from("transactions").select("id, merchant, description").is("category_id", null).limit(1000);
      const ids = (others ?? [])
        .filter((o) => `${o.merchant ?? ""} ${o.description}`.toUpperCase().includes(key.split(" ")[0]))
        .map((o) => o.id);
      if (ids.length) await db.from("transactions").update({ category_id: categoryId }).in("id", ids);
      return done(`Learned "${key}"${ids.length ? ` and applied to ${ids.length} more` : ""}`);
    }
  }
  return done();
}

const TxInput = z.object({
  id: z.string().uuid().optional(),
  occurred_at: z.string(),
  amount: z.number(),
  currency: Currency,
  description: z.string().min(1).max(200),
  merchant: z.string().max(120).nullable().optional(),
  category_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  installments: z.number().int().min(1).max(48).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function saveTransaction(input: z.input<typeof TxInput>): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const p = TxInput.safeParse(input);
  if (!p.success) return fail(p.error.message);
  const { rates } = await getRates(db);
  const v = p.data;
  const row = {
    ...v,
    merchant: v.merchant || null,
    installments: v.installments && v.installments > 1 ? v.installments : null,
    amount: round2(v.amount),
    amount_try: round2(toTry(v.amount, v.currency, rates)),
    status: "confirmed" as const,
  };
  const { error } = v.id
    ? await db.from("transactions").update(row).eq("id", v.id)
    : await db.from("transactions").insert({ ...row, user_id: userId, source: "manual" });
  return error ? fail(error.message) : done(v.id ? "Saved" : "Added");
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("transactions").delete().eq("id", id);
  return error ? fail(error.message) : done("Deleted");
}

export async function confirmAllReview(): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("transactions").update({ status: "confirmed" }).eq("status", "review");
  return error ? fail(error.message) : done();
}

export async function aiCategorizeUncategorized(): Promise<ActionResult> {
  const { db } = await requireUser();
  if (!isAiConfigured()) return fail("Set ANTHROPIC_API_KEY to use AI categorization.");
  const [{ data: txs }, { data: cats }] = await Promise.all([
    db.from("transactions").select("id, merchant, counterparty, description, amount_try").is("category_id", null).limit(200),
    db.from("categories").select("id, slug, name, kind").not("slug", "is", null),
  ]);
  if (!txs?.length) return done("Nothing to categorize");
  const picks = await aiCategorize(
    txs.map((t, i) => ({ i, text: [t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "), amount: Number(t.amount_try) })),
    (cats ?? []).map((c) => ({ slug: c.slug!, name: c.name, kind: c.kind })),
  );
  let n = 0;
  for (const [i, slug] of picks) {
    const c = cats?.find((x) => x.slug === slug);
    if (!c || !txs[i]) continue;
    await db.from("transactions").update({ category_id: c.id }).eq("id", txs[i].id);
    n++;
  }
  return done(`Categorized ${n} transactions`);
}

// ---------------------------------------------------------------- paste an SMS manually (test the parser)

export async function importPastedMessages(text: string, sender: string | null): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).slice(0, 100);
  const items = [];
  let ignored = 0;
  for (const b of blocks) {
    const r = parseBankMessage({ text: b, sender, receivedAt: new Date() });
    if (r.status === "parsed") items.push({ tx: r.tx, rawText: b, rawHash: hashRaw(`${sender ?? ""}|${b}`) });
    else if (r.status === "failed" && isAiConfigured()) {
      const tx = await aiParseMessage(b, sender, new Date()).catch(() => null);
      if (tx) items.push({ tx, rawText: b, rawHash: hashRaw(`${sender ?? ""}|${b}`) });
      else ignored++;
    } else ignored++;
  }
  const res = await ingestTransactions(db, userId, items, { source: "sms" });
  return done(`${res.inserted.length} imported, ${res.duplicates} duplicates, ${ignored} not transactions`);
}

export async function dismissIngestEvent(id: string): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("ingest_events").update({ status: "dismissed" }).eq("id", id);
  return error ? fail(error.message) : done();
}

// ---------------------------------------------------------------- goals

const GoalInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  target_amount: z.number().positive(),
  saved_amount: z.number().min(0),
  currency: Currency,
  target_date: z.string().nullable(),
  is_emergency_fund: z.boolean(),
});

export async function saveGoal(input: z.input<typeof GoalInput>): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const p = GoalInput.safeParse(input);
  if (!p.success) return fail(p.error.message);
  const { id, ...row } = p.data;
  const { error } = id ? await db.from("goals").update(row).eq("id", id) : await db.from("goals").insert({ ...row, user_id: userId });
  return error ? fail(error.message) : done("Goal saved");
}

export async function addToGoal(id: string, amount: number): Promise<ActionResult> {
  const { db } = await requireUser();
  const { data: g } = await db.from("goals").select("saved_amount").eq("id", id).single();
  if (!g) return fail("Goal not found");
  const { error } = await db.from("goals").update({ saved_amount: Math.max(0, Number(g.saved_amount) + amount) }).eq("id", id);
  return error ? fail(error.message) : done();
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("goals").delete().eq("id", id);
  return error ? fail(error.message) : done("Goal deleted");
}

// ---------------------------------------------------------------- accounts

const AccountInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  bank: Bank,
  type: z.enum(["checking", "credit_card", "wallet", "cash", "savings", "investment"]),
  currency: Currency,
  last4: z.string().regex(/^\d{4}$/).nullable(),
  balance: z.number().nullable(),
  include_in_net_worth: z.boolean(),
});

export async function saveAccount(input: z.input<typeof AccountInput>): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const p = AccountInput.safeParse(input);
  if (!p.success) return fail(p.error.message);
  const { id, ...row } = p.data;
  const withTs = { ...row, balance_updated_at: row.balance === null ? null : new Date().toISOString() };
  const { error } = id ? await db.from("accounts").update(withTs).eq("id", id) : await db.from("accounts").insert({ ...withTs, user_id: userId });
  return error ? fail(error.message) : done("Account saved");
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("accounts").delete().eq("id", id);
  return error ? fail(error.message) : done("Account removed");
}

// ---------------------------------------------------------------- categories & budgets

export async function setCategoryBudget(id: string, budget: number | null): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("categories").update({ monthly_budget: budget && budget > 0 ? budget : null }).eq("id", id);
  return error ? fail(error.message) : done();
}

export async function setCategoryFixed(id: string, fixed: boolean): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("categories").update({ is_fixed: fixed }).eq("id", id);
  return error ? fail(error.message) : done();
}

export async function deleteRule(id: string): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.from("category_rules").delete().eq("id", id);
  return error ? fail(error.message) : done();
}

// ---------------------------------------------------------------- profile / settings

const ProfileInput = z.object({
  full_name: z.string().max(100).nullable(),
  income_baseline: z.number().min(0).nullable(),
  annual_inflation: z.number().min(0).max(5),
  emergency_months: z.number().int().min(0).max(24),
  min_savings_rate: z.number().min(0).max(0.9),
  ai_enabled: z.boolean(),
});

export async function saveProfile(input: z.input<typeof ProfileInput>): Promise<ActionResult> {
  const { db, userId } = await requireUser();
  const p = ProfileInput.safeParse(input);
  if (!p.success) return fail(p.error.message);
  const { error } = await db
    .from("profiles")
    .update({ ...p.data, income_baseline: p.data.income_baseline || null })
    .eq("id", userId);
  return error ? fail(error.message) : done("Settings saved");
}

export async function rotateIngestToken(): Promise<ActionResult> {
  const { db } = await requireUser();
  const { error } = await db.rpc("rotate_ingest_token");
  return error ? fail(error.message) : done("New token generated — update your phone shortcut and e-mail script");
}

export async function refreshFxNow(): Promise<ActionResult> {
  await requireUser();
  try {
    const r = await refreshRates(createAdminClient());
    return r.errors.length && !Object.keys(r.rates).length ? fail(r.errors.join("; ")) : done(`Rates updated${r.errors.length ? ` (${r.errors.join("; ")})` : ""}`);
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function setManualRate(code: "USD" | "EUR" | "GBP" | "XAU", rate: number): Promise<ActionResult> {
  await requireUser();
  if (!(rate > 0)) return fail("Rate must be positive");
  const { error } = await createAdminClient()
    .from("fx_rates")
    .upsert({ code, rate, rate_date: todayTr(), source: "manual" }, { onConflict: "code,rate_date" });
  return error ? fail(error.message) : done(`${code} set to ₺${rate}`);
}
