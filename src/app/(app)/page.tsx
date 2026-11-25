import Link from "next/link";
import { ArrowDownToLine, ArrowRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { CategoryIcon } from "@/components/category-icon";
import { HistoryChart, SpendingPaceChart } from "@/components/dashboard-charts";
import { InsightItem } from "@/components/insight-card";
import { Money } from "@/components/money";
import { TransactionRow } from "@/components/transaction-row";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { loadAdvisor } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const STATUS = {
  good: { label: "On track", cls: "bg-positive/15 text-positive" },
  tight: { label: "Slow down", cls: "bg-warning/20 text-warning" },
  over: { label: "Over plan", cls: "bg-negative/15 text-negative" },
  unknown: { label: "Needs data", cls: "bg-muted text-muted-foreground" },
} as const;

export default async function DashboardPage() {
  const { db, userId } = await requireUser();
  const { snapshot: s, transactions, categories, accounts } = await loadAdvisor(db, userId);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const accById = new Map(accounts.map((a) => [a.id, a.name]));
  const status = STATUS[s.safe.status];
  const reviewCount = transactions.filter((t) => t.status === "review").length;
  const monthName = new Date().toLocaleString("en", { month: "long", timeZone: "Europe/Istanbul" });

  if (transactions.length === 0) return <EmptyState />;

  return (
    <>
      <PageHeader title={`${monthName} overview`} description={`${s.month.daysLeft} days left this month`} />
      {reviewCount > 0 && (
        <Link
          href="/transactions?view=review"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          <span>
            <b>{reviewCount}</b> imported transaction{reviewCount === 1 ? "" : "s"} need a quick check
          </span>
          <ArrowRight className="size-4" />
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Safe to spend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription>Safe to spend today</CardDescription>
            <CardAction>
              <Badge className={cn("border-0", status.cls)}>{status.label}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <Money
                amount={s.safe.leftToday === null ? null : Math.max(0, s.safe.leftToday)}
                decimals={0}
                className={cn("text-5xl font-semibold tracking-tight md:text-6xl", (s.safe.leftToday ?? 0) <= 0 && "text-negative")}
              />
              {s.safe.dailyBudget !== null && (
                <div className="pb-2 text-sm text-muted-foreground">
                  of <Money amount={s.safe.dailyBudget} decimals={0} /> daily budget · spent{" "}
                  <Money amount={s.spend.today} decimals={0} /> today
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Left this month" value={<Money amount={s.safe.remaining} decimals={0} />} />
              <Stat label="Flexible budget" value={<Money amount={s.safe.monthlyAllowance} decimals={0} />} />
              <Stat label="Bills & fixed" value={<Money amount={s.fixed.expected} decimals={0} />} hint={`${Math.round((s.fixed.paid / (s.fixed.expected || 1)) * 100)}% paid`} />
              <Stat label="To goals" value={<Money amount={s.savings.target} decimals={0} />} hint="reserved first" />
            </div>
            <SpendingPaceChart data={s.daily} />
            <p className="text-xs text-muted-foreground">
              Flexible spending vs. plan. Plan = income baseline <Money amount={s.income.baseline} decimals={0} /> − fixed costs − goal
              savings{s.safe.cashLimited ? ", capped by your account balances" : ""}.
            </p>
          </CardContent>
        </Card>

        {/* Insights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand" /> Advisor
            </CardTitle>
            <CardAction>
              <Link href="/advisor" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Ask <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {s.insights.slice(0, 4).map((i) => (
              <InsightItem key={i.id} insight={i} />
            ))}
            {s.insights.length === 0 && <p className="text-sm text-muted-foreground">Nothing to flag — nice.</p>}
          </CardContent>
        </Card>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:col-span-3 lg:grid-cols-4">
          <Kpi label="Spent this month" value={<Money amount={s.spend.total} decimals={0} />} hint={<>avg <Money amount={s.spend.avgMonthlyReal} decimals={0} /> (inflation-adj.)</>} />
          <Kpi label="Income this month" value={<Money amount={s.income.thisMonth} decimals={0} />} hint={<>baseline <Money amount={s.income.baseline} decimals={0} /></>} />
          <Kpi
            label="Net worth"
            value={s.netWorth.hasBalances ? <Money amount={s.netWorth.total} decimals={0} /> : "—"}
            hint={s.netWorth.usd ? <>≈ <Money amount={s.netWorth.usd} currency="USD" decimals={0} /></> : <Link href="/settings" className="underline">add balances</Link>}
          />
          <Kpi label="Recurring / month" value={<Money amount={s.recurring.reduce((a, r) => a + r.monthly, 0)} decimals={0} />} hint={`${s.recurring.length} detected`} />
        </div>

        {/* Categories */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
            <CardDescription>This month by category · vs. your 3-month average (inflation-adjusted)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.categories.slice(0, 8).map((c) => {
              const max = Math.max(c.budget ?? 0, c.avg3, c.spent, 1);
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{c.name}</span>
                      <span className="tabular shrink-0">
                        <Money amount={c.spent} decimals={0} />
                        {c.budget ? <span className="text-muted-foreground"> / <Money amount={c.budget} decimals={0} /></span> : null}
                      </span>
                    </div>
                    <div className="relative mt-1 h-1.5 rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${Math.min(100, (c.spent / max) * 100)}%`, backgroundColor: c.budget && c.spent > c.budget ? "var(--negative)" : c.color }}
                      />
                      {c.avg3 > 0 && <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-foreground/40" style={{ left: `${Math.min(100, (c.avg3 / max) * 100)}%` }} title="3-month average" />}
                    </div>
                  </div>
                </div>
              );
            })}
            {s.spend.uncategorized > 0 && (
              <Link href="/transactions?category=none" className="block text-sm text-muted-foreground underline">
                <Money amount={s.spend.uncategorized} decimals={0} /> uncategorized →
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Income vs. spending</CardTitle>
            <CardDescription>Last months</CardDescription>
          </CardHeader>
          <CardContent>
            <HistoryChart data={s.history} />
          </CardContent>
        </Card>

        {/* Recent */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardAction>
              <Link href="/transactions" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="divide-y">
            {transactions.slice(0, 8).map((t) => (
              <TransactionRow key={t.id} tx={t} category={t.category_id ? catById.get(t.category_id) : null} accountName={t.account_id ? accById.get(t.account_id) : null} showDate />
            ))}
          </CardContent>
        </Card>

        {/* Goals */}
        <Card>
          <CardHeader>
            <CardTitle>Goals</CardTitle>
            <CardAction>
              <Link href="/goals" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Manage <ArrowRight />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {s.goals.length === 0 && <p className="text-sm text-muted-foreground">No goals yet. Add an emergency fund first.</p>}
            {s.goals.map((g) => (
              <div key={g.id} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-muted-foreground">{Math.round(g.progress * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${g.progress * 100}%` }} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <Money amount={g.monthlyNeeded} decimals={0} />/month · {g.monthsLeft} months left
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand text-3xl font-bold text-brand-foreground">₺</div>
      <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s get your money in</h1>
      <p className="mt-2 text-muted-foreground">
        Connect your bank SMS and e-mails once and every transaction from İşbank, VakıfBank, Ziraat and Papara lands here automatically. Upload a
        statement to bring in the last few months right away.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/import" className={buttonVariants({ size: "lg" })}>
          <ArrowDownToLine /> Set up automatic import
        </Link>
        <Link href="/import?tab=statement" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Upload a statement
        </Link>
      </div>
    </div>
  );
}
