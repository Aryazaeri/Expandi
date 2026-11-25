/**
 * Parser for bank SMS and notification e-mails from İşbank, VakıfBank,
 * Ziraat and Papara (and a generic fallback for any Turkish bank).
 *
 * Banks change their wording often, so instead of one brittle regex per
 * message type this works in layers:
 *   1. detect the bank (sender ID / e-mail domain / text)
 *   2. throw away OTPs, promos, declined transactions, statement summaries
 *   3. find the transaction amount (skipping limit / balance / points amounts)
 *   4. decide the direction (money in vs. out) from Turkish keywords
 *   5. pull out the merchant or counterparty, date, card number, installments
 * Anything with low confidence is sent to the AI fallback / review queue.
 */
import { detectCurrency, parseAmount, type Currency } from "@/lib/money";
import { normalize, titleCase } from "@/lib/text";
import type { BankCode, InboundMessage, KindHint, ParseResult, ParsedTransaction } from "./types";

// ---------------------------------------------------------------- bank detection

const BANK_PATTERNS: [BankCode, RegExp][] = [
  ["isbank", /IS ?BANK|ISBANKASI|ISCEP|MAXIMUM ?KART|MAXIPUAN|\bISBANK\b|ISBANK\.COM/],
  ["vakifbank", /VAKIF ?BANK|VAKIFBANK|VAKIFBANK\.COM|WORLD ?PUAN|\bVAKIF\b/],
  ["ziraat", /ZIRAAT|BANKKART|ZIRAATBANK\.COM/],
  ["papara", /PAPARA/],
];

export function detectBank(sender: string | null | undefined, text: string): BankCode {
  const s = normalize(sender ?? "");
  for (const [code, re] of BANK_PATTERNS) if (s && re.test(s)) return code;
  const t = normalize(text);
  for (const [code, re] of BANK_PATTERNS) if (re.test(t)) return code;
  return "other";
}

// ---------------------------------------------------------------- filters

const OTP_RE =
  /SIFRE(NIZ|SI)?\b|DOGRULAMA KODU|ONAY KODU|TEK KULLANIMLIK|GUVENLIK KODU|3D SECURE|3D ?SIFRE|\bOTP\b|KIMSEYLE PAYLASMAYINIZ|PAYLASMAYIN/;
const DECLINED_RE =
  /REDDEDIL|BASARISIZ|ONAYLANMA(DI|MISTIR)|GERCEKLESME(DI|MISTIR)|YETERSIZ (BAKIYE|LIMIT)|IPTAL EDILEMEDI|ISLEM YAPILAMADI/;
const STATEMENT_SUMMARY_RE = /SON ODEME TARIHI|DONEM BORCU|EKSTRE(NIZ)? (KESILDI|TUTARI|HAZIR)|ASGARI ODEME TUTARI/;
const PROMO_RE = /KAMPANYA|FIRSAT|KAZANIN|KAZAN\b|INDIRIM|HEDIYE|CEKILIS|PUAN KAZAN|DETAYLI BILGI ICIN|RET YAZ/;
const TX_VERB_RE =
  /HARCAMA|ALISVERIS|CEKIL|CEKIM|ODEME|YATIRIL|GONDER|GELEN|CIKIS|ISLEM YAPIL|TAHSIL|IADE|YUKLEN|BORCLAN|HESABINIZA|HESABINIZDAN|ODEDIN|YAPTIN|TRANSFER|HAVALE|\bEFT\b|\bFAST\b/;

/** Past-tense verbs that only appear when a transaction actually happened. */
const COMPLETED_RE =
  /YAPILMISTIR|YAPILDI|YAPTIN|EDILMISTIR|EDILDI|CEKILMISTIR|CEKILDI|YATIRILMISTIR|YATIRILDI|GONDERILMISTIR|GONDERILDI|GONDERDI|YUKLENDI|YUKLENMISTIR|ODEDIN|BORCLANDI/;

// ---------------------------------------------------------------- amounts

const AMOUNT_RE =
  /(?:(TL|TRY|USD|EUR|GBP|₺|\$|€)\s*)?(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])\s*(TL|TRY|USD|EUR|GBP|₺|\$|€)?/g;

const NOT_TX_AMOUNT_CONTEXT =
  /LIMIT|BAKIYE|KULLANILABILIR|BORCUNUZ|TOPLAM BORC|KALAN BORC|ASGARI|PUAN|BONUS|CHIP ?PARA|PARAPUAN|MIL\b|KOMISYON(SUZ)?$/;
