import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import type { ParsedTransaction } from "@/lib/parsers/types";
import { detectBank, trIso } from "@/lib/parsers/message";
import type { BankCode } from "@/lib/parsers/types";
import type { Currency } from "@/lib/money";

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
/** Server-side fallback: if the model declines for policy reasons, the API retries on a fallback model. */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export const isAiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// ---------------------------------------------------------------- SMS / e-mail fallback parser

const MessageSchema = z.object({
  is_transaction: z.boolean().describe("false for OTPs, ads, declined payments, statement summaries"),
  amount: z.number().describe("transaction amount, always positive"),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
  direction: z.enum(["out", "in"]).describe("out = money left the customer's account/card"),
  date: z.string().describe("YYYY-MM-DD, or empty if not in the text"),
  time: z.string().describe("HH:MM 24h, or empty"),
  merchant: z.string().describe("shop / payee / sender name, empty if none"),
  description: z.string().describe("short English description, e.g. 'Card payment at Migros'"),
  card_last4: z.string().describe("last 4 digits of card if present, else empty"),
  installments: z.number().int().describe("number of installments (taksit) if any, else 1"),
  kind: z.enum(["purchase", "cash_withdrawal", "transfer_between_own_accounts", "card_debt_payment", "salary", "refund", "fee", "transfer", "other"]),
});

export async function aiParseMessage(text: string, sender: string | null, receivedAt: Date): Promise<ParsedTransaction | null> {
  const res = await anthropic().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 2000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(MessageSchema) },
    system:
      "You extract a single bank transaction from Turkish bank SMS / notification e-mails (İşbank, VakıfBank, Ziraat, Papara and others). Turkish number format: 1.234,56 = one thousand two hundred thirty-four point fifty-six. Ignore available limit / balance / points amounts — only the transaction amount counts.",
    messages: [{ role: "user", content: `Sender: ${sender ?? "unknown"}\nReceived: ${receivedAt.toISOString()}\n\n${text}` }],
  });
  if (res.stop_reason === "refusal") return null;
  const p = res.parsed_output;
  if (!p || !p.is_transaction || !(p.amount > 0)) return null;
  const [y, mo, d] = (p.date || "").split("-").map(Number);
  const [h, mi] = (p.time || "").split(":").map(Number);
  const tr = new Date(receivedAt.getTime() + 3 * 3600_000);
  const occurredAt =
    y && mo && d
      ? trIso(y, mo, d, Number.isFinite(h) ? h : 12, Number.isFinite(mi) ? mi : 0)
      : trIso(tr.getUTCFullYear(), tr.getUTCMonth() + 1, tr.getUTCDate(), tr.getUTCHours(), tr.getUTCMinutes());
  const sign = p.direction === "in" || p.kind === "refund" || p.kind === "salary" ? 1 : -1;
  return {
    bank: detectBank(sender, text),
    occurredAt,
    amount: sign * p.amount,
    currency: p.currency as Currency,
    description: p.merchant || p.description,
    merchant: p.merchant || null,
    counterparty: null,
    cardLast4: /^\d{4}$/.test(p.card_last4) ? p.card_last4 : null,
    balanceAfter: null,
    installments: p.installments > 1 ? p.installments : null,
    kindHint:
      p.kind === "cash_withdrawal" ? "cash"
      : p.kind === "transfer_between_own_accounts" || p.kind === "card_debt_payment" ? "transfer"
      : p.kind === "salary" ? "income"
      : p.kind === "fee" ? "fee"
      : null,
    confidence: 0.75,
  };
}

// ---------------------------------------------------------------- PDF statements

const StatementSchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD"),
      description: z.string(),
      merchant: z.string().describe("cleaned merchant / counterparty name, empty if unclear"),
      amount: z.number().describe("signed: negative = spending / money out, positive = money in / refunds / payments to the card"),
      currency: z.enum(["TRY", "USD", "EUR", "GBP"]),
      installment_info: z.string().describe("e.g. '2/6' when the line is one installment of a taksitli purchase, else empty"),
    }),
  ),
});

export async function aiExtractStatementPdf(pdfBase64: string, bank: BankCode): Promise<ParsedTransaction[]> {
  const stream = anthropic().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 64000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(StatementSchema) },
    system:
      "You convert Turkish bank and credit-card statements (hesap ekstresi / kredi kartı ekstresi) into a list of transactions. Include every transaction line exactly once. Skip opening/closing balances, totals, minimum payment and summary lines. For credit-card statements, purchases are negative and payments to the card are positive.",
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: "Extract all transactions from this statement." },
        ],
      },
    ],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined to read this document.");
  if (msg.stop_reason === "max_tokens") throw new Error("Statement too long — split the PDF and try again.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = StatementSchema.parse(JSON.parse(text));
  return parsed.transactions
    .filter((t) => t.amount !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => {
      const [y, m, d] = t.date.split("-").map(Number);
      return {
        bank,
        occurredAt: trIso(y, m, d),
        amount: t.amount,
        currency: t.currency as Currency,
        description: t.description.slice(0, 120),
        merchant: t.merchant || null,
        counterparty: null,
        cardLast4: null,
        balanceAfter: null,
        installments: null,
        kindHint: null,
        confidence: 0.8,
      } satisfies ParsedTransaction;
    });
}

// ---------------------------------------------------------------- bulk categorization

export async function aiCategorize(
  items: { i: number; text: string; amount: number }[],
  categories: { slug: string; name: string; kind: string }[],
): Promise<Map<number, string>> {
  if (!items.length) return new Map();
  const slugs = categories.map((c) => c.slug) as [string, ...string[]];
  const Schema = z.object({ results: z.array(z.object({ i: z.number().int(), slug: z.enum(slugs) })) });
  const res = await anthropic().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
    system: `Categorize Turkish bank transactions. Categories:\n${categories.map((c) => `- ${c.slug}: ${c.name} (${c.kind})`).join("\n")}\nNegative amounts are spending, positive are money in. Use "other" / "other-income" only when nothing fits.`,
    messages: [{ role: "user", content: items.map((x) => `${x.i}\t${x.amount}\t${x.text}`).join("\n") }],
  });
  const out = new Map<number, string>();
  for (const r of res.parsed_output?.results ?? []) out.set(r.i, r.slug);
  return out;
}
