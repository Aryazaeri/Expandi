/**
 * The rules-based advisor. Pure function: give it transactions, accounts,
 * goals and settings, get back the dashboard numbers and insights.
 *
 * Built for irregular income in a high-inflation economy:
 *  - income baseline = conservative (min of median & mean) of recent months
 *  - fixed costs (rent, bills, detected subscriptions) are reserved first
 *  - goal contributions are reserved next ("pay yourself first")
 *  - what's left is spread over the remaining days -> "safe to spend today"
 *  - historic amounts are inflation-adjusted when compared
 *  - installment (taksit) purchases are spread over their months
 */
import { ruleKeyFor, type CategoryKind } from "@/lib/categories";
import type { Currency } from "@/lib/money";

export interface EngineCategory {
  id: string;
  name: string;
  slug: string | null;
  kind: CategoryKind;
  color: string;
  icon: string;
  is_fixed: boolean;
  is_essential: boolean;
  monthly_budget: number | null;
}

export interface EngineTx {
  id: string;
  occurred_at: string;
  amount_try: number;
  category_id: string | null;
  merchant: string | null;
  description: string;
  installments: number | null;
}

export type AccountType = "checking" | "credit_card" | "wallet" | "cash" | "savings" | "investment";

export interface EngineAccount {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  balance: number | null;
  include_in_net_worth: boolean;
}

export interface EngineGoal {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  currency: Currency;
  target_date: string | null;
  is_emergency_fund: boolean;
}

export interface EngineSettings {
  income_baseline: number | null;
  annual_inflation: number; // 0.30 = 30%
  emergency_months: number;
  min_savings_rate: number; // 0.10 = 10% of income
}

export type Rates = Partial<Record<Currency, number>>; // TRY per 1 unit

export interface Insight {
  id: string;
  severity: "good" | "info" | "warn";
  title: string;
  body: string;
}

const TR_OFFSET = 3 * 3600_000;

export function trParts(d: Date) {
  const t = new Date(d.getTime() + TR_OFFSET);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}
function monthsBetween(a: string, b: string) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return by * 12 + bm - (ay * 12 + am);
}
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r0 = (n: number) => Math.round(n);

export function toTry(amount: number, currency: Currency, rates: Rates): number {
  if (currency === "TRY") return amount;
  const rate = rates[currency];
  return rate ? amount * rate : amount;
}

export interface AdvisorInput {
  today: Date;
  transactions: EngineTx[];
  categories: EngineCategory[];
  accounts: EngineAccount[];
  goals: EngineGoal[];
  settings: EngineSettings;
  rates: Rates;
}

