import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAdvisor, type EngineTx } from "@/lib/advisor/engine";
import type { Account, Category, Goal, Profile, Transaction } from "@/lib/db-types";
import { getRates } from "@/lib/fx";

/** PostgREST caps responses at 1000 rows — page through. */
export async function fetchAllTransactions(db: SupabaseClient, userId: string, sinceIso: string): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Transaction[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadBasics(db: SupabaseClient, userId: string) {
  const [profile, categories, accounts, goals] = await Promise.all([
    db.from("profiles").select("*").eq("id", userId).single(),
    db.from("categories").select("*").eq("user_id", userId).order("sort"),
    db.from("accounts").select("*").eq("user_id", userId).order("created_at"),
    db.from("goals").select("*").eq("user_id", userId).order("created_at"),
  ]);
  return {
    profile: profile.data as Profile | null,
    categories: (categories.data ?? []) as Category[],
    accounts: (accounts.data ?? []) as Account[],
    goals: (goals.data ?? []) as Goal[],
  };
}

export async function loadAdvisor(db: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 400 * 86400_000).toISOString();
  const [basics, transactions, fx] = await Promise.all([
    loadBasics(db, userId),
    fetchAllTransactions(db, userId, since),
    getRates(db),
  ]);
  const { profile, categories, accounts, goals } = basics;
  const engineTx: EngineTx[] = transactions.map((t) => ({
    id: t.id,
    occurred_at: t.occurred_at,
    amount_try: Number(t.amount_try),
    category_id: t.category_id,
    merchant: t.merchant,
    description: t.description,
    installments: t.installments,
  }));
  const snapshot = computeAdvisor({
    today: new Date(),
    transactions: engineTx,
    categories: categories.map((c) => ({ ...c, monthly_budget: c.monthly_budget === null ? null : Number(c.monthly_budget) })),
    accounts: accounts.map((a) => ({ ...a, balance: a.balance === null ? null : Number(a.balance) })),
    goals: goals.map((g) => ({ ...g, target_amount: Number(g.target_amount), saved_amount: Number(g.saved_amount) })),
    settings: {
      income_baseline: profile?.income_baseline ? Number(profile.income_baseline) : null,
      annual_inflation: Number(profile?.annual_inflation ?? 0.3),
      emergency_months: profile?.emergency_months ?? 6,
      min_savings_rate: Number(profile?.min_savings_rate ?? 0.1),
    },
    rates: fx.rates,
  });
  return { ...basics, transactions, snapshot, rates: fx.rates, ratesAsOf: fx.asOf };
}
