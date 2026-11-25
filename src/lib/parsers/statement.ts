/**
 * Turns the rows of an exported bank statement (CSV / XLS / XLSX — already
 * read into a 2-D array on the client) into transactions. Turkish banks put
 * a few lines of account info above the table, so we scan for the header row.
 */
import { parseAmount } from "@/lib/money";
import { normalize, titleCase } from "@/lib/text";
import { trIso } from "./message";
import type { BankCode, ParsedTransaction } from "./types";

export type Cell = string | number | Date | boolean | null | undefined;

export interface ColumnMap {
  headerRow: number;
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

const H = {
  date: /^(ISLEM )?TARIH(I)?( SAAT)?$|^TARIH|^ISLEM TARIHI|^VALOR|^DATE/,
  description: /ACIKLAMA|^ISLEM$|ISLEM DETAY|ISYERI|^DETAY|DESCRIPTION|ISLEM ADI|ISLEM TURU/,
  amount: /^(ISLEM )?TUTAR|^TUTAR|^MIKTAR|AMOUNT|^ISLEM MIKTARI/,
  debit: /^BORC|^CIKAN|^CIKIS|^HARCAMA/,
  credit: /^ALACAK|^GIREN|^GIRIS|^YATAN/,
  balance: /BAKIYE|BALANCE/,
};

function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString();
  return String(c).trim();
}

export function detectColumns(rows: Cell[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const headers = rows[r].map((c) => normalize(cellText(c)));
    const find = (re: RegExp, exclude: number[] = []) =>
      headers.findIndex((h, i) => h && !exclude.includes(i) && re.test(h));
    const date = find(H.date);
    if (date < 0) continue;
    const balance = find(H.balance);
    const amount = find(H.amount, [balance]);
    const debit = find(H.debit, [balance, amount]);
    const credit = find(H.credit, [balance, amount]);
    const description = find(H.description, [date, amount, balance, debit, credit]);
    if (description < 0) continue;
    if (amount < 0 && (debit < 0 || credit < 0)) continue;
    return {
      headerRow: r,
      date,
      description,
      amount: amount >= 0 ? amount : null,
      debit: amount < 0 ? debit : null,
      credit: amount < 0 ? credit : null,
      balance: balance >= 0 ? balance : null,
    };
  }
  return null;
}

export function parseCellDate(c: Cell): string | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) {
    // SheetJS dates are local-midnight; keep the calendar day
    return trIso(c.getFullYear(), c.getMonth() + 1, c.getDate(), c.getHours() || 12, c.getMinutes());
  }
  if (typeof c === "number" && c > 20000 && c < 80000) {
    // Excel serial date
    const d = new Date(Math.round((c - 25569) * 86400_000));
    return trIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = cellText(c);
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T-]+(\d{1,2})[:.](\d{2}))?/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return trIso(y, Number(m[2]), Number(m[1]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return trIso(Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0);
  return null;
}

function num(c: Cell): number | null {
  if (typeof c === "number") return c;
  return parseAmount(cellText(c));
}

export interface StatementOptions {
  bank: BankCode;
  /** Credit-card statements list spending as positive numbers. */
  creditCard: boolean;
  columns?: ColumnMap;
}

export function parseStatementRows(rows: Cell[][], opts: StatementOptions): {
  columns: ColumnMap | null;
  transactions: ParsedTransaction[];
  skipped: number;
} {
  const columns = opts.columns ?? detectColumns(rows);
  if (!columns) return { columns: null, transactions: [], skipped: rows.length };
  const out: ParsedTransaction[] = [];
  let skipped = 0;
  for (const row of rows.slice(columns.headerRow + 1)) {
    const date = parseCellDate(row[columns.date]);
    const desc = cellText(row[columns.description]);
    let amount: number | null = null;
    if (columns.amount !== null) {
      amount = num(row[columns.amount]);
      if (amount !== null && opts.creditCard) amount = -amount;
    } else {
      const d = columns.debit !== null ? num(row[columns.debit]) : null;
      const c = columns.credit !== null ? num(row[columns.credit]) : null;
      if (d) amount = -Math.abs(d);
      else if (c) amount = Math.abs(c);
    }
    if (!date || amount === null || amount === 0 || !desc) {
      skipped++;
      continue;
    }
    const n = normalize(desc);
    const inst = n.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*TAKSIT|TAKSIT\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
    out.push({
      bank: opts.bank,
      occurredAt: date,
      amount,
      currency: "TRY",
      description: titleCase(desc.replace(/\s+/g, " ")).slice(0, 120),
      merchant: titleCase(desc.replace(/\s+/g, " ").split(/\s{2,}|\s-\s/)[0]).slice(0, 60),
      counterparty: null,
      cardLast4: null,
      balanceAfter: columns.balance !== null ? num(row[columns.balance]) : null,
      // "TAKSIT 2/6" rows are single installments already — don't spread again
      installments: null,
      kindHint: /\bATM\b|NAKIT/.test(n)
        ? "cash"
        : /KREDI KARTI ODEME|KART BORC|VIRMAN|HESAPLAR ARASI|ODEMENIZ ICIN TESEKKUR|ONCEKI DONEM/.test(n)
          ? "transfer"
          : /FAIZ|BSMV|KKDF|MASRAF|KOMISYON/.test(n) && amount < 0
            ? "fee"
            : null,
      confidence: inst ? 0.85 : 0.95,
    });
  }
  return { columns, transactions: out, skipped };
}
