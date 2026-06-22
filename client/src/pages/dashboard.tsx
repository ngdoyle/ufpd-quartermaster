import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, Pill, EmptyState } from "@/components/bits";
import { fmtCurrency, fmtDate, relativeDays, fmtDateTime } from "@/lib/format";
import { useApp } from "@/lib/app-context";
import {
  Package, Users, ArrowLeftRight, AlertTriangle, Clock, CalendarX2, Wrench, DollarSign,
} from "lucide-react";

interface Item { id: number; name: string; quantity: number; parLevel: number; expirationDate?: string | null; location?: string | null; }
interface Dash {
  counts: Record<string, number>;
  lowStock: Item[];
  expiring: Item[];
  overdue: any[];
  recent: { id: number; action: string; detail: string; username?: string; timestamp: string }[];
}

export default function Dashboard() {
  const { user } = useApp();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<Dash>({ queryKey: ["/api/dashboard"] });
  const { data: officers } = useQuery<any[]>({ queryKey: ["/api/officers"] });

  const officerName = (id: number) => {
    const o = officers?.find((x) => x.id === id);
    return o ? `${o.lastName}, ${o.firstName}` : `Officer #${id}`;
  };

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}
      </div>
    );
  }

  const c = data.counts;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Welcome back, {user?.name?.split(" ").slice(-1)}. Here's your inventory at a glance.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Items" value={c.items} tone="blue" icon={<Package className="h-5 w-5" />} onClick={() => navigate("/inventory")} />
        <StatCard label="Currently Issued" value={c.issued} tone="purple" icon={<ArrowLeftRight className="h-5 w-5" />} onClick={() => navigate("/issue")} />
        <StatCard label="Personnel" value={c.officers} tone="blue" icon={<Users className="h-5 w-5" />} onClick={() => navigate("/officers")} />
        <StatCard label="Inventory Value" value={fmtCurrency(c.totalValue)} tone="green" icon={<DollarSign className="h-5 w-5" />} />
        <StatCard label="Low Stock" value={c.lowStock} tone={c.lowStock ? "amber" : "gray"} icon={<AlertTriangle className="h-5 w-5" />} onClick={() => navigate("/reports")} />
        <StatCard label="Overdue Returns" value={c.overdue} tone={c.overdue ? "red" : "gray"} icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Expiring (90d)" value={c.expiring} tone={c.expiring ? "amber" : "gray"} icon={<CalendarX2 className="h-5 w-5" />} />
        <StatCard label="In Maintenance" value={c.maintenance} tone={c.maintenance ? "amber" : "gray"} icon={<Wrench className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Overdue */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold">Overdue Returns</h3>
          </div>
          {data.overdue.length === 0 ? <EmptyState title="Nothing overdue" hint="All issued items are within their due dates." /> : (
            <ul className="divide-y divide-border">
              {data.overdue.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{officerName(a.officerId)}</span>
                  <Pill tone="red">{relativeDays(a.dueDate)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Low stock */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-chart-3" />
            <h3 className="text-sm font-semibold">Reorder Needed (at/below PAR)</h3>
          </div>
          {data.lowStock.length === 0 ? <EmptyState title="Stock levels healthy" /> : (
            <ul className="divide-y divide-border">
              {data.lowStock.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{i.name}</span>
                  <Pill tone="amber">{i.quantity} / PAR {i.parLevel}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Expiring */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarX2 className="h-4 w-4 text-chart-3" />
            <h3 className="text-sm font-semibold">Expiring & Expired</h3>
          </div>
          {data.expiring.length === 0 ? <EmptyState title="No upcoming expirations" /> : (
            <ul className="divide-y divide-border">
              {data.expiring.map((i) => {
                const overdue = i.expirationDate && new Date(i.expirationDate) < new Date();
                return (
                  <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="truncate">{i.name}</span>
                    <Pill tone={overdue ? "red" : "amber"}>{overdue ? "Expired " : ""}{fmtDate(i.expirationDate)}</Pill>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Recent activity */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Recent Activity</h3>
          </div>
          {data.recent.length === 0 ? <EmptyState title="No activity yet" /> : (
            <ul className="space-y-2.5">
              {data.recent.map((e) => (
                <li key={e.id} className="text-sm">
                  <p className="leading-snug">{e.detail}</p>
                  <p className="text-[11px] text-muted-foreground">{e.username ?? "system"} · {fmtDateTime(e.timestamp)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
