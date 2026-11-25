"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteAccount, deleteRule, refreshFxNow, saveAccount, saveProfile, setCategoryBudget, setCategoryFixed, setManualRate, signOut,
  type ActionResult,
} from "@/app/actions";
import { CategoryIcon } from "@/components/category-icon";
import { Money } from "@/components/money";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Rates } from "@/lib/advisor/engine";
import type { Account, Category, Profile } from "@/lib/db-types";
import { CURRENCIES, parseAmount, type Currency } from "@/lib/money";
import { BANKS, bankName, type BankCode } from "@/lib/parsers/types";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Current account (vadesiz)" },
  { value: "credit_card", label: "Credit card" },
  { value: "wallet", label: "Wallet (Papara etc.)" },
  { value: "savings", label: "Savings / deposit (vadeli)" },
  { value: "investment", label: "Investments (FX, gold, funds)" },
  { value: "cash", label: "Cash" },
];

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok || r.message) toast.success(ok ?? r.message);
      } else toast.error(r.error);
    });
  return { pending, run };
}

export function SettingsView({
  profile, accounts, categories, rates, ratesAsOf, rules, aiConfigured,
}: {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  rates: Rates;
  ratesAsOf: string | null;
  rules: { id: string; pattern: string; category_id: string }[];
  aiConfigured: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProfileCard profile={profile} aiConfigured={aiConfigured} />
      <AccountsCard accounts={accounts} />
      <BudgetsCard categories={categories} />
      <div className="space-y-4">
        <RatesCard rates={rates} asOf={ratesAsOf} />
        <RulesCard rules={rules} categories={categories} />
        <form action={signOut}>
          <Button variant="outline" type="submit" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function ProfileCard({ profile, aiConfigured }: { profile: Profile; aiConfigured: boolean }) {
  const { pending, run } = useAction();
  const [f, setF] = useState({
    full_name: profile.full_name ?? "",
    income_baseline: profile.income_baseline ? String(profile.income_baseline) : "",
    annual_inflation: String(Math.round(Number(profile.annual_inflation) * 1000) / 10),
    emergency_months: String(profile.emergency_months),
    min_savings_rate: String(Math.round(Number(profile.min_savings_rate) * 100)),
    ai_enabled: profile.ai_enabled,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Advisor settings</CardTitle>
        <CardDescription>How your safe-to-spend number is calculated</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="fn">Your full name (as on bank transfers)</Label>
          <Input id="fn" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} placeholder="AD SOYAD" />
          <p className="text-xs text-muted-foreground">Transfers from/to your own name are treated as moving money, not income or spending.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ib">Monthly income baseline (₺)</Label>
          <Input id="ib" inputMode="decimal" value={f.income_baseline} onChange={(e) => setF({ ...f, income_baseline: e.target.value })} placeholder="Automatic (conservative average)" />
          <p className="text-xs text-muted-foreground">Leave empty to use the lower of your median and average income over the last 6 months.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="inf">Inflation %/yr</Label>
            <Input id="inf" inputMode="decimal" value={f.annual_inflation} onChange={(e) => setF({ ...f, annual_inflation: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em">Emergency months</Label>
            <Input id="em" inputMode="numeric" value={f.emergency_months} onChange={(e) => setF({ ...f, emergency_months: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sr">Min. savings %</Label>
            <Input id="sr" inputMode="numeric" value={f.min_savings_rate} onChange={(e) => setF({ ...f, min_savings_rate: e.target.value })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.ai_enabled} onCheckedChange={(v) => setF({ ...f, ai_enabled: v })} />
          AI features (chat, PDF statements, smart categorization)
        </label>
        {!aiConfigured && <p className="text-xs text-warning">ANTHROPIC_API_KEY isn&apos;t set on the server, so AI features are unavailable.</p>}
        <Button
          disabled={pending}
          onClick={() =>
            run(() =>
              saveProfile({
                full_name: f.full_name.trim() || null,
                income_baseline: parseAmount(f.income_baseline),
                annual_inflation: (parseAmount(f.annual_inflation) ?? 30) / 100,
                emergency_months: Number(f.emergency_months) || 0,
                min_savings_rate: (parseAmount(f.min_savings_rate) ?? 10) / 100,
                ai_enabled: f.ai_enabled,
              }),
            )
          }
        >
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}

function AccountsCard({ accounts }: { accounts: Account[] }) {
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>Add balances to unlock net worth and a cash-aware daily budget</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => setEditing({ bank: "other", type: "checking", currency: "TRY", include_in_net_worth: true })}>
            <Plus /> Add
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="divide-y">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: BANKS.find((b) => b.code === a.bank)?.color }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {a.name}
                {a.last4 && <span className="text-muted-foreground"> •{a.last4}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {bankName(a.bank)} · {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label}
                {a.balance_updated_at && ` · updated ${new Date(a.balance_updated_at).toLocaleDateString("tr-TR")}`}
              </div>
            </div>
            <Money amount={a.balance === null ? null : Number(a.balance)} currency={a.currency} className="text-sm" />
            <Button variant="ghost" size="icon-sm" aria-label="Edit account" onClick={() => setEditing(a)}>
              <Pencil />
            </Button>
          </div>
        ))}
      </CardContent>
      <AccountDialog account={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function AccountDialog({ account, onClose }: { account: Partial<Account> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<Account> & { balanceText?: string }>({});
  const [last, setLast] = useState<Partial<Account> | null>(null);
  const { pending, run } = useAction();
  if (account !== last) {
    setLast(account);
    setF({ ...(account ?? {}), balanceText: account?.balance === null || account?.balance === undefined ? "" : String(account.balance) });
  }
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{f.id ? "Edit account" : "Add account"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="an">Name</Label>
            <Input id="an" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="İşbank Maximum" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Bank</Label>
              <SimpleSelect value={f.bank ?? "other"} onChange={(v) => setF({ ...f, bank: v as BankCode })} options={BANKS.map((b) => ({ value: b.code, label: b.short }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <SimpleSelect value={f.type ?? "checking"} onChange={(v) => setF({ ...f, type: v as Account["type"] })} options={ACCOUNT_TYPES} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <SimpleSelect value={f.currency ?? "TRY"} onChange={(v) => setF({ ...f, currency: v as Currency })} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code === "XAU" ? "Gold g" : c.code }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ab">Balance</Label>
              <Input id="ab" inputMode="decimal" value={f.balanceText ?? ""} onChange={(e) => setF({ ...f, balanceText: e.target.value })} placeholder={f.type === "credit_card" ? "-12.500" : "0"} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="al4">Card last 4</Label>
              <Input id="al4" inputMode="numeric" maxLength={4} value={f.last4 ?? ""} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Credit card debt is a negative balance. Card last-4 lets SMS from that card land in this account.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.include_in_net_worth ?? true} onCheckedChange={(v) => setF({ ...f, include_in_net_worth: v })} /> Include in net worth
          </label>
        </div>
        <DialogFooter>
          {f.id && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirm("Remove this account? Its transactions are kept.") && run(async () => {
                const r = await deleteAccount(f.id!);
                if (r.ok) onClose();
                return r;
              })}
            >
              <Trash2 /> Remove
            </Button>
          )}
          <Button
            disabled={pending || !f.name}
            onClick={() =>
              run(async () => {
                const r = await saveAccount({
                  id: f.id,
                  name: f.name!,
                  bank: f.bank ?? "other",
                  type: f.type ?? "checking",
                  currency: f.currency ?? "TRY",
                  last4: f.last4 && /^\d{4}$/.test(f.last4) ? f.last4 : null,
                  balance: f.balanceText?.trim() ? parseAmount(f.balanceText) : null,
                  include_in_net_worth: f.include_in_net_worth ?? true,
                });
                if (r.ok) onClose();
                return r;
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

function BudgetsCard({ categories }: { categories: Category[] }) {
  const { run } = useAction();
  const expense = categories.filter((c) => c.kind === "expense");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets & fixed costs</CardTitle>
        <CardDescription>
          Optional monthly limits per category. &quot;Fixed&quot; categories (rent, bills) are reserved before your daily budget.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {expense.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2">
            <CategoryIcon icon={c.icon} color={c.color} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch size="sm" checked={c.is_fixed} onCheckedChange={(v) => run(() => setCategoryFixed(c.id, v))} /> fixed
            </label>
            <Input
              className="w-28 text-right"
              inputMode="decimal"
              placeholder="No limit"
              defaultValue={c.monthly_budget ? String(Number(c.monthly_budget)) : ""}
              onBlur={(e) => {
                const v = parseAmount(e.target.value);
                if ((v ?? null) !== (c.monthly_budget === null ? null : Number(c.monthly_budget))) run(() => setCategoryBudget(c.id, v), "Budget saved");
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RatesCard({ rates, asOf }: { rates: Rates; asOf: string | null }) {
  const { pending, run } = useAction();
  const [manual, setManual] = useState<{ code: "USD" | "EUR" | "GBP" | "XAU"; rate: string }>({ code: "USD", rate: "" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange rates</CardTitle>
        <CardDescription>{asOf ? `As of ${asOf} · TCMB & market gold price, refreshed daily` : "No rates yet"}</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(refreshFxNow)}>
            <RefreshCw /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(["USD", "EUR", "GBP", "XAU"] as const).map((c) => (
            <div key={c} className="rounded-lg bg-muted/60 px-3 py-2">
              <div className="text-xs text-muted-foreground">{c === "XAU" ? "Gold (gram)" : c}</div>
              <Money amount={rates[c] ?? null} className="font-semibold" />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <SimpleSelect className="w-24" value={manual.code} onChange={(v) => setManual({ ...manual, code: v as typeof manual.code })} options={["USD", "EUR", "GBP", "XAU"].map((c) => ({ value: c, label: c }))} />
          <Input inputMode="decimal" placeholder="Manual rate in ₺" value={manual.rate} onChange={(e) => setManual({ ...manual, rate: e.target.value })} />
          <Button variant="secondary" disabled={pending || !manual.rate} onClick={() => run(() => setManualRate(manual.code, parseAmount(manual.rate) ?? 0))}>
            Set
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RulesCard({ rules, categories }: { rules: { id: string; pattern: string; category_id: string }[]; categories: Category[] }) {
  const { run } = useAction();
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Learned rules</CardTitle>
        <CardDescription>Created when you re-categorize a transaction</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {rules.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
            <code className="rounded bg-muted px-1.5 text-xs">{r.pattern}</code>
            <span className="text-muted-foreground">→</span>
            <span className="flex-1 truncate">{name.get(r.category_id)}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Delete rule" onClick={() => run(() => deleteRule(r.id))}>
              <Trash2 />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
