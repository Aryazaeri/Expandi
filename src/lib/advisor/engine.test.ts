import { describe, expect, it } from "vitest";
import { computeAdvisor, type EngineCategory, type EngineTx } from "./engine";

const cat = (id: string, kind: EngineCategory["kind"], extra: Partial<EngineCategory> = {}): EngineCategory => ({
  id, name: id, slug: id, kind, color: "#000", icon: "Circle", is_fixed: false, is_essential: false, monthly_budget: null, ...extra,
});
const categories = [
  cat("income", "income"),
  cat("groceries", "expense", { monthly_budget: 6000 }),
  cat("housing", "expense", { is_fixed: true }),
  cat("subscriptions", "expense"),
  cat("transfer", "transfer"),
];

let i = 0;
const tx = (date: string, amount: number, category_id: string | null, merchant: string | null = null, installments: number | null = null): EngineTx => ({
  id: String(i++), occurred_at: `${date}T12:00:00+03:00`, amount_try: amount, category_id, merchant, description: merchant ?? "x", installments,
});

const transactions: EngineTx[] = [
  // irregular income: 40k, 60k, 30k over the last 3 months
  tx("2026-08-05", 40000, "income"), tx("2026-09-05", 60000, "income"), tx("2026-10-05", 30000, "income"),
  tx("2026-11-03", 50000, "income"),
  // rent every month
  tx("2026-08-01", -15000, "housing", "Kira"), tx("2026-09-01", -15000, "housing", "Kira"),
  tx("2026-10-01", -15000, "housing", "Kira"), tx("2026-11-01", -15000, "housing", "Kira"),
  // netflix
  tx("2026-09-10", -229, "subscriptions", "Netflix"), tx("2026-10-10", -229, "subscriptions", "Netflix"), tx("2026-11-10", -229, "subscriptions", "Netflix"),
  // groceries this month + a 6-installment purchase
  tx("2026-11-12", -3000, "groceries", "Migros"), tx("2026-11-25", -400, "groceries", "Migros"),
  tx("2026-11-20", -12000, "groceries", "Hepsiburada", 6),
  // transfer must be ignored
  tx("2026-11-15", -8000, "transfer", "Kredi karti odeme"),
];

describe("advisor engine", () => {
  const snap = computeAdvisor({
    today: new Date("2026-11-25T10:00:00Z"),
    transactions,
    categories,
    accounts: [],
    goals: [{ id: "g", name: "Emergency", target_amount: 60000, saved_amount: 0, currency: "TRY", target_date: "2027-11-01", is_emergency_fund: true }],
    settings: { income_baseline: null, annual_inflation: 0.3, emergency_months: 6, min_savings_rate: 0.1 },
    rates: { USD: 42, EUR: 48 },
  });

  it("uses a conservative income baseline", () => {
    // last 6 months incl. 3 empty (before data) are excluded -> [30k, 60k, 40k]; median 40k, mean 43.3k
    expect(snap.income.baseline).toBe(40000);
    expect(snap.income.baselineSource).toBe("history");
  });

  it("spreads installments and ignores transfers", () => {
    expect(snap.spend.total).toBe(15000 + 229 + 3000 + 400 + 2000);
  });

  it("reserves fixed costs and detects Netflix as recurring", () => {
    expect(snap.recurring.map((r) => r.name)).toContain("Netflix");
    expect(snap.fixed.expected).toBeGreaterThanOrEqual(15229);
  });

  it("computes a safe-to-spend number", () => {
    expect(snap.safe.monthlyAllowance).not.toBeNull();
    expect(snap.safe.dailyBudget).toBeGreaterThan(0);
    expect(snap.month.daysLeft).toBe(6);
    expect(snap.daily).toHaveLength(30);
  });
});