export function computeAdvisor(input: AdvisorInput) {
  const { today, transactions, categories, accounts, goals, settings, rates } = input;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const nowP = trParts(today);
  const curMonth = monthKey(nowP.y, nowP.m);
  const daysInMonth = new Date(Date.UTC(nowP.y, nowP.m, 0)).getUTCDate();
  const dayOfMonth = nowP.d;
  const daysLeft = daysInMonth - dayOfMonth + 1; // including today
  const elapsed = dayOfMonth / daysInMonth;
  const monthlyInflation = Math.pow(1 + settings.annual_inflation, 1 / 12) - 1;
  const real = (amount: number, monthsAgo: number) => amount * Math.pow(1 + monthlyInflation, Math.max(0, monthsAgo));

  type Kind = CategoryKind | "uncategorized";
  const kindOf = (tx: EngineTx): Kind => {
    const c = tx.category_id ? catById.get(tx.category_id) : undefined;
    return c ? c.kind : "uncategorized";
  };
  const isFixedTx = (tx: EngineTx) => !!(tx.category_id && catById.get(tx.category_id)?.is_fixed);

  // ---- monthly aggregates (installments spread over months) -----------------
  interface Bucket { income: number; expense: number; byCat: Map<string, number>; fixed: number }
  const months = new Map<string, Bucket>();
  const bucket = (k: string) => {
    let b = months.get(k);
    if (!b) months.set(k, (b = { income: 0, expense: 0, byCat: new Map(), fixed: 0 }));
    return b;
  };
  const futureInstallments = new Map<string, number>();
  let firstMonth: string | null = null;

  for (const tx of transactions) {
    const p = trParts(new Date(tx.occurred_at));
    const mk = monthKey(p.y, p.m);
    if (!firstMonth || mk < firstMonth) firstMonth = mk;
    const kind = kindOf(tx);
    if (kind === "transfer") continue;
    const cat = tx.category_id ? catById.get(tx.category_id) : undefined;
    if (tx.amount_try > 0) {
      // Refunds reduce spending instead of counting as income
      if (cat?.slug === "refunds") {
        const b = bucket(mk);
        b.expense -= tx.amount_try;
      } else {
        bucket(mk).income += tx.amount_try;
      }
      continue;
    }
    const spend = -tx.amount_try;
    const n = tx.installments && tx.installments > 1 ? tx.installments : 1;
    for (let i = 0; i < n; i++) {
      const k = addMonths(mk, i);
      const part = spend / n;
      if (k > curMonth) {
        futureInstallments.set(k, (futureInstallments.get(k) ?? 0) + part);
        continue;
      }
      const b = bucket(k);
      b.expense += part;
      const ck = tx.category_id ?? "uncategorized";
      b.byCat.set(ck, (b.byCat.get(ck) ?? 0) + part);
      if (isFixedTx(tx)) b.fixed += part;
    }
  }

  const prevMonths = [1, 2, 3, 4, 5, 6].map((i) => addMonths(curMonth, -i)).filter((k) => !firstMonth || k >= firstMonth);
  const history = [...prevMonths].reverse().concat(curMonth).map((k) => {
    const b = months.get(k);
    return { month: k, income: r0(b?.income ?? 0), expense: r0(Math.max(0, b?.expense ?? 0)) };
  });

  // ---- income baseline ------------------------------------------------------
  const pastIncomes = prevMonths.map((k) => months.get(k)?.income ?? 0);
  const nonZero = pastIncomes.filter((x) => x > 0);
  let baseline: number | null = null;
  let baselineSource: "manual" | "history" | "short-history" | "this-month" | "none" = "none";
  if (settings.income_baseline && settings.income_baseline > 0) {
    baseline = settings.income_baseline;
    baselineSource = "manual";
  } else if (pastIncomes.length >= 3) {
    baseline = Math.min(median(pastIncomes), mean(pastIncomes));
    baselineSource = "history";
  } else if (nonZero.length > 0) {
    baseline = mean(nonZero) * 0.9;
    baselineSource = "short-history";
  } else if ((months.get(curMonth)?.income ?? 0) > 0) {
    baseline = months.get(curMonth)!.income;
    baselineSource = "this-month";
  }
  const incomeVolatility = nonZero.length >= 3 ? stdev(pastIncomes) / (mean(pastIncomes) || 1) : null;

  // ---- recurring / subscriptions -------------------------------------------
  const windowStart = new Date(today.getTime() - 120 * 86400_000);
  const groups = new Map<string, EngineTx[]>();
  for (const tx of transactions) {
    if (tx.amount_try >= 0 || kindOf(tx) === "transfer") continue;
    if (new Date(tx.occurred_at) < windowStart) continue;
    const key = ruleKeyFor(tx.merchant, tx.description);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(tx);
    groups.set(key, arr);
  }
  const recurring: {
    key: string; name: string; monthly: number; lastDate: string; categoryId: string | null; paidThisMonth: boolean;
  }[] = [];
  for (const [key, txs] of groups) {
    const byMonth = new Map<string, EngineTx[]>();
    for (const t of txs) {
      const p = trParts(new Date(t.occurred_at));
      const mk = monthKey(p.y, p.m);
      byMonth.set(mk, [...(byMonth.get(mk) ?? []), t]);
    }
    if (byMonth.size < 2) continue;
    // one charge per month, similar amounts
    if ([...byMonth.values()].some((list) => list.length > 2)) continue;
    const amounts = txs.map((t) => -t.amount_try);
    const med = median(amounts);
    if (amounts.some((a) => Math.abs(a - med) / med > 0.25)) continue;
    const sorted = [...txs].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const last = sorted[sorted.length - 1];
    recurring.push({
      key,
      name: last.merchant || last.description,
      monthly: med,
      lastDate: last.occurred_at,
      categoryId: last.category_id,
      paidThisMonth: byMonth.has(curMonth),
    });
  }
  recurring.sort((a, b) => b.monthly - a.monthly);
  const recurringKeys = new Set(recurring.map((r) => r.key));

  // ---- this month -----------------------------------------------------------
  const cur = months.get(curMonth) ?? { income: 0, expense: 0, byCat: new Map(), fixed: 0 };
  let fixedPaid = 0;
  let spentToday = 0;
  let variableSpentToday = 0;
  for (const tx of transactions) {
    const p = trParts(new Date(tx.occurred_at));
    if (monthKey(p.y, p.m) !== curMonth || tx.amount_try >= 0 || kindOf(tx) === "transfer") continue;
    const n = tx.installments && tx.installments > 1 ? tx.installments : 1;
    const spend = -tx.amount_try / n;
    const fixedLike = isFixedTx(tx) || recurringKeys.has(ruleKeyFor(tx.merchant, tx.description) ?? "");
    if (fixedLike) fixedPaid += spend;
    if (p.d === dayOfMonth) {
      spentToday += spend;
      if (!fixedLike) variableSpentToday += spend;
    }
  }
  // installments from previous months landing in this month count as fixed
  const carriedInstallments = (() => {
    let s = 0;
    for (const tx of transactions) {
      const n = tx.installments && tx.installments > 1 ? tx.installments : 1;
      if (n === 1 || tx.amount_try >= 0) continue;
      const p = trParts(new Date(tx.occurred_at));
      const start = monthKey(p.y, p.m);
      const offset = monthsBetween(start, curMonth);
      if (offset >= 1 && offset < n) s += -tx.amount_try / n;
    }
    return s;
  })();
  fixedPaid += carriedInstallments;

  const totalSpent = Math.max(0, cur.expense);
  const variableSpent = Math.max(0, totalSpent - fixedPaid);

  const fixedCatAvg = mean(
    prevMonths.slice(0, 3).map((k) => months.get(k)?.fixed ?? 0),
  );
  const recurringNonFixed = recurring
    .filter((r) => !(r.categoryId && catById.get(r.categoryId)?.is_fixed))
    .reduce((a, r) => a + r.monthly, 0);
  const fixedExpected = Math.max(fixedCatAvg + recurringNonFixed + carriedInstallments, fixedPaid);
  const fixedRemaining = Math.max(0, fixedExpected - fixedPaid);

  // ---- goals ----------------------------------------------------------------
  const goalPlans = goals.map((g) => {
    const target = toTry(g.target_amount, g.currency, rates);
    const saved = toTry(g.saved_amount, g.currency, rates);
    const remaining = Math.max(0, target - saved);
    let monthsLeft = 12;
    if (g.target_date) {
      const tp = trParts(new Date(g.target_date));
      monthsLeft = Math.max(1, monthsBetween(curMonth, monthKey(tp.y, tp.m)));
    }
    // inflation: a TRY target keeps losing value — grow it to the target date
    const inflatedRemaining = g.currency === "TRY" ? remaining * Math.pow(1 + monthlyInflation, monthsLeft / 2) : remaining;
    const monthlyNeeded = inflatedRemaining / monthsLeft;
    return {
      ...g,
      targetTry: target,
      savedTry: saved,
      remainingTry: remaining,
      monthsLeft,
      monthlyNeeded,
      progress: target > 0 ? Math.min(1, saved / target) : 0,
    };
  });
  const goalsMonthly = goalPlans.reduce((a, g) => a + g.monthlyNeeded, 0);
  const savingsTarget = Math.max(goalsMonthly, (baseline ?? 0) * settings.min_savings_rate);

  // ---- safe to spend ----------------------------------------------------------
  const monthlyAllowance = baseline !== null ? baseline - fixedExpected - savingsTarget : null;
  let dailyBudget: number | null = null;
  let leftToday: number | null = null;
  let remaining: number | null = null;
  let status: "good" | "tight" | "over" | "unknown" = "unknown";
  if (monthlyAllowance !== null) {
    remaining = monthlyAllowance - variableSpent;
    const startOfDayRemaining = monthlyAllowance - (variableSpent - variableSpentToday);
    dailyBudget = Math.max(0, startOfDayRemaining / daysLeft);
    leftToday = dailyBudget - variableSpentToday;
    const usedFrac = monthlyAllowance > 0 ? variableSpent / monthlyAllowance : 1;
    status = remaining < 0 ? "over" : usedFrac > elapsed + 0.1 ? "tight" : "good";
  }

  // ---- accounts / net worth ----------------------------------------------------
  let netWorth = 0;
  let liquidTry = 0;
  let cardDebt = 0;
  const byCurrency = new Map<Currency, { amount: number; try: number }>();
  let hasBalances = false;
  for (const a of accounts) {
    if (a.balance === null) continue;
    hasBalances = true;
    const t = toTry(a.balance, a.currency, rates);
    if (a.include_in_net_worth) {
      netWorth += t;
      const cur = byCurrency.get(a.currency) ?? { amount: 0, try: 0 };
      cur.amount += a.balance;
      cur.try += t;
      byCurrency.set(a.currency, cur);
    }
    if (a.type === "credit_card") cardDebt += Math.min(0, t);
    if (a.currency === "TRY" && (a.type === "checking" || a.type === "wallet" || a.type === "cash")) liquidTry += a.balance;
  }
  let cashLimited = false;
  if (hasBalances && dailyBudget !== null && liquidTry > 0) {
    const cashDaily = Math.max(0, (liquidTry + cardDebt - fixedRemaining) / daysLeft);
    if (cashDaily < dailyBudget) {
      leftToday = (leftToday ?? 0) - (dailyBudget - cashDaily);
      dailyBudget = cashDaily;
      cashLimited = true;
    }
  }

  // ---- categories breakdown -----------------------------------------------------
  const avgExpense3Real = mean(prevMonths.slice(0, 3).map((k, i) => real(Math.max(0, months.get(k)?.expense ?? 0), i + 1)));
  const categoryRows = categories
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const spent = cur.byCat.get(c.id) ?? 0;
      const prev = prevMonths.slice(0, 3).map((k, i) => real(months.get(k)?.byCat.get(c.id) ?? 0, i + 1));
      const avg3 = prev.length ? mean(prev) : 0;
      const budget = c.monthly_budget;
      return {
        id: c.id, name: c.name, color: c.color, icon: c.icon, slug: c.slug,
        spent: r0(spent), avg3: r0(avg3), budget,
        projected: r0(elapsed > 0.15 ? spent / elapsed : Math.max(spent, avg3)),
        pace: budget ? spent / (budget * elapsed || 1) : null,
      };
    })
    .filter((c) => c.spent > 0 || c.avg3 > 0 || c.budget);
  categoryRows.sort((a, b) => b.spent - a.spent);
  const uncategorizedSpent = cur.byCat.get("uncategorized") ?? 0;

  // ---- daily series for the chart -------------------------------------------------
  const daily: { day: number; spent: number; plan: number | null }[] = [];
  {
    const perDay = new Array(daysInMonth + 1).fill(0);
    for (const tx of transactions) {
      const p = trParts(new Date(tx.occurred_at));
      if (monthKey(p.y, p.m) !== curMonth || tx.amount_try >= 0 || kindOf(tx) === "transfer") continue;
      if (isFixedTx(tx) || recurringKeys.has(ruleKeyFor(tx.merchant, tx.description) ?? "")) continue;
      const n = tx.installments && tx.installments > 1 ? tx.installments : 1;
      perDay[p.d] += -tx.amount_try / n;
    }
    let cum = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      cum += perDay[d];
      daily.push({
        day: d,
        spent: d <= dayOfMonth ? r0(cum) : (null as unknown as number),
        plan: monthlyAllowance !== null ? r0((monthlyAllowance * d) / daysInMonth) : null,
      });
    }
  }

  // ---- insights --------------------------------------------------------------------
  const insights: Insight[] = [];
  const fmt = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

  if (baseline === null) {
    insights.push({
      id: "no-income", severity: "info", title: "Set your income baseline",
      body: "There's no income data yet, so I can't calculate a daily budget. Import a statement with a few months of income or set a monthly baseline in Settings.",
    });
  } else if (baselineSource === "history" && incomeVolatility !== null && incomeVolatility > 0.3) {
    insights.push({
      id: "volatile-income", severity: "info", title: "Your income swings a lot",
      body: `Your monthly income varied by about ${Math.round(incomeVolatility * 100)}% over the last months, so I'm planning with a conservative baseline of ${fmt(baseline)}/month instead of the average. Anything you earn above that is a bonus — consider sending it straight to your goals.`,
    });
  }

  if (status === "over" && remaining !== null) {
    insights.push({
      id: "over-plan", severity: "warn", title: "You're over this month's plan",
      body: `You've spent ${fmt(-remaining)} more on flexible spending than this month allows. Each remaining day's budget is now ₺0 — try to keep to essentials until next month, or move money from a goal if this was planned.`,
    });
  } else if (status === "tight") {
    insights.push({
      id: "tight", severity: "warn", title: "Spending is ahead of pace",
      body: `You've used ${Math.round((variableSpent / (monthlyAllowance || 1)) * 100)}% of this month's flexible budget with ${Math.round(elapsed * 100)}% of the month gone. Slowing down a little now keeps the rest of the month comfortable.`,
    });
  } else if (status === "good" && dayOfMonth > 5) {
    insights.push({
      id: "on-track", severity: "good", title: "On track this month",
      body: `You're within plan — ${fmt(remaining ?? 0)} of flexible money left for ${daysLeft} days.`,
    });
  }

  for (const c of categoryRows) {
    if (c.budget && c.spent > c.budget) {
      insights.push({
        id: `budget-${c.id}`, severity: "warn", title: `${c.name} budget exceeded`,
        body: `${fmt(c.spent)} spent vs. a ${fmt(c.budget)} budget.`,
      });
    } else if (c.budget && c.pace && c.pace > 1.25 && c.spent > c.budget * 0.5) {
      insights.push({
        id: `pace-${c.id}`, severity: "warn", title: `${c.name} is running hot`,
        body: `At this pace you'll spend about ${fmt(c.projected)} on ${c.name.toLowerCase()} this month (budget ${fmt(c.budget)}).`,
      });
    } else if (!c.budget && elapsed > 0.33 && c.avg3 > 300 && c.projected > c.avg3 * 1.35 && c.projected - c.avg3 > 750) {
      insights.push({
        id: `trend-${c.id}`, severity: "info", title: `More on ${c.name.toLowerCase()} than usual`,
        body: `Projected ${fmt(c.projected)} this month vs. your inflation-adjusted average of ${fmt(c.avg3)}.`,
      });
    }
  }

  const subs = recurring.filter((r) => {
    const c = r.categoryId ? catById.get(r.categoryId) : undefined;
    return !c?.is_fixed;
  });
  if (subs.length >= 2) {
    const total = subs.reduce((a, r) => a + r.monthly, 0);
    insights.push({
      id: "subscriptions", severity: "info", title: `${subs.length} recurring payments detected`,
      body: `${subs.slice(0, 5).map((s) => s.name).join(", ")}${subs.length > 5 ? "…" : ""} cost about ${fmt(total)}/month (${fmt(total * 12)}/year). Cancel the ones you don't use.`,
    });
  }

  const eatingOut = categoryRows.filter((c) => c.slug === "food-delivery" || c.slug === "dining").reduce((a, c) => a + c.spent, 0);
  if (variableSpent > 0 && eatingOut / variableSpent > 0.25 && eatingOut > 1500) {
    insights.push({
      id: "eating-out", severity: "info", title: "Eating out is a big slice",
      body: `${Math.round((eatingOut / variableSpent) * 100)}% of your flexible spending this month (${fmt(eatingOut)}) is delivery and dining. Swapping two orders a week for groceries usually saves a lot.`,
    });
  }

  const avgMonthlyExpense = mean(prevMonths.slice(0, 3).map((k) => Math.max(0, months.get(k)?.expense ?? 0))) || totalSpent;
  const hasEmergency = goals.some((g) => g.is_emergency_fund);
  if (!hasEmergency && avgMonthlyExpense > 0) {
    insights.push({
      id: "emergency", severity: baselineSource === "history" && (incomeVolatility ?? 0) > 0.2 ? "warn" : "info",
      title: "Build an emergency fund first",
      body: `With irregular income, a buffer of ${settings.emergency_months} months of expenses (about ${fmt(avgMonthlyExpense * settings.emergency_months)}) keeps a slow month from becoming debt. Add it as a goal so it's reserved automatically.`,
    });
  }

  if (hasBalances) {
    const idle = liquidTry - Math.max(avgMonthlyExpense, fixedExpected + (monthlyAllowance ?? 0));
    if (idle > 5000) {
      insights.push({
        id: "idle-cash", severity: "info", title: "Idle lira is losing value",
        body: `About ${fmt(idle)} is sitting in TRY current accounts beyond one month of spending. At ~${Math.round(settings.annual_inflation * 100)}% annual inflation that's roughly ${fmt(idle * monthlyInflation)} of purchasing power lost per month. Options people commonly use: a daily-interest / time deposit account, a money-market fund (para piyasası fonu), or splitting part into FX or gold. This isn't investment advice — compare current rates first.`,
      });
    }
  }
  if (cashLimited) {
    insights.push({
      id: "cash-limited", severity: "warn", title: "Your accounts limit today's budget",
      body: "Your plan allows more, but your current account balances (after card debt and upcoming bills) don't — so today's number is based on cash you actually have.",
    });
  }

  for (const g of goalPlans) {
    if (!g.target_date) continue;
    if (g.monthlyNeeded > (baseline ?? 0) * 0.5 && baseline) {
      insights.push({
        id: `goal-${g.id}`, severity: "warn", title: `"${g.name}" needs a rethink`,
        body: `Reaching it by the target date takes ${fmt(g.monthlyNeeded)}/month — over half your baseline income. Consider moving the date out or lowering the target.`,
      });
    }
  }

  const nextInst = futureInstallments.get(addMonths(curMonth, 1)) ?? 0;
  if (nextInst > 0) {
    insights.push({
      id: "installments", severity: "info", title: "Installments already committed",
      body: `${fmt(nextInst)} of past taksitli purchases will land next month. It's already reserved as a fixed cost in next month's plan.`,
    });
  }
  if (uncategorizedSpent > 0) {
    insights.push({
      id: "uncategorized", severity: "info", title: "Some spending has no category",
      body: `${fmt(uncategorizedSpent)} this month isn't categorized yet. Categorizing it once teaches the app for next time.`,
    });
  }

  const order = { warn: 0, info: 1, good: 2 } as const;
  insights.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    month: { key: curMonth, dayOfMonth, daysInMonth, daysLeft, elapsed },
    income: {
      baseline, baselineSource, volatility: incomeVolatility,
      thisMonth: r0(cur.income),
    },
    fixed: { expected: r0(fixedExpected), paid: r0(fixedPaid), remaining: r0(fixedRemaining), carriedInstallments: r0(carriedInstallments) },
    savings: { target: r0(savingsTarget), goalsMonthly: r0(goalsMonthly) },
    spend: {
      total: r0(totalSpent), variable: r0(variableSpent), today: r0(spentToday),
      avgMonthlyReal: r0(avgExpense3Real), uncategorized: r0(uncategorizedSpent),
    },
    safe: {
      monthlyAllowance: monthlyAllowance === null ? null : r0(monthlyAllowance),
      remaining: remaining === null ? null : r0(remaining),
      dailyBudget: dailyBudget === null ? null : r0(dailyBudget),
      leftToday: leftToday === null ? null : r0(leftToday),
      status, cashLimited,
    },
    netWorth: {
      hasBalances, total: r0(netWorth), liquidTry: r0(liquidTry), cardDebt: r0(cardDebt),
      byCurrency: [...byCurrency.entries()].map(([currency, v]) => ({ currency, amount: v.amount, try: r0(v.try) })),
      usd: rates.USD ? r0(netWorth / rates.USD) : null,
    },
    inflation: { annual: settings.annual_inflation, monthly: monthlyInflation },
    goals: goalPlans,
    recurring,
    categories: categoryRows,
    history,
    daily,
    insights,
  };
}

export type AdvisorSnapshot = ReturnType<typeof computeAdvisor>;

function stdev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
