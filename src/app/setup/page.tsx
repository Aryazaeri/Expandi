import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata = { title: "Setup" };

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Almost there</h1>
      <p className="text-muted-foreground">Expandi needs a Supabase project. Set these environment variables (see README) and redeploy:</p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
ANTHROPIC_API_KEY=sk-ant-...        # optional: AI advisor
CRON_SECRET=<random string>          # daily FX refresh`}</pre>
    </div>
  );
}
