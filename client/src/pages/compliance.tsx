import { PageHeader, Pill } from "@/components/bits";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck, FileLock2, CircleCheck, CircleDashed, CircleDot, ExternalLink,
  ListChecks, Mail, Server, Users, ClipboardCheck,
} from "lucide-react";
import type { ReactNode } from "react";

type Tone = "green" | "amber" | "red";

interface Control {
  control: string;
  detail: string;
  status: "MET" | "PARTIAL" | "PENDING";
}

const STATUS_TONE: Record<Control["status"], Tone> = {
  MET: "green",
  PARTIAL: "amber",
  PENDING: "red",
};

const STATUS_LABEL: Record<Control["status"], string> = {
  MET: "Met",
  PARTIAL: "Partial",
  PENDING: "Pending",
};

const CONTROLS: Control[] = [
  { control: "Password hashing", detail: "bcrypt (cost factor 12); no plaintext or reversible credentials stored.", status: "MET" },
  { control: "Brute-force protection", detail: "Login attempts rate-limited via express-rate-limit on the auth route.", status: "MET" },
  { control: "Session timeout", detail: "30-minute inactivity timeout enforced server-side.", status: "MET" },
  { control: "Audit logging", detail: "Append-only Activity Log records every transaction with user, action, and timestamp.", status: "MET" },
  { control: "Security headers", detail: "Helmet sets HSTS, frame, content-type, and referrer protections.", status: "MET" },
  { control: "Role-based access control", detail: "Capability checks are enforced client- and server-side across three roles (Administrator, Quartermaster, Auditor). Quartermasters and Auditors have read access to the Activity Log.", status: "MET" },
  { control: "Password policy", detail: "Self-service password change for every account; admin-initiated reset issues a one-time temporary password (emailed, never stored in clear) and forces a change at next sign-in. All password material is bcrypt-hashed.", status: "MET" },
  { control: "Encryption at rest", detail: "Supabase-managed Postgres with AES-256 encryption at rest (provider-managed). Moves to UF-managed hosting per the migration plan below.", status: "MET" },
  { control: "Single sign-on readiness", detail: "Pluggable auth layer with AUTH_MODE switch; GatorLink / Shibboleth drops in without code changes. Live SP registration remaining.", status: "PARTIAL" },
  { control: "Vulnerability scanning", detail: "0 production dependency vulnerabilities; 4 high advisories are dev-only (esbuild / vite / drizzle-kit). UF self-service scan pending.", status: "PARTIAL" },
  { control: "TLS in transit", detail: "HTTPS enforced on the current published endpoint; equivalent TLS provided at the platform layer after migration to UF hosting.", status: "MET" },
];

// Feature/change summary across the polish batches (through Jul 20, 2026).
const BATCH_SUMMARY: { batch: string; items: string }[] = [
  { batch: "Batch 1", items: "Core hardening — bcrypt auth, rate-limited login, 30-minute session timeout, append-only audit log, security headers." },
  { batch: "Batch 2", items: "Issue/return receipts (PDF), dashboard alerts, expiration and low-stock tracking, reports." },
  { batch: "Batch 3", items: "Serialized units (incl. dual-serial vests), sized clothing variants, kits, and multi-line issue cart." },
  { batch: "Batch 4", items: "UFPD Quartermaster branding, comprehensive form validation + phone normalization, role capability matrix, QR scan-to-cart, provider-agnostic email subsystem." },
  { batch: "Batch 5", items: "User-account email addresses, self-service password change, and admin password reset with a forced change at next sign-in." },
  { batch: "Batch 6", items: "Standardized condition vocabulary, condition capture at issuance, required issuance fields (issued by, location, signature), and dated receipt filenames." },
  { batch: "Batch 7", items: "Dated report/CSV filenames, inspection printed-name blocks, low-stock reports scoped to user accounts, and a secured weekly low-stock email trigger for an external scheduler." },
];

// Roles and their capabilities (mirrors lib/app-context.ts `can`).
const ROLES: { role: string; caps: string }[] = [
  { role: "Administrator", caps: "Full access — user accounts and password resets, inventory, issue/return, reports, email, and the Activity Log." },
  { role: "Quartermaster", caps: "Inventory, personnel, issue/return, kits, reports, and outbound email. Read access to the Activity Log (audit)." },
  { role: "Auditor", caps: "Read-only assurance — reports, the Activity Log, and this compliance view." },
];

