import { useQuery } from "@tanstack/react-query";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import { fmtDateTime, exportCsv } from "@/lib/format";
import type { AuditEntry } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download } from "lucide-react";

const TONE: Record<string, any> = {
  issue: "blue", return: "green", issue_kit: "blue", create_item: "green", update_item: "gray",
  delete_item: "red", create_officer: "green", delete_officer: "red", login: "gray",
  inspect: "amber", create_kit: "green", change_password: "gray",
};

export default function Audit() {
  const { data, isLoading } = useQuery<AuditEntry[]>({ queryKey: ["/api/audit"] });

  return (
    <div>
      <PageHeader title="Activity Log" subtitle="Append-only record of every transaction"
        actions={<Button variant="outline" size="sm" disabled={!data?.length}
          onClick={() => exportCsv("activity_log.csv", (data ?? []).map((e) => ({ Time: e.timestamp, User: e.username, Action: e.action, Detail: e.detail })))}>
          <Download className="mr-1.5 h-4 w-4" /> Export CSV</Button>} />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : !data?.length ? <EmptyState title="No activity recorded" /> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3" data-testid={`audit-${e.id}`}>
                <Pill tone={TONE[e.action] ?? "gray"}>{e.action.replace(/_/g, " ")}</Pill>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm leading-snug">{e.detail}</p>
                  <p className="text-[11px] text-muted-foreground">{e.username ?? "system"} · {fmtDateTime(e.timestamp)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
