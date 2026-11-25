"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, ShieldCheck, Target } from "lucide-react";
import { toast } from "sonner";
import { addToGoal, deleteGoal, saveGoal } from "@/app/actions";
import { Money } from "@/components/money";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Goal } from "@/lib/db-types";
import { CURRENCIES, parseAmount, type Currency } from "@/lib/money";

interface Plan {
  id: string;
  monthlyNeeded: number;
  monthsLeft: number;
  progress: number;
  targetTry: number;
  savedTry: number;
}

export function GoalsView({ goals, plans, suggestedEmergency, baseline }: { goals: Goal[]; plans: Plan[]; suggestedEmergency: number; baseline: number | null }) {
  const [editing, setEditing] = useState<Partial<Goal> | null>(null);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const totalMonthly = plans.reduce((a, p) => a + p.monthlyNeeded, 0);
  const hasEmergency = goals.some((g) => g.is_emergency_fund);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Reserving <Money amount={totalMonthly} decimals={0} className="font-medium text-foreground" />/month
          {baseline ? <> · {Math.round((totalMonthly / baseline) * 100)}% of your baseline income</> : null}
        </p>
        <Button onClick={() => setEditing({ currency: "TRY", saved_amount: 0, is_emergency_fund: false })}>
          <Plus /> New goal
        </Button>
      </div>

      {!hasEmergency && (
        <Card className="border-brand/40 bg-brand/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand" /> Start with an emergency fund
            </CardTitle>
            <CardDescription>
              With irregular income, ~6 months of expenses keeps a slow month from turning into credit-card debt. Keeping part of it in gold or FX
              protects it from inflation.
            </CardDescription>
            <CardAction>
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    name: "Emergency fund",
                    target_amount: suggestedEmergency || 100000,
                    saved_amount: 0,
                    currency: "TRY",
                    is_emergency_fund: true,
                    target_date: new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
                  })
                }
              >
                Add
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {goals.map((g) => {
          const p = planById.get(g.id);
          return (
            <Card key={g.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {g.is_emergency_fund ? <ShieldCheck className="size-4 text-brand" /> : <Target className="size-4 text-brand" />}
                  {g.name}
                </CardTitle>
                <CardDescription>
                  <Money amount={Number(g.saved_amount)} currency={g.currency} decimals={0} /> of{" "}
                  <Money amount={Number(g.target_amount)} currency={g.currency} decimals={0} />
                  {g.target_date ? ` · by ${new Date(g.target_date).toLocaleDateString("en", { month: "short", year: "numeric" })}` : ""}
                </CardDescription>
                <CardAction>
                  <Button variant="ghost" size="icon" aria-label="Edit goal" onClick={() => setEditing(g)}>
                    <Pencil />
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(p?.progress ?? 0) * 100}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{Math.round((p?.progress ?? 0) * 100)}% saved</span>
                  <span>
                    <Money amount={p?.monthlyNeeded ?? 0} decimals={0} />
                    <span className="text-muted-foreground">/mo · {p?.monthsLeft} mo left</span>
                  </span>
                </div>
                <QuickAdd goal={g} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {goals.length > 0 && (
        <p className="text-xs text-muted-foreground">
          TRY goals are grown by the inflation rate from Settings so the monthly amount keeps up with prices. Goals in USD, EUR or gold are converted
          at today&apos;s rate.
        </p>
      )}

      <GoalDialog goal={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function QuickAdd({ goal }: { goal: Goal }) {
  const [v, setV] = useState("");
  const [pending, start] = useTransition();
  const submit = (sign: 1 | -1) => {
    const n = parseAmount(v);
    if (!n) return;
    start(async () => {
      const r = await addToGoal(goal.id, sign * Math.abs(n));
      if (r.ok) {
        setV("");
        toast.success(sign > 0 ? "Added to goal" : "Withdrawn");
      } else toast.error(r.error);
    });
  };
  return (
    <div className="flex gap-2">
      <Input inputMode="decimal" placeholder={`Amount (${goal.currency})`} value={v} onChange={(e) => setV(e.target.value)} />
      <Button variant="secondary" disabled={pending || !v} onClick={() => submit(1)}>
        Add
      </Button>
      <Button variant="ghost" disabled={pending || !v} onClick={() => submit(-1)}>
        Withdraw
      </Button>
    </div>
  );
}

function GoalDialog({ goal, onClose }: { goal: Partial<Goal> | null; onClose: () => void }) {
  const [form, setForm] = useState<Partial<Goal>>({});
  const [last, setLast] = useState<Partial<Goal> | null>(null);
  const [pending, start] = useTransition();
  if (goal !== last) {
    setLast(goal);
    setForm(goal ?? {});
  }
  const set = <K extends keyof Goal>(k: K, v: Goal[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={!!goal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit goal" : "New goal"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="gname">Name</Label>
            <Input id="gname" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="New laptop, trip to Japan…" />
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="gtarget">Target</Label>
              <Input
                id="gtarget"
                inputMode="decimal"
                value={form.target_amount ?? ""}
                onChange={(e) => set("target_amount", (parseAmount(e.target.value) ?? 0) as number)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <SimpleSelect value={form.currency ?? "TRY"} onChange={(v) => set("currency", v as Currency)} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code === "XAU" ? "Gold (g)" : c.code }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="gsaved">Already saved</Label>
              <Input id="gsaved" inputMode="decimal" value={form.saved_amount ?? 0} onChange={(e) => set("saved_amount", (parseAmount(e.target.value) ?? 0) as number)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gdate">Target date</Label>
              <Input id="gdate" type="date" value={form.target_date ?? ""} onChange={(e) => set("target_date", e.target.value || null)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!form.is_emergency_fund} onCheckedChange={(v) => set("is_emergency_fund", v)} /> This is my emergency fund
          </label>
        </div>
        <DialogFooter>
          {form.id && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                confirm("Delete this goal?") &&
                start(async () => {
                  const r = await deleteGoal(form.id!);
                  if (r.ok) onClose();
                })
              }
            >
              Delete
            </Button>
          )}
          <Button
            disabled={pending || !form.name || !form.target_amount}
            onClick={() =>
              start(async () => {
                const r = await saveGoal({
                  id: form.id,
                  name: form.name!,
                  target_amount: Number(form.target_amount),
                  saved_amount: Number(form.saved_amount ?? 0),
                  currency: form.currency ?? "TRY",
                  target_date: form.target_date || null,
                  is_emergency_fund: !!form.is_emergency_fund,
                });
                if (r.ok) {
                  toast.success("Goal saved");
                  onClose();
                } else toast.error(r.error);
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
