"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDownToLine, LayoutDashboard, List, LogOut, Moon, Settings, Sparkles, Sun, Target } from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "@/app/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Activity", icon: List },
  { href: "/advisor", label: "Advisor", icon: Sparkles },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/import", label: "Import", icon: ArrowDownToLine },
  { href: "/settings", label: "Settings", icon: Settings },
];
// Mobile bottom bar: 5 most-used items
const MOBILE_NAV = NAV.filter((n) => n.href !== "/settings");

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

export function AppShell({ children, account }: { children: React.ReactNode; account: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-lg font-bold text-brand-foreground">₺</span>
          <span className="text-lg font-semibold tracking-tight">Expandi</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive(pathname, href) && "bg-muted font-medium text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label === "Home" ? "Dashboard" : label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t pt-3">
          <span className="flex-1 truncate px-2 text-xs text-muted-foreground">{account}</span>
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <Link href="/" className="flex h-12 items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-base font-bold text-brand-foreground">₺</span>
            <span className="font-semibold tracking-tight">Expandi</span>
          </Link>
          <div className="flex items-center">
            <ThemeToggle />
            <Link href="/settings" aria-label="Settings" className={buttonVariants({ variant: "ghost", size: "icon" })}>
              <Settings />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {MOBILE_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground",
                isActive(pathname, href) && "text-foreground",
              )}
            >
              <Icon className={cn("size-5", isActive(pathname, href) && "text-brand")} />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-7">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
