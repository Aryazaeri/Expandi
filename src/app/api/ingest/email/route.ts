import { NextResponse } from "next/server";
import { aiExtractStatementPdf, isAiConfigured } from "@/lib/ai";
import { hashRaw, ingestTransactions } from "@/lib/ingest";
import { detectBank } from "@/lib/parsers/message";
import { createAdminClient } from "@/lib/supabase/admin";
import { htmlToText } from "@/lib/text";
import { pick, processMessage, readBody, toDate, userFromToken } from "@/lib/webhook";

export const maxDuration = 300;

interface Attachment {
  name?: string;
  mimeType?: string;
  data?: string; // base64
}

/**
 * POST /api/ingest/email  (used by the Google Apps Script in docs/email-setup.md)
 * Body: { from, subject, body | html, date, attachments?: [{ name, mimeType, data(base64) }] }
 */
export async function POST(req: Request) {
  const admin = createAdminClient();
  const user = await userFromToken(admin, req);
  if (!user) return NextResponse.json({ error: "Invalid or missing token" }, { status: 401 });

  const body = await readBody(req);
  const from = pick(body, "from", "sender");
  const subject = pick(body, "subject");
  const html = pick(body, "html");
  const plain = pick(body, "body", "text", "plain");
  const text = plain ?? (html ? htmlToText(html) : "");
  const receivedAt = toDate(pick(body, "date", "receivedAt"));
  const out: Record<string, unknown> = {};

  if (text) out.message = await processMessage(admin, user, "email", { text: text.slice(0, 6000), sender: from, subject, receivedAt });

  // e-statement PDFs (ekstre) -> Claude extracts every line
  const pdfs = ((body.attachments as Attachment[] | undefined) ?? []).filter(
    (a) => a.data && (a.mimeType === "application/pdf" || a.name?.toLowerCase().endsWith(".pdf")),
  );
  if (pdfs.length) {
    if (!user.ai_enabled || !isAiConfigured()) {
      out.attachments = { skipped: "PDF statements need the AI advisor enabled (ANTHROPIC_API_KEY)" };
    } else {
      const bank = detectBank(from, `${subject ?? ""} ${text}`);
      const reports = [];
      for (const pdf of pdfs.slice(0, 3)) {
        const hash = hashRaw(pdf.data!.slice(0, 20000));
        const { data: seen } = await admin.from("ingest_events").select("id").eq("user_id", user.id).eq("raw", `pdf:${hash}`).maybeSingle();
        if (seen) {
          reports.push({ name: pdf.name, status: "duplicate" });
          continue;
        }
        try {
          const txs = await aiExtractStatementPdf(pdf.data!, bank);
          const res = await ingestTransactions(admin, user.id, txs.map((tx) => ({ tx })), { source: "statement" });
          await admin.from("ingest_events").insert({
            user_id: user.id, source: "statement", sender: from, raw: `pdf:${hash}`, status: "ai_parsed",
            reason: `${pdf.name}: ${res.inserted.length} new, ${res.duplicates} duplicates`,
          });
          reports.push({ name: pdf.name, inserted: res.inserted.length, duplicates: res.duplicates, errors: res.errors });
        } catch (e) {
          const msg = (e as Error).message;
          await admin.from("ingest_events").insert({
            user_id: user.id, source: "statement", sender: from, raw: `pdf:${hash}`, status: "failed",
            reason: `${pdf.name}: ${msg}${/password|encrypt/i.test(msg) ? " (password-protected PDF?)" : ""}`,
          });
          reports.push({ name: pdf.name, error: msg });
        }
      }
      out.attachments = reports;
    }
  }
  return NextResponse.json(out);
}
