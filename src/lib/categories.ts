import { normalize } from "@/lib/text";
import type { KindHint } from "@/lib/parsers/types";

export type CategoryKind = "expense" | "income" | "transfer";

export interface DefaultCategory {
  slug: string;
  name: string;
  kind: CategoryKind;
  icon: string; // lucide icon name
  color: string;
  /** Fixed costs (rent, bills) are reserved before "safe to spend" */
  fixed?: boolean;
  /** Essentials vs. wants — used by advisor insights */
  essential?: boolean;
  keywords: string[];
}

/** Seeded for every new user (mirrored in supabase/migrations). Keywords are matched on folded upper-case text. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    slug: "groceries", name: "Groceries", kind: "expense", icon: "ShoppingBasket", color: "#16a34a", essential: true,
    keywords: ["MIGROS", "A101", "BIM ", "BIM BIRLESIK", "SOK MARKET", "SOK MAGAZA", "CARREFOUR", "MACROCENTER", "FILE MARKET", "METRO GROSS", "HAKMAR", "TARIM KREDI", "ONUR MARKET", "BIZIM TOPTAN", "GETIR", "ISTEGELSIN", "MARKET", "BAKKAL", "MANAV", "KASAP", "FIRIN", "EKMEK"],
  },
  {
    slug: "food-delivery", name: "Food delivery", kind: "expense", icon: "Bike", color: "#f97316",
    keywords: ["YEMEKSEPETI", "YS ", "GETIR YEMEK", "TRENDYOL YEMEK", "TRENDYOL GO", "MIGROS YEMEK", "YEMEK SIPARIS"],
  },
  {
    slug: "dining", name: "Dining & cafés", kind: "expense", icon: "Coffee", color: "#ea580c",
    keywords: ["STARBUCKS", "KAHVE DUNYASI", "ESPRESSOLAB", "GLORIA JEANS", "CAFFE NERO", "MOC ", "BURGER KING", "MCDONALD", "DOMINO", "PIZZA", "SIMIT SARAYI", "TAVUK DUNYASI", "POPEYES", "KFC", "LITTLE CAESARS", "SBARRO", "CAFE", "KAFE", "RESTORAN", "RESTAURANT", "LOKANTA", "KEBAP", "KOFTE", "DONER", "BAKLAVA", "PASTANE", "BISTRO", "MEYHANE", "BAR ", "PUB"],
  },
  {
    slug: "transport", name: "Transport & fuel", kind: "expense", icon: "Car", color: "#0ea5e9", essential: true,
    keywords: ["SHELL", "OPET", "BP ", "PETROL OFISI", "TOTALENERGIES", "TOTAL ", "AYTEMIZ", "LUKOIL", "ALPET", "ISTANBULKART", "BELBIM", "IETT", "METRO ISTANBUL", "MARMARAY", "EGO ", "IZBAN", "MARTI", "BITAKSI", "UBER", "TAKSI", "ISPARK", "OTOPARK", "HGS", "OGS", "KGM", "OTOYOL", "AKARYAKIT", "BINBIN", "HOP "],
  },
  {
    slug: "housing", name: "Rent & housing", kind: "expense", icon: "Home", color: "#7c3aed", fixed: true, essential: true,
    keywords: ["KIRA", "AIDAT", "SITE YONETIM", "APARTMAN YONETIM", "EMLAK"],
  },
  {
    slug: "bills", name: "Bills & utilities", kind: "expense", icon: "Zap", color: "#eab308", fixed: true, essential: true,
    keywords: ["TURKCELL", "VODAFONE", "TURK TELEKOM", "TT MOBIL", "SUPERONLINE", "TURKNET", "D-SMART", "DIGITURK", "ENERJISA", "CK ENERJI", "CK BOGAZICI", "AYEDAS", "BEDAS", "BASKENT ELEKTRIK", "GEDIZ", "UEDAS", "IGDAS", "BASKENTGAZ", "IZMIRGAZ", "AKSA DOGALGAZ", "ISKI", "ASKI", "IZSU", "SU IDARESI", "ELEKTRIK", "DOGALGAZ", "FATURA"],
  },
  {
    slug: "subscriptions", name: "Subscriptions", kind: "expense", icon: "Repeat", color: "#db2777",
    keywords: ["NETFLIX", "SPOTIFY", "YOUTUBE", "GOOGLE ONE", "GOOGLE *", "APPLE.COM", "ITUNES", "ICLOUD", "DISNEY", "BLUTV", "BLU TV", "EXXEN", "GAIN ", "PRIME VIDEO", "AMAZON PRIME", "TABII", "TOD ", "CHATGPT", "OPENAI", "ANTHROPIC", "CLAUDE.AI", "MICROSOFT", "ADOBE", "CANVA", "NOTION", "DROPBOX", "LINKEDIN"],
  },
  {
    slug: "shopping", name: "Shopping", kind: "expense", icon: "ShoppingBag", color: "#e11d48",
    keywords: ["TRENDYOL", "HEPSIBURADA", "AMAZON", "N11", "CICEKSEPETI", "PTTAVM", "LC WAIKIKI", "LCW", "DEFACTO", "KOTON", "ZARA", "BERSHKA", "PULL&BEAR", "PULL AND BEAR", "STRADIVARIUS", "H&M", "MAVI", "IKEA", "KOCTAS", "BAUHAUS", "TEKNOSA", "MEDIAMARKT", "MEDIA MARKT", "VATAN BILGISAYAR", "BOYNER", "DECATHLON", "FLO ", "ENGLISH HOME", "MADAME COCO", "ENZA", "APPLE STORE"],
  },
  {
    slug: "entertainment", name: "Entertainment", kind: "expense", icon: "Clapperboard", color: "#9333ea",
    keywords: ["STEAM", "PLAYSTATION", "XBOX", "EPIC GAMES", "CINEMAXIMUM", "PARIBU CINEMAS", "CINEMA", "SINEMA", "BILETIX", "BILETINIAL", "PASSO", "MOBILET", "KONSER", "TIYATRO", "MUZE", "BOWLING"],
  },
  {
    slug: "health", name: "Health", kind: "expense", icon: "HeartPulse", color: "#ef4444", essential: true,
    keywords: ["ECZANE", "ECZ.", "ECZ ", "HASTANE", "HASTANESI", "ACIBADEM", "MEMORIAL", "MEDICAL PARK", "LIV HOSPITAL", "FLORENCE", "AMERIKAN HASTANE", "DENTAL", "DIS KLINIGI", "KLINIK", "LABORATUVAR", "OPTIK", "SPOR SALONU", "MACFIT", "GYM"],
  },
  {
    slug: "personal-care", name: "Personal care", kind: "expense", icon: "Sparkles", color: "#f472b6",
    keywords: ["KUAFOR", "BERBER", "GRATIS", "WATSONS", "ROSSMANN", "SEPHORA", "EVE ", "KOZMETIK", "GUZELLIK"],
  },
  {
    slug: "education", name: "Education", kind: "expense", icon: "GraduationCap", color: "#2563eb",
    keywords: ["UDEMY", "COURSERA", "KITAP", "D&R", "DR KITAP", "IDEFIX", "KIRTASIYE", "UNIVERSITE", "OKUL", "KURS", "DERSHANE"],
  },
  {
    slug: "travel", name: "Travel", kind: "expense", icon: "Plane", color: "#06b6d4",
    keywords: ["TURK HAVA YOLLARI", "THY", "PEGASUS", "AJET", "ANADOLUJET", "SUNEXPRESS", "OTEL", "HOTEL", "BOOKING", "AIRBNB", "OBILET", "ENUYGUN", "TATILSEPETI", "ETSTUR", "JOLLY", "KAMIL KOC", "METRO TURIZM", "PAMUKKALE TURIZM", "TCDD", "HAVAIST", "HAVABUS"],
  },
  {
    slug: "cash", name: "Cash withdrawal", kind: "expense", icon: "Banknote", color: "#65a30d",
    keywords: ["ATM", "NAKIT CEKIM", "PARA CEKME", "NAKIT AVANS"],
  },
  {
    slug: "fees", name: "Fees & interest", kind: "expense", icon: "Percent", color: "#b91c1c",
    keywords: ["FAIZ", "KOMISYON", "MASRAF", "BSMV", "KKDF", "YILLIK UCRET", "KART UCRETI", "HESAP ISLETIM", "GECIKME"],
  },
  {
    slug: "gifts", name: "Gifts & donations", kind: "expense", icon: "Gift", color: "#c026d3",
    keywords: ["BAGIS", "DONATION", "AHBAP", "LOSEV", "TEMA VAKFI", "KIZILAY", "HEDIYE"],
  },
  { slug: "other", name: "Other", kind: "expense", icon: "CircleDashed", color: "#71717a", keywords: [] },

  {
    slug: "income", name: "Income", kind: "income", icon: "Wallet", color: "#059669",
    keywords: ["MAAS", "UCRET ODEME", "HAKEDIS", "SALARY", "PAYONEER", "UPWORK", "FIVERR", "WISE", "FREELANCE", "SERBEST MESLEK"],
  },
  { slug: "refunds", name: "Refunds", kind: "income", icon: "Undo2", color: "#10b981", keywords: ["IADE", "REFUND", "CASHBACK", "PARAPUAN"] },
  { slug: "interest-income", name: "Interest & returns", kind: "income", icon: "TrendingUp", color: "#14b8a6", keywords: ["MEVDUAT FAIZ", "FAIZ GELIRI", "TEMETTU", "FON SATIS", "KAR PAYI"] },
  { slug: "other-income", name: "Other income", kind: "income", icon: "PiggyBank", color: "#34d399", keywords: [] },

  {
    slug: "transfer", name: "Transfers (own accounts)", kind: "transfer", icon: "ArrowLeftRight", color: "#64748b",
    keywords: ["VIRMAN", "KENDI HESAB", "HESAPLARINIZ ARASI", "HESAPLAR ARASI", "PAPARA YUKLEME", "PAPARAYA", "BAKIYE YUKLE"],
  },
  {
    slug: "card-payment", name: "Credit card payment", kind: "transfer", icon: "CreditCard", color: "#475569",
    keywords: ["KREDI KARTI ODEME", "KREDI KARTI BORC", "KART BORCU", "KK ODEME", "KART ODEMESI", "ODEMENIZ ICIN TESEKKUR"],
  },
  {
    slug: "investments", name: "Savings & investments", kind: "transfer", icon: "Landmark", color: "#0f766e",
    keywords: ["DOVIZ ALIS", "DOVIZ SATIS", "ALTIN ALIS", "ALTIN SATIS", "ALTIN HESAB", "FON ALIS", "YATIRIM HESAB", "VADELI HESAB", "BES ", "BIREYSEL EMEKLILIK", "HISSE", "MIDAS", "BORSA"],
  },
];

export interface CategoryRef {
  id: string;
  slug: string | null;
  name: string;
  kind: CategoryKind;
}

export interface UserRule {
  pattern: string; // normalized substring
  category_id: string;
}

export interface CategorizeInput {
  description: string;
  merchant?: string | null;
  counterparty?: string | null;
  amount: number;
  kindHint?: KindHint;
}

/**
 * Pick a category: user's own rules first (learned when they re-categorize),
 * then parser hints, then the keyword dictionary. Returns null when unsure —
 * the AI categorizer or the user fills those in.
 */
