import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAmount, type Currency } from "@/lib/money";
import type { Rates } from "@/lib/advisor/engine";

type Code = Exclude<Currency, "TRY">;

/** Central Bank of the Republic of Türkiye daily indicative rates. */
async function fetchTcmb(): Promise<Partial<Record<Code, number>>> {
  const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TCMB ${res.status}`);
  const xml = await res.text();
  const out: Partial<Record<Code, number>> = {};
  for (const code of ["USD", "EUR", "GBP"] as const) {
    const m = xml.match(new RegExp(`Kod="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)</ForexSelling>`));
    if (m) out[code] = Number(m[1]);
  }
  return out;
}

/** Gram gold (gram altın) price in TRY from a public market feed. */
async function fetchGold(): Promise<number | null> {
  const res = await fetch("https://finans.truncgil.com/v4/today.json", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as Record<string, Record<string, unknown>>;
  const item = data["GRA"] ?? data["gram-altin"] ?? data["GRAMALTIN"];
  if (!item) return null;
  const v = item["Selling"] ?? item["Satış"] ?? item["satis"];
  return parseAmount(typeof v === "number" ? v : String(v ?? ""));
}

export async function fetchLiveRates(): Promise<{ rates: Partial<Record<Code, number>>; errors: string[] }> {
  const errors: string[] = [];
  const [tcmb, gold] = await Promise.allSettled([fetchTcmb(), fetchGold()]);
  const rates: Partial<Record<Code, number>> = {};
  if (tcmb.status === "fulfilled") Object.assign(rates, tcmb.value);
  else errors.push(`TCMB: ${String(tcmb.reason)}`);
  if (gold.status === "fulfilled" && gold.value) rates.XAU = gold.value;
  else errors.push("gold price unavailable");
  return { rates, errors };
}

export const todayTr = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** Latest stored rate per currency (any user can read fx_rates). */
export async function getRates(db: SupabaseClient): Promise<{ rates: Rates; asOf: string | null }> {
  const { data } = await db.from("fx_rates").select("code, rate, rate_date").order("rate_date", { ascending: false }).limit(60);
  const rates: Rates = { TRY: 1 };
  let asOf: string | null = null;
  for (const row of data ?? []) {
    const code = row.code as Code;
    if (rates[code] === undefined) {
      rates[code] = Number(row.rate);
      if (!asOf || row.rate_date > asOf) asOf = row.rate_date;
    }
  }
  return { rates, asOf };
}

/** Fetch today's rates and store them (needs the service-role client). */
export async function refreshRates(admin: SupabaseClient) {
  const { rates, errors } = await fetchLiveRates();
  const date = todayTr();
  const rows = Object.entries(rates).map(([code, rate]) => ({ code, rate, rate_date: date, source: code === "XAU" ? "truncgil" : "tcmb" }));
  if (rows.length) {
    const { error } = await admin.from("fx_rates").upsert(rows, { onConflict: "code,rate_date" });
    if (error) errors.push(error.message);
  }
  return { date, rates, errors };
}
