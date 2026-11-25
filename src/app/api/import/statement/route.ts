import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUser } from "@/lib/auth";
import { hashRaw, ingestTransactions } from "@/lib/ingest";

export const maxDuration = 120;

const Tx = z.object({
  bank: z.enum(["isbank", "vakifbank", "ziraat", "papara", "other"]),
  occurredAt: z.string(),
  amount: z.number(),
  currency: z.enum(["TRY", "USD", "EUR", "GBP", "XAU"]),
  description: z.string().max(300),
  merchant: z.string().max(120).nullable(),
  counterparty: z.string().max(120).nullable(),
  cardLast4: z.string().nullable(),
  balanceAfter: z.number().nullable(),
  installments: z.number().int().nullable(),
  kindHint: z.enum(["cash", "transfer", "income", "fee"]).nullable(),
  confidence: z.number(),
});
const Body = z.object({
  accountId: z.string().uuid().nullable(),
  fileName: z.string().max(200).optional(),
  transactions: z.array(Tx).max(5000),
});

/** Import rows the browser already parsed from a CSV / Excel statement (or the PDF preview). */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { accountId, transactions, fileName } = parsed.data;

  const res = await ingestTransactions(
    user.db,
    user.userId,
    transactions.map((tx) => ({
      tx,
      // identical statement line imported twice -> same hash -> skipped
      rawHash: hashRaw(`stmt|${accountId}|${tx.occurredAt.slice(0, 10)}|${tx.amount}|${tx.description}`),
    })),
    { source: "statement", accountId },
  );
  await user.db.from("ingest_events").insert({
    user_id: user.userId,
    source: "statement",
    raw: fileName ?? "statement upload",
    status: res.errors.length && !res.inserted.length ? "failed" : "parsed",
    reason: `${res.inserted.length} imported, ${res.duplicates} duplicates skipped${res.errors.length ? `; ${res.errors.join("; ")}` : ""}`,
  });
  return NextResponse.json({ inserted: res.inserted.length, duplicates: res.duplicates, errors: res.errors });
}