// Operational policies established across Batches 5–7.
const OPS_POLICIES: { label: string; detail: string }[] = [
  { label: "Condition vocabulary", detail: "Seven standardized values — NEW, LIKE NEW, GOOD, FAIR, DAMAGED, MAINTENANCE, RETIRED — used everywhere condition is recorded, including capture at issuance." },
  { label: "Required issuance fields", detail: "Every issuance (cart and QR quick-issue) requires the issuing user, an issued location, and a recipient signature; enforced client- and server-side." },
  { label: "Receipt & report naming", detail: "Issuance receipts are named DATE_Items Issued_RECIPIENT; every generated report/CSV is named YYYY-MM-DD_Report Title (e.g. 2026-07-20_Inventory by Location.pdf)." },
  { label: "Low-stock reporting", detail: "Low-stock reports are emailed to user accounts (login accounts with an email on file) only. A secured endpoint lets an external scheduler send the weekly low-stock report to all quartermaster-role users automatically." },
];

// Email subsystem provider modes (#18).
const EMAIL_MODES: { mode: string; detail: string }[] = [
  { mode: "log (default)", detail: "Every message is recorded in the email log but not delivered — safe out of the box, no credentials required." },
  { mode: "resend", detail: "Delivers via the Resend HTTP API (RESEND_API_KEY + EMAIL_FROM). Each attempt is logged as sent or failed." },
  { mode: "smtp", detail: "Delivers via department SMTP (SMTP_HOST/PORT/USER/PASS/SECURE + EMAIL_FROM) — the intended mode on the UF server." },
];

// Steps to migrate off the disposable dev stack onto department infrastructure.
const MIGRATION_STEPS: string[] = [
  "Move the database to a department-managed Postgres / Supabase instance and repoint SUPABASE_URL / keys.",
  "Set EMAIL_PROVIDER=smtp with the department SMTP credentials (host, port, user, password, from address).",
  "Rotate APP_DB_SECRET and reset all user account passwords after cutover.",
  "Update the keep-alive / uptime monitoring to target the new host and verify audit logging continues.",
];

const REFS: { label: string; url: string }[] = [
  { label: "UF Data Classification Policy (12-011)", url: "https://policy.ufl.edu/policy/data-classification-policy/" },
  { label: "UF System Security Policy", url: "https://policy.ufl.edu/policy/system-security-policy/" },
  { label: "IRM Risk Requests & Assessments", url: "https://it.ufl.edu/security/audiences/faculty--staff/irm/risk-requests-and-assessments/" },
  { label: "UF Single Sign-On (Shibboleth)", url: "https://it.ufl.edu/iam/authentication-systems/single-sign-on/" },
  { label: "Research Computing PubApps Deployment", url: "https://docs.rc.ufl.edu/services/web_hosting/deployment/" },
  { label: "RC Web Hosting Risk Assessment", url: "https://docs.rc.ufl.edu/services/web_hosting/risk_assessment/" },
  { label: "UF Self-Service Vulnerability Scanner", url: "https://it.ufl.edu/security/security-guidance/uf-self-service-vulnerability-scanner/" },
  { label: "CJIS Security Policy v6.0 (FBI)", url: "https://lsp.org/media/dgxluyj3/cjis_security_policy_v6-0_20241227-1.pdf" },
];