const BALANCE_CONTEXT = /BAKIYE|GUNCEL BAKIYE|HESAP BAKIYE/;

interface AmountHit {
  value: number;
  currency: Currency;
  index: number;
  end: number;
  context: string;
}

function findAmounts(n: string): AmountHit[] {
  const hits: AmountHit[] = [];
  let prevEnd = 0;
  for (const m of n.matchAll(AMOUNT_RE)) {
    const cur = m[1] ?? m[3];
    if (!cur) continue; // a bare number (date part, card no, OTP...) — not money
    const value = parseAmount(m[2]);
    if (value === null || value === 0) continue;
    const index = m.index ?? 0;
    const context = n.slice(Math.max(prevEnd, index - 40), index);
    hits.push({ value, currency: detectCurrency(cur), index, end: index + m[0].length, context });
    prevEnd = index + m[0].length;
  }
  return hits;
}

// ---------------------------------------------------------------- direction

function detectDirection(n: string): { sign: 1 | -1; sure: boolean } {
  if (/\bIADE\b|IADE (EDILDI|EDILMISTIR|YAPILDI|ISLEMI)/.test(n)) return { sign: 1, sure: true };
  const toYou = /HESABINIZA|HESABINA (\S+ )?(YATIRIL|GELDI)|ADINIZA|KARTINIZA (\S+ )?(YATIRIL|IADE)/.test(n);
  const fromYou = /HESABINIZDAN|HESABINDAN/.test(n);
  if (toYou && !fromYou) return { sign: 1, sure: true };
  if (fromYou && !toYou) return { sign: -1, sure: true };

  const strongDebit = /HARCAMA|ALISVERIS|CEKILDI|CEKILMISTIR|CEKIM|ODEDIN|ODEME YAPIL|BORCLANDI|TAHSIL EDIL|CIKISI?\b/.test(n);
  const strongCredit =
    /YATIRILDI|YATIRILMISTIR|GELEN (HAVALE|EFT|FAST|TRANSFER|PARA)|TARAFINDAN .*GONDERIL|SANA .*GONDERDI|YUKLENDI|YUKLENMISTIR|ALACAK KAYDI|MAAS (YATTI|ODEMESI)/.test(
      n,
    );
  if (strongCredit && !strongDebit) return { sign: 1, sure: true };
  if (strongDebit) return { sign: -1, sure: true };
  if (/KARTINIZ(LA|DAN)|KART(I)? ILE|ISLEM YAPILMISTIR|ISYERI/.test(n)) return { sign: -1, sure: true };
  if (/GONDERILDI|GONDERILMISTIR|GONDERDINIZ/.test(n)) return { sign: -1, sure: false };
  return { sign: -1, sure: false };
}

// ---------------------------------------------------------------- kind hints

function detectKind(n: string, sign: 1 | -1): KindHint {
  if (/\bATM\b|NAKIT CEKIM|PARA CEKME|PARA CEKILDI|NAKIT AVANS/.test(n)) return "cash";
  if (
    /KREDI KARTI (BORC )?ODEME|KART BORCU|KK ODEME|KART ODEMESI|VIRMAN|KENDI HESAB|HESAPLARINIZ ARASI|DOVIZ (ALIS|SATIS)|ALTIN (ALIS|SATIS)|YATIRIM HESAB|PAPARA'?(YA|YE)? ?YUKLE|BAKIYE YUKLE/.test(
      n,
    )
  )
    return "transfer";
  if (/FAIZ|KOMISYON|MASRAF|\bBSMV\b|\bKKDF\b|YILLIK (KART )?UCRET|HESAP ISLETIM/.test(n) && sign < 0) return "fee";
  if (sign > 0 && /\bMAAS\b|MAAS ODEME|UCRET ODEME|HAKEDIS/.test(n)) return "income";
  return null;
}

// ---------------------------------------------------------------- dates

