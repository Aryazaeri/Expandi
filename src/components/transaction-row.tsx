import { CategoryIcon } from "@/components/category-icon";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import type { Category, Transaction } from "@/lib/db-types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = { sms: "SMS", email: "E-mail", statement: "Statement", manual: "Manual", ai: "AI" };

export function TransactionRow({
  tx,
  category,
  accountName,
  showDate = false,
  className,
}: {
  tx: Pick<Transaction, "id" | "occurred_at" | "amount" | "currency" | "amount_try" | "description" | "merchant" | "counterparty" | "source" | "status" | "installments">;
  category?: Pick<Category, "name" | "icon" | "color" | "kind"> | null;
  accountName?: string | null;
  showDate?: boolean;
  className?: string;
}) {
  const time = new Date(tx.occurred_at).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    ...(showDate ? { day: "2-digit", month: "short" } : { hour: "2-digit", minute: "2-digit" }),
  });
  return (
    <div className={cn("flex items-center gap-3 py-2.5", className)}>
      <CategoryIcon icon={category?.icon} color={category?.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{tx.merchant || tx.counterparty || tx.description}</span>
          {tx.status === "review" && (
            <Badge variant="outline" className="shrink-0 border-warning/50 text-warning">
              review
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {category?.name ?? "Uncategorized"} · {accountName ? `${accountName} · ` : ""}
          {SOURCE_LABEL[tx.source] ?? tx.source} · {time}
          {tx.installments ? ` · ${tx.installments} taksit` : ""}
        </div>
      </div>
      <div className="text-right">
        <Money
          amount={Number(tx.amount)}
          currency={tx.currency}
          sign
          className={cn("font-medium", Number(tx.amount) > 0 && category?.kind !== "transfer" && "text-positive", category?.kind === "transfer" && "text-muted-foreground")}
        />
        {tx.currency !== "TRY" && (
          <div className="text-xs text-muted-foreground">
            <Money amount={Number(tx.amount_try)} />
          </div>
        )}
      </div>
    </div>
  );
}
