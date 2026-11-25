import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiParseMessage, isAiConfigured } from "@/lib/ai";
import { hashRaw, ingestTransactions } from "@/lib/ingest";
import { parseBankMessage } from "@/lib/parsers/message";
import type { ParsedTransaction } from "@/lib/parsers/types";

export const webhooksConfigured = () => Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
export const notConfigured = () =>
  Response.json({ error: "Server is missing SUPABASE_SECRET_KEY — add it in your hosting environment variables." }, { status: 503 });

/** Find the user behind a webhook token (header, bearer or ?token=). */
export async function userFromToken(admin: SupabaseClient, req: Request): Promise<{ id: string; ai_enabled: boolean } | null> {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  const token =
    req.headers.get("x-ingest-token") ??
    (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null) ??
    url.searchParams.get("token");
  if (!token || token.length < 32) return null;
  const { data } = await admin.from("profiles").select("id, ai_enabled").eq("ingest_token", token).maybeSingle();
  return data;
}

/** Accept JSON, form-encoded or plain-text bodies — every SMS forwarder app sends something different. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (type.includes("application/json") || raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? { messages: j } : j;
    } catch {
      /* fall through */
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return { text: raw };
}

export const pick = (o: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
};

export function toDate(v: string | null): Date {
  if (!v) return new Date();
  const n = Number(v);
  // unix seconds / millis from Android forwarders
  const d = Number.isFinite(n) && v.length >= 10 ? new Date(v.length <= 10 ? n * 1000 : n) : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface MessageOutcome {
  status: "parsed" | "ai_parsed" | "ignored" | "failed" | "duplicate";
  reason?: string;
  transaction?: { id: string; description: string; amount: number };
}

/** Parse one SMS / e-mail body and store it. Logs every message to ingest_events (the review queue). */
export async function processMessage(
  admin: SupabaseClient,
  user: { id: string; ai_enabled: boolean },
  source: "sms" | "email",
  msg: { text: string; sender: string | null; subject?: string | null; receivedAt: Date },
): Promise<MessageOutcome> {
  const raw = [msg.subject, msg.text].filter(Boolean).join("\n").slice(0, 4000);
  const rawHash = hashRaw(`${msg.sender ?? ""}|${raw}`);
  const parsed = parseBankMessage({ text: msg.text, subject: msg.subject, sender: msg.sender, receivedAt: msg.receivedAt });

  let tx: ParsedTransaction | null = null;
  let outcome: MessageOutcome["status"] = "failed";
  let reason: string | undefined;

  if (parsed.status === "parsed" && parsed.tx.confidence >= 0.6) {
    tx = parsed.tx;
    outcome = "parsed";
  } else if (parsed.status === "ignored") {
    outcome = "ignored";
    reason = parsed.reason;
  } else if (user.ai_enabled && isAiConfigured()) {
    try {
      tx = await aiParseMessage(msg.text, msg.sender, msg.receivedAt);
      outcome = tx ? "ai_parsed" : "ignored";
      reason = tx ? undefined : "AI: not a transaction";
    } catch (e) {
      reason = `AI fallback failed: ${(e as Error).message}`;
    }
    // AI unavailable -> keep the low-confidence regex result for review
    if (!tx && parsed.status === "parsed") {
      tx = parsed.tx;
      outcome = "parsed";
    }
  } else if (parsed.status === "parsed") {
    tx = parsed.tx; // stored with status "review"
    outcome = "parsed";
  } else {
    reason = parsed.reason;
  }

  let transaction: MessageOutcome["transaction"];
  if (tx) {
    const res = await ingestTransactions(admin, user.id, [{ tx, rawText: raw, rawHash }], { source });
    if (res.inserted[0]) transaction = res.inserted[0];
    else if (res.duplicates) {
      outcome = "duplicate";
      reason = "already imported (same message or same purchase from another channel)";
    } else {
      outcome = "failed";
      reason = res.errors.join("; ") || "insert failed";
    }
  }

  await admin.from("ingest_events").insert({
    user_id: user.id,
    source,
    sender: msg.sender,
    raw,
    status: outcome,
    reason: reason ?? null,
    transaction_id: transaction?.id ?? null,
  });
  return { status: outcome, reason, transaction };
}
