import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { ChatPage } from "@/pages/chat";
import { DashboardPage } from "@/pages/dashboard";
import { BackendPage } from "@/pages/backend";
import { RankingsPage } from "@/pages/rankings";
import { HealthMonitorPage } from "@/pages/health-monitor";
import { DailyOverviewPage } from "@/pages/daily-overview";
import { ArchivePage } from "@/pages/archive";
import { KeywordGeneratorPage } from "@/pages/keyword-generator";
import { AEOKeywordStrategyPage } from "@/pages/aeo-keyword-strategy";
import { HistoryProvider, useHistory } from "@/contexts/history-context";
import { onChatCompletion } from "@/hooks/use-global-chat";

// Bridges global chat completions into the history sidebar
function ChatHistoryBridge() {
  const { addEntry } = useHistory();
  useEffect(() => {
    return onChatCompletion((msg, bizName) => {
      const isError = msg.content.startsWith("Could not reach") || msg.content.startsWith("Request timed out");
      if (!isError) {
        addEntry({
          type: "AEO Chat",
          businessName: bizName || "Portfolio Overview",
          traceUrl: msg.traceUrl ?? null,
          result: msg.content.slice(0, 500),
        });
      }
    });
  }, [addEntry]);
  return null;
}

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <ChatHistoryBridge />
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/backend" component={BackendPage} />
        <Route path="/rankings" component={RankingsPage} />
        <Route path="/health-monitor" component={HealthMonitorPage} />
        <Route path="/daily-overview" component={DailyOverviewPage} />
        <Route path="/archive" component={ArchivePage} />
        <Route path="/keyword-generator" component={KeywordGeneratorPage} />
        <Route path="/aeo-keyword-strategy" component={AEOKeywordStrategyPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <HistoryProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </HistoryProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