export function categorize(
  tx: CategorizeInput,
  categories: CategoryRef[],
  rules: UserRule[],
  opts: { ownName?: string | null } = {},
): { categoryId: string | null; via: "rule" | "hint" | "keyword" | null } {
  const text = normalize([tx.merchant, tx.counterparty, tx.description].filter(Boolean).join(" "));
  const bySlug = (slug: string) => categories.find((c) => c.slug === slug)?.id ?? null;

  const sortedRules = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const r of sortedRules) {
    if (r.pattern && text.includes(normalize(r.pattern))) return { categoryId: r.category_id, via: "rule" };
  }

  // Money moved between your own accounts (EFT from/to your own name)
  if (opts.ownName && tx.counterparty && normalize(tx.counterparty) === normalize(opts.ownName)) {
    return { categoryId: bySlug("transfer"), via: "hint" };
  }

  if (tx.kindHint === "cash") return { categoryId: bySlug("cash"), via: "hint" };
  if (tx.kindHint === "fee") return { categoryId: bySlug("fees"), via: "hint" };
  if (tx.kindHint === "income") return { categoryId: bySlug("income"), via: "hint" };
  if (tx.kindHint === "transfer") {
    const slug = /KREDI KARTI|KART BORC|KK ODEME|KART ODEME/.test(text)
      ? "card-payment"
      : /DOVIZ|ALTIN|FON|YATIRIM|VADELI/.test(text)
        ? "investments"
        : "transfer";
    return { categoryId: bySlug(slug), via: "hint" };
  }

  const isIncome = tx.amount > 0;
  let best: { slug: string; len: number } | null = null;
  for (const c of DEFAULT_CATEGORIES) {
    // Refund keywords only apply to money in; spending keywords only to money out
    if (isIncome && c.kind === "expense") continue;
    if (!isIncome && c.kind === "income") continue;
    for (const k of c.keywords) {
      const kk = k.trim();
      const hit = k.endsWith(" ") ? new RegExp(`(^|\\W)${escapeRe(kk)}(\\W|$)`).test(text) : text.includes(kk);
      if (hit && (!best || kk.length > best.len)) best = { slug: c.slug, len: kk.length };
    }
  }
  if (best) return { categoryId: bySlug(best.slug), via: "keyword" };
  if (isIncome && /FAST|EFT|HAVALE|GONDER|TRANSFER/.test(text)) return { categoryId: bySlug("other-income"), via: "hint" };
  return { categoryId: null, via: null };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A stable key to learn "this merchant -> that category" rules from user edits. */
export function ruleKeyFor(merchant: string | null | undefined, description: string): string | null {
  const base = normalize(merchant || description)
    .replace(/\d+/g, " ")
    .replace(/[^A-Z&. ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ").filter((w) => w.length > 1 && !/^(A\.?S|LTD|STI|SAN|TIC|VE)\.?$/.test(w));
  const key = words.slice(0, 2).join(" ");
  return key.length >= 3 ? key : null;
}
