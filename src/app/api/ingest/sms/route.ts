import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notConfigured, pick, processMessage, readBody, toDate, userFromToken, webhooksConfigured } from "@/lib/webhook";

export const maxDuration = 60;

/**
 * POST /api/ingest/sms   (header x-ingest-token: <your token>, or ?token=)
 * Body: { "text": "...", "sender": "ISBANK", "receivedAt": "..." }
 *   or  { "messages": [ ... ] } for a batch, or a plain-text body.
 */
export async function POST(req: Request) {
  if (!webhooksConfigured()) return notConfigured();
  const admin = createAdminClient();
  const user = await userFromToken(admin, req);
  if (!user) return NextResponse.json({ error: "Invalid or missing token" }, { status: 401 });

  const body = await readBody(req);
  const list = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : [body];
  if (list.length > 200) return NextResponse.json({ error: "Max 200 messages per request" }, { status: 413 });

  const results = [];
  for (const m of list) {
    const text = pick(m, "text", "message", "body", "msg", "content", "sms");
    if (!text) {
      results.push({ status: "failed", reason: "no text field" });
      continue;
    }
    results.push(
      await processMessage(admin, user, "sms", {
        text,
        sender: pick(m, "sender", "from", "address", "phone", "number"),
        receivedAt: toDate(pick(m, "receivedAt", "received_at", "date", "timestamp", "time", "sentStamp", "receivedStamp")),
      }),
    );
  }
  return NextResponse.json(Array.isArray(body.messages) ? { results } : results[0]);
}