/** Build an ISO timestamp in Turkey time (UTC+3, no DST since 2016). */
export function trIso(y: number, mo: number, d: number, h = 12, mi = 0): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+03:00`;
}

function findDate(n: string, fallback: Date): string {
  const m = n.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[^\d]{0,12}?(\d{1,2})[:.](\d{2})(?![.,]\d))?/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) {
      const h = m[4] ? Number(m[4]) : 12;
      const mi = m[5] ? Number(m[5]) : 0;
      return trIso(y, mo, d, h < 24 ? h : 12, mi < 60 ? mi : 0);
    }
  }
  // "14:32'de" without a date -> received day with that time
  const t = n.match(/\b(\d{1,2}):(\d{2})\b/);
  const tr = new Date(fallback.getTime() + 3 * 3600_000); // shift to TR wall clock
  return trIso(
    tr.getUTCFullYear(),
    tr.getUTCMonth() + 1,
    tr.getUTCDate(),
    t ? Number(t[1]) % 24 : tr.getUTCHours(),
    t ? Number(t[2]) % 60 : tr.getUTCMinutes(),
  );
}

// ---------------------------------------------------------------- merchant / counterparty

const NOISE_RE =
  /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\b\d{1,2}[:.]\d{2}\b('?(DA|DE|TA|TE))?|\bTARIHINDE\b|\bTARIHLI\b|\bSAAT\b|\*+\d{2,4}|\b\d{4}\b ILE BITEN|\bILE BITEN\b|\bNOLU\b|\bNO'?LU\b|\bSAYIN\b|\bMUSTERIMIZ\b|\bKARTINIZ(LA|DAN|IN)?\b|\bBANKKART'?(INIZ)?(LA|DAN)?\b|\bKREDI KARTI\b|\bBANKA KARTI\b|\bPAPARA KART(I)?\b|\bKART(I)? ILE\b|\bMAXIMUM\b|\bWORLD\b/g;

function cleanName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.replace(NOISE_RE, " ");
  s = s.replace(/['’](DA|DE|TA|TE|DAN|DEN|TAN|TEN)\b/g, "");
  s = s.replace(/[^\p{L}\d&.\-/ ]/gu, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(VE|ILE|DE|DA|-|\.)\s+/g, "").replace(/\s+(VE|ILE|-|\.)$/g, "");
  if (s.length < 2 || /^\d+$/.test(s)) return null;
  // Keep the last 6 words — the merchant is usually right before the keyword
  const words = s.split(" ");
  return titleCase(words.slice(-6).join(" ")).slice(0, 60);
}

function findMerchant(n: string): string | null {
  const patterns: RegExp[] = [
    // "... MIGROS TICARET isyerinden ..." / "... isyerinde ..."
    /(?:^|[.,:;]|KARTINIZ(?:LA|DAN)|KART(?:I)? ILE|BANKKART\S*|TARIHINDE|\d{2}:\d{2}\S*)\s*(.{2,70}?)\s+(?:ISYERI(?:NDEN|NDE)?|IS YERI(?:NDEN|NDE)?|FIRMASI(?:NDAN|NA)|MAGAZASI(?:NDAN|NDA)?|UYE ISYERI)/,
    // "... SHELL ISTANBUL'da 1.500,00 TL"
    /(?:KARTINIZ(?:LA|DAN)|KART(?:I)? ILE|BANKKART\S*|TARIHINDE|\d{2}:\d{2}\S*)\s+(.{2,60}?)['’](?:DA|DE|TA|TE)\s+[\d.,]+\s*(?:TL|TRY|USD|EUR)/,
    // "MIGROS'tan 100,00 TL" / "TRENDYOL'dan"
    /(?:^|\s)([A-Z0-9&.\- ]{2,40}?)['’](?:DAN|DEN|TAN|TEN)\s+[\d.,]+\s*(?:TL|TRY|USD|EUR)/,
    // "Isyeri: MIGROS" / "Uye Isyeri Adi: X"
    /(?:ISYERI|UYE ISYERI(?: ADI)?|MERCHANT)\s*:\s*([^\n,;]{2,60})/,
    // "Aciklama: X"
    /ACIKLAMA\s*:\s*([^\n;]{2,60})/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    const name = cleanName(m?.[1]);
    if (name) return name;
  }
  return null;
}

function findCounterparty(n: string): string | null {
  const patterns: RegExp[] = [
    /(?:GONDEREN|GONDERICI|ALICI(?: ADI)?|ALICI HESAP SAHIBI)\s*:?\s*([A-Z][A-Z .]{2,40}?)(?=\s*(?:[,;:\n]|TARAFINDAN|IBAN|HESAB|TUTAR|\d|$))/,
    /([A-Z][A-Z .]{2,40}?)\s+TARAFINDAN/,
    /([A-Z][A-Z .]{2,40}?)\s+SANA\s/,
    /([A-Z][A-Z .]{2,40}?)\s+(?:ADLI KISIYE|KISISINE|HESABINA)\s/,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (!m) continue;
    // Keep the trailing name words, drop leading sentence words
    const words = m[1]
      .trim()
      .split(" ")
      .filter((w) => !/^(HESABINIZA|HESABINIZDAN|TL|TRY|TARIHINDE|ILE|FAST|EFT|HAVALE|VE|PAPARA|KULLANICISI|SAYIN)$/.test(w));
    const name = cleanName(words.slice(-4).join(" "));
    if (name) return name;
  }
  return null;
}

function describe(n: string, kind: KindHint, sign: 1 | -1): string {
  if (/\bFAST\b/.test(n)) return sign > 0 ? "Incoming FAST transfer" : "Outgoing FAST transfer";
  if (/\bEFT\b/.test(n)) return sign > 0 ? "Incoming EFT" : "Outgoing EFT";
  if (/HAVALE/.test(n)) return sign > 0 ? "Incoming transfer" : "Outgoing transfer";
  if (kind === "cash") return "ATM cash withdrawal";
  if (/FATURA/.test(n)) return "Bill payment";
  if (/IADE/.test(n)) return "Refund";
  if (/YUKLEN/.test(n)) return "Top-up";
  return sign > 0 ? "Incoming payment" : "Card payment";
}

// ---------------------------------------------------------------- main

export function parseBankMessage(msg: InboundMessage): ParseResult {
  const original = [msg.subject, msg.text].filter(Boolean).join(" \n ");
  const n = normalize(original);
  const bank = detectBank(msg.sender, original);

  if (!n) return { status: "ignored", reason: "empty message", bank };
  if (OTP_RE.test(n)) return { status: "ignored", reason: "one-time password / verification code", bank };
  if (DECLINED_RE.test(n)) return { status: "ignored", reason: "declined or failed transaction", bank };
  if (STATEMENT_SUMMARY_RE.test(n) && !/HARCAMA|ISYERI/.test(n))
    return { status: "ignored", reason: "statement summary (not a single transaction)", bank };
  if (PROMO_RE.test(n) && !COMPLETED_RE.test(n)) return { status: "ignored", reason: "promotion / marketing message", bank };

  const amounts = findAmounts(n);
  if (amounts.length === 0) {
    return TX_VERB_RE.test(n)
      ? { status: "failed", reason: "transaction-like message but no amount found", bank }
      : { status: "ignored", reason: "no transaction amount", bank };
  }
  const txAmount = amounts.find((a) => !NOT_TX_AMOUNT_CONTEXT.test(a.context));
  if (!txAmount) return { status: "ignored", reason: "only balance / limit / points amounts", bank };
  const balance = amounts.find((a) => a !== txAmount && BALANCE_CONTEXT.test(a.context));

  const dir = detectDirection(n);
  const kindHint = detectKind(n, dir.sign);
  const merchant = findMerchant(n);
  const counterparty = merchant ? null : findCounterparty(n);
  const card = n.match(/(\d{4})\s*(?:ILE BITEN|NOLU|NO'?LU|SONLU)|\*{2,}\s?(\d{4})|X{2,}(\d{4})/);
  const inst = n.match(/(\d{1,2})\s*TAKSIT/);
  const received = msg.receivedAt ? new Date(msg.receivedAt) : new Date();

  let confidence = 0.5;
  if (dir.sure) confidence += 0.25;
  if (merchant || counterparty || kindHint) confidence += 0.2;
  if (TX_VERB_RE.test(n)) confidence += 0.05;
  if (bank === "other") confidence -= 0.1;

  const tx: ParsedTransaction = {
    bank,
    occurredAt: findDate(n, Number.isNaN(received.getTime()) ? new Date() : received),
    amount: Math.abs(txAmount.value) * dir.sign,
    currency: txAmount.currency,
    description: merchant ?? counterparty ?? describe(n, kindHint, dir.sign),
    merchant,
    counterparty,
    cardLast4: card ? (card[1] ?? card[2] ?? card[3]) : null,
    balanceAfter: balance ? balance.value : null,
    installments: inst && Number(inst[1]) > 1 ? Number(inst[1]) : null,
    kindHint,
    confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)),
  };
  return { status: "parsed", tx };
}
