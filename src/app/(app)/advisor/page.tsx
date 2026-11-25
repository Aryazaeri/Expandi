import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/app-shell";
import { AdvisorChat } from "@/components/advisor-chat";
import { InsightItem } from "@/components/insight-card";
import { Money } from "@/components/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAiConfigured } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { loadAdvisor } from "@/lib/data";

export const metadata = { title: "Advisor" };

async function AdvisorContent() {
  const { db, userId } = await requireUser();
  const { snapshot: s, profile } = await loadAdvisor(db, userId);
  const aiReady = isAiConfigured() && !!profile?.ai_enabled;

  return (
    <>
      <PageHeader title="Advisor" description="Rules-based insights from your data, plus an AI you can ask anything." />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AdvisorChat enabled={aiReady} reason={!isAiConfigured() ? "Set ANTHROPIC_API_KEY on the server to enable the AI advisor." : "AI is turned off in Settings."} />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>This month&apos;s plan</CardTitle>
              <CardDescription>How your daily number is calculated</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row label={`Income baseline (${baselineLabel(s.income.baselineSource)})`} value={s.income.baseline} />
              <Row label="− Fixed costs & recurring" value={s.fixed.expected === null ? null : -s.fixed.expected} />
              <Row label="− Savings for goals" value={-s.savings.target} />
              <div className="border-t pt-1.5">
                <Row label="= Flexible budget" value={s.safe.monthlyAllowance} bold />
              </div>
              <Row label="− Flexible spent so far" value={-s.spend.variable} />
              <Row label={`= Left for ${s.month.daysLeft} days`} value={s.safe.remaining} bold />
              <p className="pt-2 text-xs text-muted-foreground">
                Inflation assumption {Math.round(s.inflation.annual * 100)}%/year (~{(s.inflation.monthly * 100).toFixed(1)}%/month) — change it in
                Settings.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {s.insights.map((i) => (
                <InsightItem key={i.id} insight={i} />
              ))}
              {!s.insights.length && <p className="text-sm text-muted-foreground">No insights yet — import some transactions.</p>}
            </CardContent>
          </Card>
          {s.recurring.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recurring payments</CardTitle>
                <CardDescription>Detected from repeating charges</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {s.recurring.map((r) => (
                  <div key={r.key} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}</span>
                    <span className="shrink-0">
                      <Money amount={r.monthly} decimals={0} />
                      <span className="text-muted-foreground">/mo</span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function baselineLabel(src: string) {
  return { manual: "set by you", history: "conservative 6-mo", "short-history": "early estimate", "this-month": "this month", none: "unknown" }[src] ?? src;
}

function Row({ label, value, bold }: { label: string; value: number | null; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <Money amount={value} decimals={0} />
    </div>
  );
}

/** Data loads inside Suspense so navigations render the skeleton instantly. */
export default function AdvisorPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdvisorContent />
    </Suspense>
  );
}
