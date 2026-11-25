import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/app-shell";
import { TransactionsView } from "@/components/transactions-view";
import { requireUser } from "@/lib/auth";
import type { Transaction } from "@/lib/db-types";
import { loadBasics } from "@/lib/data";

export const metadata = { title: "Activity" };

const currentMonth = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7);

async function TransactionsContent({ searchParams }: PageProps<"/transactions">) {
  const { db, userId } = await requireUser();
  const sp = await searchParams;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();
  const review = sp.view === "review";
  const { categories, accounts } = await loadBasics(db, userId);

  let query = db.from("transactions").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(2000);
  if (review) query = query.eq("status", "review");
  else {
    const [y, m] = month.split("-").map(Number);
    const start = `${month}-01T00:00:00+03:00`;
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    query = query.gte("occurred_at", start).lt("occurred_at", `${next}-01T00:00:00+03:00`);
  }
  const { data } = await query;
  const { count: reviewCount } = await db.from("transactions").select("id", { count: "exact", head: true }).eq("status", "review");

  return (
    <>
      <PageHeader title={review ? "Needs review" : "Activity"} description={review ? "Low-confidence imports — check and confirm them" : "Everything that moved in and out"} />
      <TransactionsView
        transactions={(data ?? []) as Transaction[]}
        categories={categories}
        accounts={accounts}
        month={month}
        review={review}
        reviewCount={reviewCount ?? 0}
        initialCategory={typeof sp.category === "string" ? sp.category : "all"}
      />
    </>
  );
}

/** Data loads inside Suspense so navigations render the skeleton instantly. */
export default function TransactionsPage(props: PageProps<"/transactions">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TransactionsContent {...props} />
    </Suspense>
  );
}
