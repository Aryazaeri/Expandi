import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { Insight } from "@/lib/advisor/engine";
import { cn } from "@/lib/utils";

const STYLE = {
  good: { icon: CircleCheck, cls: "text-positive bg-positive/10" },
  info: { icon: Info, cls: "text-chart-4 bg-chart-4/10" },
  warn: { icon: TriangleAlert, cls: "text-warning bg-warning/15" },
} as const;

export function InsightItem({ insight, className }: { insight: Insight; className?: string }) {
  const s = STYLE[insight.severity];
  const Icon = s.icon;
  return (
    <div className={cn("flex gap-3", className)}>
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", s.cls)}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{insight.title}</div>
        <p className="text-sm text-muted-foreground">{insight.body}</p>
      </div>
    </div>
  );
}
