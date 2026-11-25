import { formatMoney, type Currency } from "@/lib/money";
import { cn } from "@/lib/utils";

export function Money({
  amount,
  currency = "TRY",
  colored = false,
  sign = false,
  compact = false,
  decimals,
  className,
}: {
  amount: number | null | undefined;
  currency?: Currency | string;
  colored?: boolean;
  sign?: boolean;
  compact?: boolean;
  decimals?: number;
  className?: string;
}) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return <span className={className}>—</span>;
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        colored && amount > 0 && "text-positive",
        colored && amount < 0 && "text-foreground",
        className,
      )}
    >
      {formatMoney(amount, currency, { sign, compact, decimals })}
    </span>
  );
}
