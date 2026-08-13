import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useApp, can, roleLabel } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, Package, Users, ArrowLeftRight, Boxes,
  FileBarChart, ScanLine, ShieldCheck, Sun, Moon, LogOut, Menu, KeyRound, ScrollText, FileCheck2, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import badgeUrl from "@/assets/badge.png";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-label="Quartermaster logo">
      <path d="M16 2 L28 7 V15 C28 23 22.5 28 16 30 C9.5 28 4 23 4 15 V7 Z"
        fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11 16 L14.5 19.5 L21.5 12" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 2 L28 7 V15 C28 23 22.5 28 16 30" stroke="currentColor" strokeWidth="1.6"
        strokeLinejoin="round" opacity="0.45" />
    </svg>
  );
}

interface NavItem { href: string; label: string; icon: any; show: (r: any) => boolean; }

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, show: () => true },
  { href: "/inventory", label: "Inventory", icon: Package, show: () => true },
  { href: "/officers", label: "Personnel", icon: Users, show: () => true },
  { href: "/issue", label: "Issue & Return", icon: ArrowLeftRight, show: (r) => can.issueReturn(r) },
  { href: "/kits", label: "Kit Templates", icon: Boxes, show: (r) => can.issueReturn(r) },
  { href: "/scan", label: "Scan", icon: ScanLine, show: () => true },
  { href: "/reports", label: "Reports", icon: FileBarChart, show: (r) => can.viewReports(r) },
  { href: "/audit", label: "Activity Log", icon: ScrollText, show: (r) => can.viewAudit(r) },
  { href: "/email", label: "Email", icon: Mail, show: (r) => can.email(r) },
  { href: "/users", label: "User Accounts", icon: ShieldCheck, show: (r) => can.manageUsers(r) },
  { href: "/compliance", label: "Compliance", icon: FileCheck2, show: (r) => can.viewCompliance(r) },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useApp();
  const [loc] = useLocation();
  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main">
      {NAV.filter((n) => n.show(user?.role)).map((n) => {
        const active = loc === n.href;
        const Icon = n.icon;
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate}>
            <span
              data-testid={`link-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover-elevate"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {n.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <img src={badgeUrl} alt="UFPD Quartermaster badge" className="h-9 w-auto" />
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight text-white">UFPD Quartermaster</div>
          <div className="text-[11px] text-sidebar-foreground/55">Asset & Issue Management</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <div className="px-5 py-3 text-[11px] text-sidebar-foreground/40 border-t border-sidebar-border">
        UFPD · v1.0
      </div>
    </div>
  );
}

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { user, setUser, theme, toggleTheme } = useApp();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const initials = user?.name?.split(" ").map((p) => p[0]).slice(0, 2).join("") ?? "U";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-64 shrink-0 border-r border-sidebar-border">
        <SidebarInner />
      </aside>

      {/* Mobile sidebar */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-64 border-sidebar-border">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarInner onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} data-testid="button-menu">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-base md:text-lg font-semibold tracking-tight truncate">{title}</h1>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={toggleTheme} data-testid="button-theme" aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full pl-1 pr-2.5 py-1 hover-elevate" data-testid="button-user-menu">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    {initials}
                  </span>
                  <span className="hidden sm:block text-left leading-tight">
                    <span className="block text-[13px] font-medium">{user?.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{user ? roleLabel[user.role] : ""}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{user?.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/change-password")} data-testid="menu-change-password">
                  <KeyRound className="mr-2 h-4 w-4" /> Change password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setUser(null); navigate("/"); }} data-testid="menu-logout">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
