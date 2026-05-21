import { useListBackendLogs } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Terminal, Database, Clock, Cpu } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function BackendPage() {
  const { data: logs, isLoading } = useListBackendLogs({ query: { refetchInterval: 30000 } });

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <div className="p-6 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Terminal className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Backend Activity</h1>
            <p className="text-sm text-muted-foreground">Real-time log of LLM calls and system events.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[180px]">Timestamp</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Loading logs...
                  </TableCell>
                </TableRow>
              ) : !logs || logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No backend activity recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} className="font-mono text-xs">
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Database className="w-3 h-3 text-muted-foreground" />
                        {log.event}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Cpu className="w-3 h-3 text-muted-foreground" />
                        {log.model || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {log.tokensUsed ? log.tokensUsed.toLocaleString() : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 text-muted-foreground">
                        {log.responseTimeMs ? (
                          <>
                            <Clock className="w-3 h-3" />
                            {log.responseTimeMs}ms
                          </>
                        ) : (
                          '-'
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={log.status === 'success' ? 'default' : 'destructive'} 
                        className="text-[10px] uppercase font-bold"
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
