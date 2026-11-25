"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatMoney } from "@/lib/money";

const paceConfig = {
  spent: { label: "Spent", color: "var(--chart-1)" },
  plan: { label: "Plan", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function SpendingPaceChart({ data }: { data: { day: number; spent: number | null; plan: number | null }[] }) {
  return (
    <ChartContainer config={paceConfig} className="aspect-auto h-[200px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillSpent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-spent)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-spent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
        <YAxis hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => `Day ${p?.[0]?.payload?.day}`}
              formatter={(v, name) => (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{paceConfig[name as keyof typeof paceConfig]?.label}</span>
                  <span className="tabular font-medium">{formatMoney(Number(v), "TRY", { decimals: 0 })}</span>
                </div>
              )}
            />
          }
        />
        <Line dataKey="plan" type="linear" stroke="var(--color-plan)" strokeDasharray="5 5" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        <Area dataKey="spent" type="monotone" stroke="var(--color-spent)" fill="url(#fillSpent)" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}

const historyConfig = {
  income: { label: "Income", color: "var(--chart-1)" },
  expense: { label: "Spending", color: "var(--chart-3)" },
} satisfies ChartConfig;

const monthLabel = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en", { month: "short" });
};

export function HistoryChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  return (
    <ChartContainer config={historyConfig} className="aspect-auto h-[200px] w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} />
        <YAxis hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => monthLabel(String(p?.[0]?.payload?.month ?? ""))}
              formatter={(v, name) => (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{historyConfig[name as keyof typeof historyConfig]?.label}</span>
                  <span className="tabular font-medium">{formatMoney(Number(v), "TRY", { decimals: 0 })}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
