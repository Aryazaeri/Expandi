import { describe, expect, it } from "vitest";
import { parseBankMessage } from "./message";

const at = "2026-11-25T11:00:00Z";

function parsed(text: string, sender?: string) {
  const r = parseBankMessage({ text, sender, receivedAt: at });
  if (r.status !== "parsed") throw new Error(`expected parsed, got ${r.status}: ${r.reason}`);
  return r.tx;
}

describe("İşbank", () => {
  it("card purchase", () => {
    const tx = parsed(
      "1234 ile biten kartinizla 25.11.2026 14:32'de MIGROS TICARET isyerinden 245,90 TL tutarinda harcama yapilmistir. Kullanilabilir limitiniz 12.345,67 TL. B002",
      "ISBANK",
    );
    expect(tx.bank).toBe("isbank");
    expect(tx.amount).toBe(-245.9);
    expect(tx.merchant).toBe("Migros Ticaret");
    expect(tx.cardLast4).toBe("1234");
    expect(tx.occurredAt).toBe("2026-11-25T14:32:00+03:00");
    expect(tx.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("incoming FAST with Turkish characters", () => {
    const tx = parsed(
      "Hesabınıza 24.11.2026 tarihinde AHMET YILMAZ tarafından 5.000,00 TL FAST ile gönderilmiştir. Güncel bakiyeniz 18.250,40 TL.",
      "ISBANK",
    );
    expect(tx.amount).toBe(5000);
    expect(tx.counterparty).toBe("Ahmet Yilmaz");
    expect(tx.balanceAfter).toBe(18250.4);
  });

  it("installment purchase", () => {
    const tx = parsed(
      "Maximum kartinizla 20.11.2026 HEPSIBURADA isyerinden 6 taksitli 12.000,00 TL harcama yapilmistir.",
      "ISBANK",
    );
    expect(tx.amount).toBe(-12000);
    expect(tx.installments).toBe(6);
    expect(tx.merchant).toContain("Hepsiburada");
  });

  it("ignores OTP", () => {
    const r = parseBankMessage({
      text: "MIGROS isyerinde 245,90 TL tutarindaki islem icin sifreniz: 482913. Kimseyle paylasmayiniz.",
      sender: "ISBANK",
    });
    expect(r.status).toBe("ignored");
  });
});

describe("VakıfBank", () => {
  it("card purchase with slash date", () => {
    const tx = parsed(
      "VakifBank 5678 ile biten kartinizdan 23/11/2026 13:45 tarihinde TRENDYOL isyerinde 499,99 TL harcama yapildi.",
      "VAKIFBANK",
    );
    expect(tx.bank).toBe("vakifbank");
    expect(tx.amount).toBe(-499.99);
    expect(tx.merchant).toBe("Trendyol");
    expect(tx.cardLast4).toBe("5678");
  });

  it("ATM withdrawal", () => {
    const tx = parsed("Hesabinizdan 22.11.2026 ATM'den 2.000,00 TL para cekilmistir. Bakiye: 3.100,00 TL", "VAKIFBANK");
    expect(tx.amount).toBe(-2000);
    expect(tx.kindHint).toBe("cash");
  });

  it("declined is ignored", () => {
    const r = parseBankMessage({ text: "Kartinizla 150,00 TL tutarindaki islem yetersiz bakiye nedeniyle reddedildi.", sender: "VAKIFBANK" });
    expect(r.status).toBe("ignored");
  });
});

describe("Ziraat", () => {
  it("Bankkart purchase with 'da suffix", () => {
    const tx = parsed(
      "Sayin musterimiz, 21.11.2026 18:05 tarihinde ****4321 nolu Bankkart'inizla SHELL ISTANBUL'da 1.500,00 TL tutarinda islem yapilmistir.",
      "ZIRAATBANK",
    );
    expect(tx.bank).toBe("ziraat");
    expect(tx.amount).toBe(-1500);
    expect(tx.merchant).toBe("Shell Istanbul");
    expect(tx.cardLast4).toBe("4321");
  });

  it("salary credit", () => {
    const tx = parsed("Hesabiniza 15.11.2026 tarihinde MAAS ODEMESI aciklamali 45.000,00 TL yatirilmistir.", "ZIRAAT");
    expect(tx.amount).toBe(45000);
    expect(tx.kindHint).toBe("income");
  });

  it("credit card payment is a transfer", () => {
    const tx = parsed("Hesabinizdan 10.11.2026 tarihinde 8.750,00 TL kredi karti borc odemesi yapilmistir.", "ZIRAAT");
    expect(tx.amount).toBe(-8750);
    expect(tx.kindHint).toBe("transfer");
  });
});

describe("Papara", () => {
  it("Papara card spend", () => {
    const tx = parsed("Papara Kart ile MIGROS isyerinde 120,50 TL tutarinda harcama yaptin.", "PAPARA");
    expect(tx.bank).toBe("papara");
    expect(tx.amount).toBe(-120.5);
    expect(tx.merchant).toBe("Migros");
    expect(tx.occurredAt.startsWith("2026-11-25")).toBe(true);
  });

  it("someone sent money", () => {
    const tx = parsed("MEHMET DEMIR sana 250,00 TL gonderdi.", "PAPARA");
    expect(tx.amount).toBe(250);
    expect(tx.counterparty).toBe("Mehmet Demir");
  });

  it("top-up", () => {
    const tx = parsed("Papara hesabina 1.000,00 TL yuklendi.", "PAPARA");
    expect(tx.amount).toBe(1000);
  });

  it("promo ignored", () => {
    const r = parseBankMessage({ text: "Kasim kampanyasi! Papara Kart ile alisverislerde %10 cashback kazan.", sender: "PAPARA" });
    expect(r.status).toBe("ignored");
  });
});

describe("generic", () => {
  it("refund is income", () => {
    const tx = parsed("Kartiniza 19.11.2026 tarihinde ZARA isyerinden 899,90 TL iade yapilmistir.", "ISBANK");
    expect(tx.amount).toBe(899.9);
  });

  it("USD purchase", () => {
    const tx = parsed("1234 ile biten kartinizla 18.11.2026 NETFLIX.COM isyerinden 15,49 USD harcama yapilmistir.", "ISBANK");
    expect(tx.currency).toBe("USD");
    expect(tx.amount).toBe(-15.49);
  });
});
