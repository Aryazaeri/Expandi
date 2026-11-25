import {
  ArrowLeftRight, Banknote, Bike, Car, Circle, CircleDashed, Clapperboard, Coffee, CreditCard, Gift, GraduationCap,
  HeartPulse, Home, Landmark, Percent, PiggyBank, Plane, Repeat, ShoppingBag, ShoppingBasket, Sparkles, TrendingUp,
  Undo2, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Banknote, Bike, Car, Circle, CircleDashed, Clapperboard, Coffee, CreditCard, Gift, GraduationCap,
  HeartPulse, Home, Landmark, Percent, PiggyBank, Plane, Repeat, ShoppingBag, ShoppingBasket, Sparkles, TrendingUp,
  Undo2, Wallet, Zap,
};

export function CategoryIcon({
  icon,
  color,
  className,
  size = "md",
}: {
  icon?: string | null;
  color?: string | null;
  className?: string;
  size?: "sm" | "md";
}) {
  const Icon = (icon && ICONS[icon]) || CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "sm" ? "size-7" : "size-9",
        className,
      )}
      style={{ backgroundColor: `${color ?? "#71717a"}22`, color: color ?? "#71717a" }}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} />
    </span>
  );
}
