# Expandi — your money, automatically

A personal finance dashboard and spending advisor for life in Türkiye. Transactions from **İşbank, VakıfBank, Ziraat and Papara** flow in automatically from the SMS and e-mails your banks already send you, and the app tells you every day how much you can safely spend.

Built with Next.js 16, shadcn/ui (Base UI), Supabase and Claude. It works on phones (installable as an app from the browser's "Add to Home Screen") and on desktop.

## What it does

- **Daily "safe to spend"**: income baseline − fixed costs − goal savings, spread over the days left in the month. It's capped by your real account balances when you've entered them.
- **Built for irregular income**: the baseline is the lower of your 6-month median and mean income. Income above it is treated as a bonus for your goals.
- **Inflation-aware**: compares against inflation-adjusted averages, grows TRY goals with inflation, and flags idle lira. Tracks USD, EUR and gold holdings at TCMB and market rates.
- **Taksit-aware**: purchases paid in installments are spread over their months.
- **Automatic categorization**: a Turkish merchant dictionary (Migros, A101, BİM, Yemeksepeti, Trendyol, Shell, Turkcell, …) plus rules it learns when you re-categorize something, plus optional AI.
- **AI advisor chat** (Claude): "Can I afford a ₺15.000 phone this month?", using your real numbers.
- **Goals, budgets, recurring-payment detection, net worth.**

## How transactions get in

Turkish open banking (BKM GEÇİT) is only open to companies licensed by TCMB as account-information providers, so an individual app can't log into your bank. Expandi uses the channels you already have instead:

| Channel | Setup | Latency |
|---|---|---|
| **SMS**: iPhone Shortcuts automation, or an Android forwarder app | 5 minutes, once | seconds |
| **E-mail**: Google Apps Script in your own Gmail forwards bank notifications and PDF e-statements | 5 minutes, once | ≤ 15 min |
| **Statements**: upload Excel/CSV (or PDF with AI) from your bank app | per upload | — |
| Paste SMS | for testing / catching up | — |

The step-by-step guides, with your token filled in, are on the **Import** page of the app.

The same purchase arriving by SMS *and* e-mail *and* statement is recorded once. Messages the parser isn't sure about go to **Activity → Needs review**. Messages it can't read appear in **Import → Log** and, if AI is enabled, are retried with Claude.

> The bank SMS formats in `src/lib/parsers/message.ts` are written from typical wording. If one of your banks' messages lands in the review queue or the log, paste a few anonymized examples into `src/lib/parsers/message.test.ts` and tune the patterns.

## Setup

### 1. Supabase

1. Create a project (Frankfurt `eu-central-1` is closest to Türkiye).
2. Run `supabase/migrations/20261125000000_init.sql` in the SQL editor (or `supabase db push`).
3. Copy the project URL, the **publishable** key and the **secret** key from *Project Settings → API Keys*.
4. *Authentication → URL Configuration*: set the Site URL to your deployed URL, and add `https://<your-domain>/auth/callback` to the redirect URLs.

### 2. Environment variables

See `.env.example`.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Browser/server key (RLS applies) |
| `SUPABASE_SECRET_KEY` | yes | **Server only.** SMS/e-mail webhooks + FX cron |
| `CRON_SECRET` | yes | Protects `/api/cron/fx` (Vercel Cron sends it) |
| `ANTHROPIC_API_KEY` | optional | AI chat, PDF statements, AI categorization, SMS fallback parser |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-opus-5-5` |

### 3. Deploy on Vercel

Import the GitHub repo, add the variables above, and deploy. `vercel.json` schedules a daily exchange-rate refresh.

### Local development

```bash
npm install
cp .env.example .env.local   # fill in
npm run dev
npm test                      # parser + advisor engine tests
```

## Security notes

- Every table has row-level security (`user_id = auth.uid()`).
- The webhooks authenticate with a per-user 48-character token, which you can rotate from Settings/Import. The service-role key is used only in those handlers and the cron job, and every query there filters by `user_id`.
- The Gmail script runs in *your* Google account. Expandi never receives Gmail access.
- `fx_rates` is shared across users of one deployment. This is meant as a single-person app; if you host it for others, restrict manual rate edits.
- The AI advisor gives general information, not licensed investment advice.

## Project layout

```
src/lib/parsers/      SMS / e-mail / statement parsers (+ tests)
src/lib/categories.ts default categories + Turkish merchant keywords
src/lib/advisor/      rules engine (+ tests)
src/lib/ingest.ts     account matching, FX conversion, dedup, categorization
src/lib/ai.ts         Claude: fallback parsing, PDF extraction, categorization
src/app/api/          webhooks, imports, chat, cron
src/app/(app)/        dashboard, activity, advisor, goals, import, settings
supabase/migrations/  schema + RLS + new-user seed
```
