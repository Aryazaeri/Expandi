import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import { PageHeader } from "@/components/app-shell";
import { SettingsView } from "@/components/settings-view";
import { isAiConfigured } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { loadBasics } from "@/lib/data";
import { getRates } from "@/lib/fx";

export const metadata = { title: "Settings" };

async function SettingsContent() {
  const { db, userId, email } = await requireUser();
  const [basics, fx, rules] = await Promise.all([
    loadBasics(db, userId),
    getRates(db),
    db.from("category_rules").select("id, pattern, category_id").eq("user_id", userId).order("pattern"),
  ]);
  return (
    <>
      <PageHeader title="Settings" description={email ?? undefined} />
      <SettingsView
        profile={basics.profile!}
        accounts={basics.accounts}
        categories={basics.categories}
        rates={fx.rates}
        ratesAsOf={fx.asOf}
        rules={rules.data ?? []}
        aiConfigured={isAiConfigured()}
      />
    </>
  );
}

/** Data loads inside Suspense so navigations render the skeleton instantly. */
export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}