function SummaryCard({ icon, kicker, value, tone, children }: {
  icon: ReactNode; kicker: string; value: string; tone: Tone; children: ReactNode;
}) {
  return (
    <Card className="p-5" data-testid={`card-summary-${kicker.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary border-primary/20">
          {icon}
        </span>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kicker}</div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xl font-semibold tracking-tight">{value}</span>
        <Pill tone={tone}>Determined</Pill>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </Card>
  );
}

const STATUS_ICON: Record<Control["status"], ReactNode> = {
  MET: <CircleCheck className="h-4 w-4 text-chart-2" />,
  PARTIAL: <CircleDot className="h-4 w-4 text-chart-3" />,
  PENDING: <CircleDashed className="h-4 w-4 text-destructive" />,
};

export default function Compliance() {
  const counts = {
    MET: CONTROLS.filter((c) => c.status === "MET").length,
    PARTIAL: CONTROLS.filter((c) => c.status === "PARTIAL").length,
    PENDING: CONTROLS.filter((c) => c.status === "PENDING").length,
  };

  return (
    <div>
      <PageHeader
        title="Compliance & Security Posture"
        subtitle="Classification, CJIS scoping, and control status for the UFIT information security review · Last updated 2026-07-20"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard icon={<FileLock2 className="h-[18px] w-[18px]" />} kicker="Data Classification" value="Sensitive" tone="amber">
          Under UF Policy 12-011&rsquo;s aggregation rule, officer identity linked to serialized equipment is Sensitive. No
          Restricted data (SSN, driver-license, PHI, FERPA, PCI) is collected.
        </SummaryCard>
        <SummaryCard icon={<ShieldCheck className="h-[18px] w-[18px]" />} kicker="CJIS Scope" value="Out of Scope" tone="green">
          The system holds administrative property records about University-owned equipment and department employees. It stores
          no FBI-sourced Criminal Justice Information and runs no NCIC / FCIC / III queries.
        </SummaryCard>
      </div>

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Control status</h3>
        <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-control-counts">
          <Pill tone="green">{counts.MET} Met</Pill>
          <Pill tone="amber">{counts.PARTIAL} Partial</Pill>
          <Pill tone="red">{counts.PENDING} Pending</Pill>
        </span>
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {CONTROLS.map((c, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3" data-testid={`control-${i}`}>
              <span className="mt-0.5 shrink-0">{STATUS_ICON[c.status]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{c.control}</p>
                  <Pill tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Application-side hardening is complete. Remaining Partial / Pending items depend on the hosting and identity platform
        and are unblocked once an IRM Risk Assessment number is issued, which gates SSO Service-Provider registration and
        Research Computing PubApps deployment.
      </p>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Roles &amp; capabilities</h3>
      </div>
      <Card className="overflow-hidden" data-testid="card-roles">
        <ul className="divide-y divide-border">
          {ROLES.map((r, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <Pill tone="blue">{r.role}</Pill>
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">{r.caps}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Operational policies</h3>
      </div>
      <Card className="overflow-hidden" data-testid="card-ops-policies">
        <ul className="divide-y divide-border">
          {OPS_POLICIES.map((p, i) => (
            <li key={i} className="px-4 py-3">
              <p className="text-sm font-medium">{p.label}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{p.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Feature summary — Batches 1–7</h3>
        <span className="text-xs text-muted-foreground">as of Jul 20, 2026</span>
      </div>
      <Card className="overflow-hidden" data-testid="card-batch-summary">
        <ul className="divide-y divide-border">
          {BATCH_SUMMARY.map((b, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <Pill tone="blue">{b.batch}</Pill>
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">{b.items}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Email subsystem</h3>
      </div>
      <Card className="p-4" data-testid="card-email-modes">
        <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
          Outbound email is provider-agnostic and ships in log-only mode: no messages leave the system until a provider is
          configured (SMTP is the intended mode on the UF server). Every send — issuance receipts, overdue-return reminders,
          low-stock reports to user accounts, and the automated weekly low-stock report — is recorded in the email log with its
          status. Interactive sends are restricted to administrators and quartermasters and captured in the Activity Log; the
          weekly low-stock trigger is a separate endpoint authenticated with a bearer secret for an external scheduler.
        </p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {EMAIL_MODES.map((m, i) => (
            <li key={i} className="flex items-start gap-3 px-3 py-2.5">
              <Pill tone={i === 0 ? "green" : "gray"}>{m.mode}</Pill>
              <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">{m.detail}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <Server className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">UF server migration</h3>
      </div>
      <Card className="p-4" data-testid="card-migration">
        <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
          Steps to move from the current disposable stack onto department-managed infrastructure when the IRM Risk Assessment
          clears deployment:
        </p>
        <ol className="space-y-2">
          {MIGRATION_STEPS.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-[13px] leading-snug text-muted-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-[11px] font-medium text-primary">{i + 1}</span>
              <span className="min-w-0 flex-1">{s}</span>
            </li>
          ))}
        </ol>
      </Card>

      <h3 className="mt-6 mb-3 text-sm font-semibold tracking-tight">References</h3>
      <Card className="p-4">
        <ul className="grid gap-2 sm:grid-cols-2">
          {REFS.map((r, i) => (
            <li key={i}>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"
                data-testid={`link-ref-${i}`}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {r.label}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
