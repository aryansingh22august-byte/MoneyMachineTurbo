import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import BacktesterPage from "./pages/BacktesterPage";
import ScalperTerminal from "./pages/ScalperTerminal";
import Login from "./pages/Login";

/**
 * Gate the UI behind a server-verified access check.
 *
 * This previously read `document.cookie.includes("auth_token=")`, which any
 * visitor could satisfy by typing one line into the browser console — the
 * token's signature was never checked. The cookie is now httpOnly, so the
 * decision has to come from the server, which actually verifies the JWT.
 *
 * Note this only gates the UI shell. It is not a substitute for server-side
 * authorisation: privileged tRPC calls are guarded independently by
 * protectedProcedure / adminProcedure.
 */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { authenticated: false }))
      .then((data) => {
        if (!cancelled) setStatus(data?.authenticated ? "allowed" : "denied");
      })
      .catch(() => {
        // Network/parse failure — fail closed rather than exposing the app.
        if (!cancelled) setStatus("denied");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-zinc-950">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "denied") return <Login />;

  return <>{children}</>;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/backtester"} component={BacktesterPage} />
      <Route path={"/scalper"} component={ScalperTerminal} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <AuthGuard>
            <Router />
          </AuthGuard>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
