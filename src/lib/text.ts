/**
 * Turkish-aware text helpers. Bank SMS/e-mails mix "İ/ı/Ş/ğ" with plain ASCII
 * ("kartinizla" vs "kartınızla"), so everything is matched on a folded,
 * upper-case ASCII form.
 */
const TR_MAP: Record<string, string> = {
  ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
  â: "a", Â: "A", î: "i", Î: "I", û: "u", Û: "U",
};

export function foldTurkish(s: string): string {
  return s.replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, (c) => TR_MAP[c] ?? c);
}

/** Fold Turkish chars, upper-case and collapse whitespace. */
export function normalize(s: string): string {
  return foldTurkish(s).toUpperCase().replace(/\s+/g, " ").trim();
}

/** Title-case a merchant like "MIGROS TICARET A.S." -> "Migros Ticaret A.S." */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/.&(])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Strip HTML tags/entities from e-mail bodies. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
