"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteTransaction, saveTransaction, setTransactionCategory } from "@/app/actions";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Account, Category, Transaction } from "@/lib/db-types";
import { CURRENCIES, type Currency } from "@/lib/money";
import { bankName } from "@/lib/parsers/types";

const toLocalInput = (iso: string) => {
  // datetime-local in Istanbul time
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => `${v}:00+03:00`;

export function categoryOptions(categories: Category[]) {
  const groupName = { expense: "Spending", income: "Income", transfer: "Not spending (transfers)" } as const;
  return categories.map((c) => ({ value: c.id, label: c.name, group: groupName[c.kind] }));
}

export function TransactionEditor({
  open,
  onOpenChange,
  tx,
  categories,
  accounts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tx: Transaction | null;
  categories: Category[];
  accounts: Account[];
}) {
  const isNew = !tx;
  const [form, setForm] = useState(() => initial(tx));
  const [learn, setLearn] = useState(true);
  const [pending, start] = useTransition();
  const [lastTx, setLastTx] = useState(tx);
  if (tx !== lastTx) {
    // reset the form when a different transaction is opened
    setLastTx(tx);
    setForm(initial(tx));
  }
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const categoryChanged = !isNew && form.category_id !== (tx?.category_id ?? "");

  function save() {
    const amount = Math.abs(Number(form.amount.replace(",", ".")));
    if (!amount || !form.description.trim()) {
      toast.error("Amount and description are required");
      return;
    }
    start(async () => {
      const res = await saveTransaction({
        id: tx?.id,
        occurred_at: fromLocalInput(form.occurred_at),
        amount: form.direction === "out" ? -amount : amount,
        currency: form.currency,
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
        category_id: form.category_id || null,
        account_id: form.account_id || null,
        installments: form.installments ? Number(form.installments) : null,
        notes: form.notes.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error);
      if (categoryChanged && learn && form.category_id && tx) {
        const r = await setTransactionCategory(tx.id, form.category_id, true);
        if (r.ok && r.message) toast.success(r.message);
      } else toast.success(res.message ?? "Saved");
      onOpenChange(false);
    });
  }

  function remove() {
    if (!tx || !confirm("Delete this transaction?")) return;
    start(async () => {
      const res = await deleteTransaction(tx.id);
      if (res.ok) {
        toast.success("Deleted");
        onOpenChange(false);
      } else toast.error(res.error);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isNew ? "Add transaction" : "Edit transaction"}</SheetTitle>
          {tx?.raw_text && <SheetDescription className="line-clamp-4 font-mono text-xs">{tx.raw_text}</SheetDescription>}
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={form.direction === "out" ? "default" : "outline"} onClick={() => set("direction", "out")}>
              Money out
            </Button>
            <Button variant={form.direction === "in" ? "default" : "outline"} onClick={() => set("direction", "in")}>
              Money in
            </Button>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="0,00" />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <SimpleSelect
                value={form.currency}
                onChange={(v) => set("currency", v as Currency)}
                options={CURRENCIES.map((c) => ({ value: c.code, label: c.code }))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="desc">Description</Label>
            <Input id="desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="merchant">Merchant</Label>
            <Input id="merchant" value={form.merchant} onChange={(e) => set("merchant", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <SimpleSelect value={form.category_id || null} onChange={(v) => set("category_id", v)} options={categoryOptions(categories)} placeholder="Uncategorized" />
            {categoryChanged && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={learn} onCheckedChange={setLearn} /> Always use this category for this merchant
              </label>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Account</Label>
            <SimpleSelect
              value={form.account_id || null}
              onChange={(v) => set("account_id", v)}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name}${a.last4 ? ` •${a.last4}` : ""} (${bankName(a.bank)})` }))}
              placeholder="No account"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="date">Date & time</Label>
              <Input id="date" type="datetime-local" value={form.occurred_at} onChange={(e) => set("occurred_at", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inst">Installments</Label>
              <Input id="inst" inputMode="numeric" placeholder="1" value={form.installments} onChange={(e) => set("installments", e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <SheetFooter className="flex-row gap-2">
          {!isNew && (
            <Button variant="destructive" onClick={remove} disabled={pending}>
              Delete
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={pending}>
            {pending ? "Saving…" : tx?.status === "review" ? "Confirm & save" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function initial(tx: Transaction | null) {
  return {
    direction: (tx && Number(tx.amount) > 0 ? "in" : "out") as "in" | "out",
    amount: tx ? String(Math.abs(Number(tx.amount))).replace(".", ",") : "",
    currency: (tx?.currency ?? "TRY") as Currency,
    description: tx?.description ?? "",
    merchant: tx?.merchant ?? "",
    category_id: tx?.category_id ?? "",
    account_id: tx?.account_id ?? "",
    occurred_at: toLocalInput(tx?.occurred_at ?? new Date().toISOString()),
    installments: tx?.installments ? String(tx.installments) : "",
    notes: tx?.notes ?? "",
  };
}
