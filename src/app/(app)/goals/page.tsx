import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/app-shell";
import { GoalsView } from "@/components/goals-view";
import { requireUser } from "@/lib/auth";
import { loadAdvisor } from "@/lib/data";

export const metadata = { title: "Goals" };

async function GoalsContent() {
  const { db, userId } = await requireUser();
  const { snapshot: s, goals } = await loadAdvisor(db, userId);
  const avgExpense = s.spend.avgMonthlyReal || s.spend.total;
  return (
    <>
      <PageHeader title="Goals" description="Money for goals is set aside before your daily budget is calculated." />
      <GoalsView
        goals={goals}
        plans={s.goals.map((g) => ({ id: g.id, monthlyNeeded: g.monthlyNeeded, monthsLeft: g.monthsLeft, progress: g.progress, targetTry: g.targetTry, savedTry: g.savedTry }))}
        suggestedEmergency={Math.round((avgExpense * 6) / 1000) * 1000}
        baseline={s.income.baseline}
      />
    </>
  );
}

/** Data loads inside Suspense so navigations render the skeleton instantly. */
export default function GoalsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GoalsContent />
    </Suspense>
  );
}
