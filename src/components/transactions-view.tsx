"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { aiCategorizeUncategorized, confirmAllReview } from "@/app/actions";
import { Money } from "@/components/money";
import { SimpleSelect } from "@/components/simple-select";
import { TransactionEditor, categoryOptions } from "@/components/transaction-editor";
import { TransactionRow } from "@/components/transaction-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Account, Category, Transaction } from "@/lib/db-types";
import { normalize } from "@/lib/text";
import { cn } from "@/lib/utils";

function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const idx = y * 12 + mo - 1 + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function TransactionsView({
  transactions,
  categories,
  accounts,
  month,
  review,
  reviewCount,
  initialCategory,
}: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  month: string;
  review: boolean;
  reviewCount: number;
  initialCategory: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [account, setAccount] = useState("all");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  const filtered = useMemo(() => {
    const nq = normalize(q);
    return transactions.filter((t) => {
      if (category === "none" ? t.category_id : category !== "all" && t.category_id !== category) return false;
      if (account !== "all" && t.account_id !== account) return false;
      if (nq && !normalize(`${t.merchant ?? ""} ${t.counterparty ?? ""} ${t.description} ${t.notes ?? ""}`).includes(nq)) return false;
      return true;
    });
  }, [transactions, q, category, account]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const day = new Date(t.occurred_at).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
      map.set(day, [...(map.get(day) ?? []), t]);
    }
    return [...map.entries()];
  }, [filtered]);

  const totals = useMemo(() => {
    let out = 0;
    let inn = 0;
    for (const t of filtered) {
      if (t.category_id && catById.get(t.category_id)?.kind === "transfer") continue;
      if (Number(t.amount_try) < 0) out += -Number(t.amount_try);
      else inn += Number(t.amount_try);
    }
    return { out, inn };
  }, [filtered, catById]);

  const uncategorized = transactions.filter((t) => !t.category_id).length;
  const monthLabel = new Date(`${month}-15T00:00:00Z`).toLocaleString("en", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!review && (
          <div className="flex items-center rounded-lg border">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => router.push(`/transactions?month=${shiftMonth(month, -1)}`)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{monthLabel}</span>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => router.push(`/transactions?month=${shiftMonth(month, 1)}`)}>
              <ChevronRight />
            </Button>
          </div>
        )}
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search merchant, note…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <SimpleSelect
          className="w-44"
          value={category}
          onChange={setCategory}
          options={[{ value: "all", label: "All categories" }, { value: "none", label: "Uncategorized" }, ...categoryOptions(categories)]}
        />
        <SimpleSelect
          className="w-40"
          value={account}
          onChange={setAccount}
          options={[{ value: "all", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus /> Add
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {review ? (
          <>
            <Link href="/transactions" className={buttonVariants({ variant: "outline", size: "sm" })}>
              ← All activity
            </Link>
            {transactions.length > 0 && (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
                const r = await confirmAllReview();
                if (r.ok) toast.success("All confirmed");
              })}>
                Confirm all {transactions.length}
              </Button>
            )}
          </>
        ) : (
          reviewCount > 0 && (
            <Link href="/transactions?view=review" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-warning/50 text-warning")}>
              {reviewCount} need review
            </Link>
          )
        )}
        {uncategorized > 0 && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await aiCategorizeUncategorized();
            if (r.ok) toast.success(r.message ?? "Done");
            else toast.error(r.error);
          })}>
            <Sparkles /> {pending ? "Categorizing…" : `AI-categorize ${uncategorized}`}
          </Button>
        )}
        <span className="ml-auto self-center text-muted-foreground">
          Out <Money amount={totals.out} decimals={0} className="text-foreground" /> · In{" "}
          <Money amount={totals.inn} decimals={0} className="text-positive" />
        </span>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No transactions here. <Link href="/import" className="underline">Import some</Link> or add one manually.
          </CardContent>
        </Card>
      ) : (
        groups.map(([day, txs]) => {
          const dayTotal = txs.reduce((a, t) => a + (t.category_id && catById.get(t.category_id)?.kind === "transfer" ? 0 : Number(t.amount_try)), 0);
          return (
            <section key={day}>
              <div className="mb-1 flex justify-between px-1 text-xs font-medium text-muted-foreground">
                <span>{new Date(`${day}T12:00:00+03:00`).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })}</span>
                <Money amount={dayTotal} sign decimals={0} />
              </div>
              <Card size="sm" className="py-0">
                <CardContent className="divide-y px-0">
                  {txs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="block w-full px-4 text-left transition-colors hover:bg-muted/50"
                      onClick={() => {
                        setEditing(t);
                        setOpen(true);
                      }}
                    >
                      <TransactionRow tx={t} category={t.category_id ? catById.get(t.category_id) : null} accountName={t.account_id ? accById.get(t.account_id) : null} />
                    </button>
                  ))}
                </CardContent>
              </Card>
            </section>
          );
        })
      )}

      <TransactionEditor open={open} onOpenChange={setOpen} tx={editing} categories={categories} accounts={accounts} />
    </div>
  );
}
