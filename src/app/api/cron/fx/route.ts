import { NextResponse } from "next/server";
import { refreshRates } from "@/lib/fx";
import { createAdminClient } from "@/lib/supabase/admin";


/** Daily FX refresh, called by Vercel Cron (see vercel.json) with Authorization: Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await refreshRates(createAdminClient());
  return NextResponse.json(result);
}
