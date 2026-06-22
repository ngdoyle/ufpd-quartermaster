import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider, useApp } from "@/lib/app-context";
import { AppShell } from "@/components/layout";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import Officers from "@/pages/officers";
import IssueReturn from "@/pages/issue";
import Kits from "@/pages/kits";
import Scan from "@/pages/scan";
import Reports from "@/pages/reports";
import Audit from "@/pages/audit";
import Users from "@/pages/users";
import Compliance from "@/pages/compliance";
import NotFound from "@/pages/not-found";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/inventory": "Inventory",
  "/officers": "Officers",
  "/issue": "Issue & Return",
  "/kits": "Kits",
  "/scan": "Scan",
  "/reports": "Reports",
  "/audit": "Audit Log",
  "/users": "Users",
  "/compliance": "Compliance",
  "/change-password": "Change Password",
};

function Shell() {
  const [location] = useHashLocation();
  const title = TITLES[location] ?? "Quartermaster";
  return (
    <AppShell title={title}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/officers" component={Officers} />
        <Route path="/issue" component={IssueReturn} />
        <Route path="/kits" component={Kits} />
        <Route path="/scan" component={Scan} />
        <Route path="/reports" component={Reports} />
        <Route path="/audit" component={Audit} />
        <Route path="/users" component={Users} />
        <Route path="/compliance" component={Compliance} />
        <Route path="/change-password" component={() => <ChangePassword />} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function Gate() {
  const { user } = useApp();
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword forced />;
  return <Shell />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <Gate />
          </Router>
        </TooltipProvider>
      </AppProvider>
    </QueryClientProvider>
  );
}

export default App;
