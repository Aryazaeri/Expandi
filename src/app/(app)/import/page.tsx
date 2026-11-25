import { headers } from "next/headers";
import { PageHeader } from "@/components/app-shell";
import { ImportView } from "@/components/import-view";
import { requireUser } from "@/lib/auth";
import type { IngestEvent } from "@/lib/db-types";
import { loadBasics } from "@/lib/data";
import { isAiConfigured } from "@/lib/ai";

export const metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  const { db, userId } = await requireUser();
  const [{ profile, accounts }, events, h] = await Promise.all([
    loadBasics(db, userId),
    db.from("ingest_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`;

  return (
    <>
      <PageHeader title="Import" description="Connect your banks once — new transactions arrive automatically." />
      <ImportView
        token={profile?.ingest_token ?? ""}
        siteUrl={siteUrl}
        accounts={accounts}
        events={(events.data ?? []) as IngestEvent[]}
        aiAvailable={isAiConfigured() && !!profile?.ai_enabled}
        initialTab={typeof sp.tab === "string" ? sp.tab : "auto"}
      />
    </>
  );
}
