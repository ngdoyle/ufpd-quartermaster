import { storage } from "./storage";
import type { EmailLogEntry } from "@shared/schema";

/*
 * Provider-agnostic email subsystem (#18).
 *
 * Every send is recorded in the `email_log` table regardless of provider. The
 * active provider is chosen by the EMAIL_PROVIDER env var and ships defaulting
 * to "log" (records only, never delivers) so the app is safe out of the box.
 * No provider secrets ever reach the client — this module is server-only.
 */

export type EmailProvider = "log" | "resend" | "smtp";

export function activeProvider(): EmailProvider {
  const p = (process.env.EMAIL_PROVIDER ?? "log").toLowerCase();
  return p === "resend" || p === "smtp" ? p : "log";
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string; // plain text
  template?: string;
  relatedType?: string | null;
  relatedId?: number | null;
}

const now = () => new Date().toISOString();

/**
 * Send (or, in log mode, record) an email and persist the attempt to
 * email_log. Returns the stored log row. Never throws for delivery failures —
 * a failed delivery is recorded with status "failed" and the error message.
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailLogEntry> {
  const provider = activeProvider();
  const base = {
    recipient: input.to,
    subject: input.subject,
    body: input.body,
    template: input.template ?? null,
    provider,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    createdAt: now(),
  };

  if (provider === "log") {
    return storage.addEmailLog({ ...base, status: "logged", error: null });
  }

  try {
    if (provider === "resend") await sendViaResend(input);
    else await sendViaSmtp(input);
    return storage.addEmailLog({ ...base, status: "sent", error: null });
  } catch (e: any) {
    return storage.addEmailLog({ ...base, status: "failed", error: String(e?.message ?? e) });
  }
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Resend not configured (RESEND_API_KEY and EMAIL_FROM required).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.body }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendViaSmtp(input: SendEmailInput): Promise<void> {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  if (!host || !from) throw new Error("SMTP not configured (SMTP_HOST and EMAIL_FROM required).");
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from, to: input.to, subject: input.subject, text: input.body });
}
