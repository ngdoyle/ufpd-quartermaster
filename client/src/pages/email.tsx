import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, errorMessage } from "@/lib/queryClient";
import { useApp, can } from "@/lib/app-context";
import { isValidEmail } from "@shared/validation";
import type { Officer, EmailLogEntry, User } from "@shared/schema";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Clock, PackageX } from "lucide-react";

const statusTone: Record<string, any> = { logged: "gray", sent: "green", failed: "red" };
const PROVIDER_LABEL: Record<string, string> = { log: "Log only (not delivered)", resend: "Resend", smtp: "SMTP" };

export default function EmailPage() {
  const { user } = useApp();
  const { toast } = useToast();
  const allowed = can.email(user?.role);

  const { data: config } = useQuery<{ provider: string }>({ queryKey: ["/api/email/config"], enabled: allowed });
  const { data: log, isLoading } = useQuery<EmailLogEntry[]>({ queryKey: ["/api/email/log"], enabled: allowed });
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"], enabled: allowed });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/users"], enabled: allowed });

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<EmailLogEntry | null>(null);
  const [lowStockTo, setLowStockTo] = useState("");
  const [busy, setBusy] = useState<null | "overdue" | "lowstock">(null);

  // Only personnel/businesses with an email on file are valid recipients.
  // Dedupe by email so shared addresses produce a single option.
  const recipients = useMemo(() => {
    const byEmail = new Map<string, { email: string; label: string }>();
    for (const o of officers ?? []) {
      if (!isValidEmail(o.email)) continue;
      const email = o.email!.trim();
      if (byEmail.has(email)) continue;
      byEmail.set(email, { email, label: o.type === "business" ? o.firstName : `${o.lastName}, ${o.firstName}` });
    }
    return Array.from(byEmail.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [officers]);

  // #14: low-stock report recipients are USER ACCOUNTS only (login accounts).
  // List active users; those without a valid email on file are shown disabled.
  const userRecipients = useMemo(() => {
    return (users ?? [])
      .filter((u) => u.active)
      .map((u) => ({ email: (u.email ?? "").trim(), label: `${u.username} — ${u.name}`, hasEmail: isValidEmail(u.email) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const provider = config?.provider ?? "log";

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Email" subtitle="Outbound email log and tools" />
        <EmptyState title="Not available" hint="Only administrators and quartermasters can access email." />
      </div>
    );
  }

  function refetchLog() { queryClient.invalidateQueries({ queryKey: ["/api/email/log"] }); }

  async function send() {
    if (!to) return toast({ title: "Choose a recipient", variant: "destructive" });
    if (!subject.trim() || !body.trim()) return toast({ title: "Subject and message are required", variant: "destructive" });
    setSending(true);
    try {
      await apiRequest("POST", "/api/email/send", { to, subject: subject.trim(), body: body.trim(), actor: user?.name });
      refetchLog();
      toast({ title: provider === "log" ? "Email recorded (log mode)" : "Email sent" });
      setSubject(""); setBody(""); setTo("");
    } catch (e) {
      toast({ title: "Failed", description: errorMessage(e), variant: "destructive" });
    } finally { setSending(false); }
  }

  async function sendOverdue() {
    setBusy("overdue");
    try {
      const r = await (await apiRequest("POST", "/api/email/overdue-reminders", { actor: user?.name })).json();
      refetchLog();
      toast({ title: `Overdue reminders: ${r.sent} sent`, description: r.skipped?.length ? `Skipped (no email): ${r.skipped.join(", ")}` : `${r.officersWithOverdue} officer(s) with overdue items` });
    } catch (e) {
      toast({ title: "Failed", description: errorMessage(e), variant: "destructive" });
    } finally { setBusy(null); }
  }

  async function sendLowStock() {
    if (!lowStockTo) return toast({ title: "Choose a recipient for the report", variant: "destructive" });
    setBusy("lowstock");
    try {
      const r = await (await apiRequest("POST", "/api/email/low-stock", { to: lowStockTo, actor: user?.name })).json();
      refetchLog();
      toast({ title: `Low-stock report ${r.status}`, description: `${r.count} item(s) at or below par` });
      setLowStockTo("");
    } catch (e) {
      toast({ title: "Failed", description: errorMessage(e), variant: "destructive" });
    } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title="Email" subtitle="Outbound email log, compose, and reminders" />

      {/* Provider banner */}
      <Card className={`mb-4 flex flex-wrap items-center gap-2 p-4 ${provider === "log" ? "border-chart-3/30 bg-chart-3/5" : "border-primary/25 bg-primary/5"}`} data-testid="banner-provider">
        <Mail className="h-5 w-5 text-primary" />
        <div className="text-sm">
          <span className="font-medium">Active provider: {PROVIDER_LABEL[provider] ?? provider}</span>
          {provider === "log" && (
            <p className="text-muted-foreground">Emails are recorded here but not delivered until a provider is configured.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Compose */}
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Send className="h-4 w-4" /> Compose</h3>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Recipient</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger data-testid="select-email-recipient"><SelectValue placeholder={recipients.length ? "Select a recipient with email on file…" : "No personnel have an email on file"} /></SelectTrigger>
                <SelectContent>
                  {recipients.map((r) => <SelectItem key={r.email} value={r.email}>{r.label} — {r.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only personnel and businesses with an email on file can be selected.</p>
            </div>
            <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-email-subject" /></div>
            <div className="space-y-1.5"><Label>Message</Label><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} data-testid="input-email-body" /></div>
            <Button onClick={send} disabled={sending} data-testid="button-email-send"><Send className="mr-1.5 h-4 w-4" /> {sending ? "Sending…" : "Send"}</Button>
          </div>
        </Card>

        {/* Tools */}
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Reminders &amp; reports</h3>
          <div className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Clock className="h-4 w-4" /> Overdue return reminders</p>
              <p className="mt-1 text-xs text-muted-foreground">Emails each officer who has overdue returnable equipment and an email on file.</p>
              <Button className="mt-2" size="sm" variant="outline" onClick={sendOverdue} disabled={busy === "overdue"} data-testid="button-send-overdue">
                {busy === "overdue" ? "Sending…" : "Send overdue reminders"}
              </Button>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium"><PackageX className="h-4 w-4" /> Low-stock report</p>
              <p className="mt-1 text-xs text-muted-foreground">Sends the list of items at or below par to a chosen <strong>user account</strong>. Only login accounts with an email on file can receive it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Select value={lowStockTo} onValueChange={setLowStockTo}>
                  <SelectTrigger className="w-72" data-testid="select-lowstock-recipient"><SelectValue placeholder={userRecipients.some((u) => u.hasEmail) ? "User account with email…" : "No user accounts have an email"} /></SelectTrigger>
                  <SelectContent>
                    {userRecipients.map((u) => (
                      <SelectItem key={u.label} value={u.email} disabled={!u.hasEmail}>
                        {u.label}{u.hasEmail ? ` — ${u.email}` : " — (no email on file)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={sendLowStock} disabled={busy === "lowstock"} data-testid="button-send-lowstock">
                  {busy === "lowstock" ? "Sending…" : "Send report"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Log */}
      <Card className="mt-4 overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Email log</h3></div>
        {isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
        ) : !log?.length ? <EmptyState title="No emails yet" hint="Sent and recorded emails will appear here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Recipient</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Template</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setViewing(e)} data-testid={`row-email-${e.id}`}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                    <td className="px-4 py-2">{e.recipient}</td>
                    <td className="px-4 py-2">{e.subject}</td>
                    <td className="px-4 py-2 text-muted-foreground">{e.template ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{e.provider}</td>
                    <td className="px-4 py-2"><Pill tone={statusTone[e.status] ?? "gray"}>{e.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.subject}</DialogTitle>
            <DialogDescription>
              To {viewing?.recipient} · {viewing && fmtDateTime(viewing.createdAt)} · {viewing?.provider} · {viewing?.status}
            </DialogDescription>
          </DialogHeader>
          {viewing?.error && <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{viewing.error}</p>}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm">{viewing?.body}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
