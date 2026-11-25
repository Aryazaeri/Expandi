"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Apple, Check, Copy, FileSpreadsheet, Mail, MessageSquareText, RefreshCw, Smartphone, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { dismissIngestEvent, importPastedMessages, rotateIngestToken } from "@/app/actions";
import { Money } from "@/components/money";
import { SimpleSelect } from "@/components/simple-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Account, IngestEvent } from "@/lib/db-types";
import { parseStatementRows, type Cell } from "@/lib/parsers/statement";
import { BANKS, type BankCode, type ParsedTransaction } from "@/lib/parsers/types";
import { cn } from "@/lib/utils";

export function ImportView({
  token,
  siteUrl,
  accounts,
  events,
  aiAvailable,
  initialTab,
}: {
  token: string;
  siteUrl: string;
  accounts: Account[];
  events: IngestEvent[];
  aiAvailable: boolean;
  initialTab: string;
}) {
  const failed = events.filter((e) => e.status === "failed").length;
  return (
    <Tabs defaultValue={initialTab}>
      <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-fit">
        <TabsTrigger value="auto">Automatic</TabsTrigger>
        <TabsTrigger value="statement">Statement</TabsTrigger>
        <TabsTrigger value="paste">Paste SMS</TabsTrigger>
        <TabsTrigger value="log">
          Log {failed > 0 && <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-xs text-warning">{failed}</span>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="auto">
        <AutoSetup token={token} siteUrl={siteUrl} />
      </TabsContent>
      <TabsContent value="statement">
        <StatementUpload accounts={accounts} aiAvailable={aiAvailable} />
      </TabsContent>
      <TabsContent value="paste">
        <PasteSms />
      </TabsContent>
      <TabsContent value="log">
        <EventLog events={events} />
      </TabsContent>
    </Tabs>
  );
}

// ------------------------------------------------------------------ helpers

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={shown ? value : "•".repeat(24)} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        {secret && (
          <Button variant="outline" onClick={() => setShown((s) => !s)}>
            {shown ? "Hide" : "Show"}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm [&_b]:font-medium [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs">{children}</ol>;
}

// ------------------------------------------------------------------ automatic setup

function AutoSetup({ token, siteUrl }: { token: string; siteUrl: string }) {
  const [pending, start] = useTransition();
  const smsUrl = `${siteUrl}/api/ingest/sms`;
  const emailUrl = `${siteUrl}/api/ingest/email`;
  const androidTemplate = `{"text":"%text%","sender":"%from%","receivedAt":"%receivedStamp%"}`;
  const appsScript = `// Expandi — forwards bank e-mails (and PDF e-statements) from Gmail
const ENDPOINT = "${emailUrl}";
const TOKEN = "${token}";
// Adjust the sender domains if your bank uses a different address
const QUERY = 'from:(isbank.com.tr OR vakifbank.com.tr OR ziraatbank.com.tr OR papara.com) newer_than:3d -label:expandi-done';

function syncBankEmails() {
  const label = GmailApp.getUserLabelByName("expandi-done") || GmailApp.createLabel("expandi-done");
  for (const thread of GmailApp.search(QUERY, 0, 30)) {
    for (const msg of thread.getMessages()) {
      const attachments = msg.getAttachments()
        .filter(a => a.getContentType() === "application/pdf" && a.getSize() < 15e6)
        .map(a => ({ name: a.getName(), mimeType: a.getContentType(), data: Utilities.base64Encode(a.getBytes()) }));
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: "post",
        contentType: "application/json",
        headers: { "x-ingest-token": TOKEN },
        payload: JSON.stringify({ from: msg.getFrom(), subject: msg.getSubject(), body: msg.getPlainBody(), date: msg.getDate().toISOString(), attachments }),
        muteHttpExceptions: true,
      });
      console.log(res.getResponseCode(), res.getContentText().slice(0, 300));
    }
    thread.addLabel(label);
  }
}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Your private webhook</CardTitle>
          <CardDescription>
            Turkish banks only let licensed companies connect directly, so Expandi reads the SMS and e-mails your banks already send you. Keep
            this token secret: anyone with it can add transactions to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <CopyField label="SMS endpoint" value={smsUrl} />
          <CopyField label="Token (header x-ingest-token)" value={token} secret />
          <div className="md:col-span-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (!confirm("Generate a new token? Your phone shortcut and e-mail script will stop working until you update them.")) return;
                start(async () => {
                  const r = await rotateIngestToken();
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                });
              }}
            >
              <RefreshCw /> Rotate token
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Apple className="size-4" /> iPhone — Shortcuts automation
          </CardTitle>
          <CardDescription>Runs every time a bank SMS arrives. Built into iOS, nothing to install.</CardDescription>
        </CardHeader>
        <CardContent>
          <Steps>
            <li>
              Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Message</b>.
            </li>
            <li>
              <b>Message Contains</b>: <code>TL</code> (catches every bank). Optionally pick <b>Sender</b>: İŞBANK, VAKIFBANK, ZIRAATBANK, PAPARA.
            </li>
            <li>
              Choose <b>Run Immediately</b> and turn off <b>Notify When Run</b>.
            </li>
            <li>
              Add action <b>Get Contents of URL</b>: URL = SMS endpoint above, Method <b>POST</b>.
            </li>
            <li>
              Headers: <code>x-ingest-token</code> = your token. Request Body <b>JSON</b> with keys <code>text</code> = <b>Shortcut Input → Content</b>,{" "}
              <code>sender</code> = <b>Shortcut Input → Sender</b>.
            </li>
            <li>Send yourself a test: the transaction should appear in the Log tab within seconds.</li>
          </Steps>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4" /> Android — SMS forwarder
          </CardTitle>
          <CardDescription>Use a free forwarder app such as “SMS to URL Forwarder”, MacroDroid or Tasker.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Steps>
            <li>Install the forwarder and allow it to read SMS.</li>
            <li>
              Add a rule: sender matches <code>ISBANK|VAKIFBANK|ZIRAAT|PAPARA</code> (or forward everything — non-bank SMS are ignored).
            </li>
            <li>
              URL: the SMS endpoint with <code>?token=</code> + your token (or set the <code>x-ingest-token</code> header if the app allows).
            </li>
            <li>Method POST, JSON body template:</li>
          </Steps>
          <CopyField label="JSON template" value={androidTemplate} />
          <CopyField label="URL with token" value={`${smsUrl}?token=${token}`} secret />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" /> E-mail — Gmail + Google Apps Script
          </CardTitle>
          <CardDescription>
            Forwards bank notification e-mails and PDF e-statements every 15 minutes. The script runs in your own Google account — Expandi never gets
            access to your inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Steps>
            <li>
              In your bank&apos;s app, turn on e-mail notifications for card spending and e-statements (e-ekstre).
            </li>
            <li>
              Go to <b>script.google.com</b> → <b>New project</b>, paste the script below and save.
            </li>
            <li>
              Run <code>syncBankEmails</code> once and approve the Gmail permission.
            </li>
            <li>
              <b>Triggers</b> (clock icon) → <b>Add trigger</b> → <code>syncBankEmails</code>, time-driven, every 15 minutes.
            </li>
          </Steps>
          <div className="relative">
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">{appsScript.replace(token, "•".repeat(12) + " (included when you copy)")}</pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={async () => {
                await navigator.clipboard.writeText(appsScript);
                toast.success("Script copied (includes your token)");
              }}
            >
              <Copy /> Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Password-protected e-statements can&apos;t be read automatically. Many banks let you turn off the PDF password in internet banking, or upload
            an unlocked copy on the Statement tab.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ statement upload

async function readRows(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1254").decode(buf); // Turkish Windows encoding
    const Papa = (await import("papaparse")).default;
    return Papa.parse<Cell[]>(text, { skipEmptyLines: true }).data;
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

function StatementUpload({ accounts, aiAvailable }: { accounts: Account[]; aiAvailable: boolean }) {
  const router = useRouter();
  const [bank, setBank] = useState<BankCode>("isbank");
  const [accountId, setAccountId] = useState<string | null>(accounts.find((a) => a.bank === "isbank")?.id ?? null);
  const [creditCard, setCreditCard] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [preview, setPreview] = useState<ParsedTransaction[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reparse(r: Cell[][], cc: boolean, b: BankCode) {
    const res = parseStatementRows(r, { bank: b, creditCard: cc });
    if (!res.columns) {
      setPreview(null);
      setError(
        `Couldn't find the date / description / amount columns in this file.${aiAvailable ? " Try exporting the statement as PDF — the AI reader handles any layout." : ""}`,
      );
    } else {
      setError(res.transactions.length ? null : "No transaction rows found.");
      setPreview(res.transactions);
    }
  }

  async function onFile(f: File) {
    setFile(f);
    setError(null);
    setPreview(null);
    setRows(null);
    try {
      if (f.name.toLowerCase().endsWith(".pdf")) {
        if (!aiAvailable) {
          setError("PDF statements need the AI reader (set ANTHROPIC_API_KEY and enable AI in Settings). Export as Excel/CSV instead.");
          return;
        }
        setBusy("Reading PDF with AI… this can take a minute");
        const fd = new FormData();
        fd.append("file", f);
        fd.append("bank", bank);
        const res = await fetch("/api/import/pdf", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed");
        setPreview(json.transactions);
      } else {
        setBusy("Reading file…");
        const r = await readRows(f);
        setRows(r);
        reparse(r, creditCard, bank);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doImport() {
    if (!preview?.length) return;
    setBusy("Importing…");
    try {
      const res = await fetch("/api/import/statement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, fileName: file?.name, transactions: preview.map((t) => ({ ...t, bank })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      toast.success(`${json.inserted} imported · ${json.duplicates} duplicates skipped`);
      if (json.errors?.length) toast.warning(json.errors.join("; "));
      setPreview(null);
      setRows(null);
      setFile(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const total = preview?.reduce((a, t) => a + t.amount, 0) ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-4" /> Upload a statement
        </CardTitle>
        <CardDescription>
          Export from your bank app or internet banking (Hesap hareketleri / Kart ekstresi) as Excel, CSV{aiAvailable ? " or PDF" : ""}. Great for
          bringing in past months. Transactions already imported by SMS or e-mail are skipped.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Bank</Label>
            <SimpleSelect
              value={bank}
              onChange={(v) => {
                setBank(v as BankCode);
                setAccountId(accounts.find((a) => a.bank === v)?.id ?? null);
                if (rows) reparse(rows, creditCard, v as BankCode);
              }}
              options={BANKS.map((b) => ({ value: b.code, label: b.name }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Into account</Label>
            <SimpleSelect
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: `${a.name}${a.last4 ? ` •${a.last4}` : ""}` }))}
              placeholder="Pick an account"
            />
          </div>
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
            <Switch
              checked={creditCard}
              onCheckedChange={(v) => {
                setCreditCard(v);
                if (rows) reparse(rows, v, bank);
              }}
            />
            Credit card statement
          </label>
        </div>

        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <Upload className="size-6" />
          {file ? <span className="font-medium text-foreground">{file.name}</span> : <span>Tap to choose a file (.xlsx, .xls, .csv{aiAvailable ? ", .pdf" : ""})</span>}
          {busy && <span className="text-brand">{busy}</span>}
          <input
            type="file"
            className="sr-only"
            accept={`.xlsx,.xls,.csv,.txt${aiAvailable ? ",.pdf" : ""}`}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>

        {error && <p className="text-sm text-negative">{error}</p>}

        {preview && preview.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <b>{preview.length}</b> transactions · net <Money amount={total} sign decimals={0} />
                {creditCard ? " (credit card: purchases shown as negative)" : ""}
              </span>
              <Button onClick={doImport} disabled={!!busy || !accountId}>
                Import {preview.length}
              </Button>
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{t.occurredAt.slice(0, 10)}</TableCell>
                      <TableCell className="max-w-64 truncate">{t.description}</TableCell>
                      <TableCell className="text-right">
                        <Money amount={t.amount} currency={t.currency} sign className={t.amount > 0 ? "text-positive" : ""} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.length > 200 && <p className="text-xs text-muted-foreground">Showing first 200 rows.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ paste

function PasteSms() {
  const [text, setText] = useState("");
  const [sender, setSender] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="size-4" /> Paste bank messages
        </CardTitle>
        <CardDescription>
          Copy a few SMS from your Messages app and paste them here (one per paragraph). Handy for testing — and for catching up on messages from
          before you set up forwarding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5 sm:w-64">
          <Label htmlFor="sender">Sender (optional)</Label>
          <Input id="sender" placeholder="ISBANK" value={sender} onChange={(e) => setSender(e.target.value)} />
        </div>
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"1234 ile biten kartinizla 25.11.2026 14:32'de MIGROS isyerinden 245,90 TL harcama yapilmistir.\n\nHesabiniza AHMET YILMAZ tarafindan 5.000,00 TL FAST ile gonderilmistir."}
        />
        <Button
          disabled={pending || !text.trim()}
          onClick={() =>
            start(async () => {
              const r = await importPastedMessages(text, sender.trim() || null);
              if (r.ok) {
                toast.success(r.message);
                setText("");
              } else toast.error(r.error);
            })
          }
        >
          {pending ? "Importing…" : "Import messages"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ log

const STATUS_STYLE: Record<IngestEvent["status"], string> = {
  parsed: "bg-positive/15 text-positive",
  ai_parsed: "bg-chart-4/15 text-chart-4",
  ignored: "bg-muted text-muted-foreground",
  duplicate: "bg-muted text-muted-foreground",
  failed: "bg-negative/15 text-negative",
  dismissed: "bg-muted text-muted-foreground line-through",
};

function EventLog({ events }: { events: IngestEvent[] }) {
  const [pending, start] = useTransition();
  if (!events.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Nothing received yet. Set up automatic import to get started.</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent messages</CardTitle>
        <CardDescription>
          Every SMS, e-mail and statement Expandi received. <b>Failed</b> ones couldn&apos;t be read — add them manually from Activity, or paste the text so
          the parser can be improved.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {events.map((e) => (
          <div key={e.id} className="flex gap-3 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className={cn("border-0", STATUS_STYLE[e.status])}>{e.status.replace("_", " ")}</Badge>
                <span className="uppercase text-muted-foreground">{e.source}</span>
                {e.sender && <span className="text-muted-foreground">{e.sender}</span>}
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</span>
              </div>
              <p className="line-clamp-2 font-mono text-xs break-all">{e.raw.startsWith("pdf:") ? "PDF attachment" : e.raw}</p>
              {e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}
            </div>
            {e.status === "failed" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss"
                disabled={pending}
                onClick={() => start(async () => void (await dismissIngestEvent(e.id)))}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
