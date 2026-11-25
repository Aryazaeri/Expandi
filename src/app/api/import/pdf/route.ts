import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { aiExtractStatementPdf, isAiConfigured } from "@/lib/ai";
import type { BankCode } from "@/lib/parsers/types";

export const maxDuration = 300;

/** Extract transactions from a PDF statement with Claude. Returns a preview — nothing is saved yet. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ error: "PDF import needs ANTHROPIC_API_KEY on the server." }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  const bank = (form.get("bank") as BankCode | null) ?? "other";
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "PDF is larger than 20 MB" }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.toString("latin1").includes("/Encrypt")) {
    return NextResponse.json(
      { error: "This PDF is password-protected. Open it once, then 'Print → Save as PDF' to save an unlocked copy, and upload that." },
      { status: 400 },
    );
  }
  try {
    const transactions = await aiExtractStatementPdf(bytes.toString("base64"), bank);
    return NextResponse.json({ transactions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
