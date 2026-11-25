import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { getUser } from "@/lib/auth";
import { AI_MODEL, anthropic, isAiConfigured } from "@/lib/ai";
import { loadAdvisor } from "@/lib/data";
import { bankName } from "@/lib/parsers/types";

export const maxDuration = 120;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40),
});

const INSTRUCTIONS = `You are Expandi, a friendly, practical personal-finance advisor for one person living in Türkiye.
You see their real numbers (below), computed from their bank SMS, e-mails and statements (İşbank, VakıfBank, Ziraat, Papara).

How to answer:
- Be concrete and use their numbers. Amounts in Turkish Lira formatted like ₺12.345. Keep answers short (a few sentences or a tight list) unless asked for detail.
- "Can I afford X?" questions: compare against today's safe-to-spend, the remaining flexible budget for the month, goal contributions and the emergency fund. Say yes / not yet / yes-if, and what it does to their goals. Suggest taksit (installments) only when it doesn't push next months over plan, and mention the real cost of interest.
- Their income is irregular: plan with the conservative baseline, treat any income above baseline as a bonus to direct at goals or the emergency fund.
- Inflation is high: when relevant, think in real (inflation-adjusted) terms; idle TRY cash loses value. You may describe common options (time deposits, money-market funds, FX, gold, BES) and their trade-offs, but you are not a licensed advisor — don't recommend specific securities, and say so briefly when giving investment-related views.
- If data looks incomplete (few transactions, no income, uncategorized spending), say what's missing and how to fix it in the app (Import page, Settings).
- Never invent transactions or numbers that aren't in the data.`;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!isAiConfigured()) return new Response("The AI advisor needs ANTHROPIC_API_KEY on the server.", { status: 400 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });

  const data = await loadAdvisor(user.db, user.userId);
  if (!data.profile?.ai_enabled) return new Response("AI advisor is turned off in Settings.", { status: 400 });

  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const accName = new Map(data.accounts.map((a) => [a.id, `${a.name} (${bankName(a.bank)})`]));
  const { daily: _daily, ...snapshot } = data.snapshot;
  void _daily;
  const context = {
    today: new Date().toISOString().slice(0, 10),
    snapshot,
    accounts: data.accounts.map((a) => ({ name: a.name, bank: bankName(a.bank), type: a.type, currency: a.currency, balance: a.balance })),
    fx_rates_try: data.rates,
    recent_transactions: data.transactions.slice(0, 80).map((t) => ({
      date: t.occurred_at.slice(0, 10),
      amount_try: Number(t.amount_try),
      what: t.merchant || t.description,
      category: t.category_id ? catName.get(t.category_id) : "uncategorized",
      account: t.account_id ? accName.get(t.account_id) : null,
      installments: t.installments ?? undefined,
    })),
  };

  const stream = anthropic().beta.messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: `<financial_data>\n${JSON.stringify(context)}\n</financial_data>`, cache_control: { type: "ephemeral" } },
    ],
    messages: parsed.data.messages as Anthropic.Beta.BetaMessageParam[],
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n_I can't help with that request._"));
        if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n\n_(answer cut off)_"));
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n_Error: ${(e as Error).message}_`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
