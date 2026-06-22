import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONE: Record<string, string> = {
  green: "bg-chart-2/15 text-chart-2 border-chart-2/25",
  blue: "bg-primary/12 text-primary border-primary/25",
  amber: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  red: "bg-destructive/12 text-destructive border-destructive/25",
  gray: "bg-muted text-muted-foreground border-border",
  purple: "bg-chart-4/15 text-chart-4 border-chart-4/30",
};

export function Pill({ tone = "gray", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, keyof typeof TONE> = {
    in_stock: "green", issued: "blue", maintenance: "amber", retired: "gray",
    active: "blue", returned: "gray", inactive: "gray",
  };
  const label: Record<string, string> = {
    in_stock: "In Stock", issued: "Issued", maintenance: "Maintenance", retired: "Retired",
    active: "Active", returned: "Returned", inactive: "Inactive",
  };
  return <Pill tone={map[status] ?? "gray"}>{label[status] ?? status}</Pill>;
}

export function TypeBadge({ type }: { type: string }) {
  const map: Record<string, keyof typeof TONE> = { consumable: "amber", returnable: "blue", unique: "purple" };
  const label: Record<string, string> = { consumable: "Consumable", returnable: "Returnable", unique: "Serialized" };
  return <Pill tone={map[type] ?? "gray"}>{label[type] ?? type}</Pill>;
}

export function StatCard({ label, value, icon, tone = "blue", onClick }: {
  label: string; value: ReactNode; icon: ReactNode; tone?: keyof typeof TONE; onClick?: () => void;
}) {
  return (
    <Card
      className={cn("p-4 flex items-center gap-3", onClick && "cursor-pointer hover-elevate")}
      onClick={onClick}
      data-testid={`stat-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border", TONE[tone])}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{label}</div>
      </div>
    </Card>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
