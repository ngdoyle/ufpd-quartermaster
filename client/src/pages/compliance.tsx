import { PageHeader, Pill } from "@/components/bits";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck, FileLock2, CircleCheck, CircleDashed, CircleDot, ExternalLink,
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
  { control: "Role-based access control", detail: "Capability checks per role (Administrator, Quartermaster, Supervisor, Officer, Auditor).", status: "MET" },
  { control: "Encryption at rest", detail: "SQLCipher / AES-256 on the database. Application layer complete; host-disk layer pending on RC hosting.", status: "PARTIAL" },
  { control: "Single sign-on readiness", detail: "Pluggable auth layer with AUTH_MODE switch; GatorLink / Shibboleth drops in without code changes. Live SP registration remaining.", status: "PARTIAL" },
  { control: "Vulnerability scanning", detail: "0 production dependency vulnerabilities; 4 high advisories are dev-only (esbuild / vite / drizzle-kit). UF self-service scan pending.", status: "PARTIAL" },
  { control: "TLS in transit", detail: "Provided at the platform layer once deployed to a *.rc.ufl.edu PubApps host.", status: "PENDING" },
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
        subtitle="Classification, CJIS scoping, and control status for the UFIT information security review"
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
