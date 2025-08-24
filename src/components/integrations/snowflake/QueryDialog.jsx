"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/components/toast-provider';

export default function SnowflakeQueryDialog({ item }) {
  const { token } = useAuth();
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', []);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [sqlText, setSqlText] = useState('SELECT CURRENT_DATABASE(), CURRENT_SCHEMA(), CURRENT_WAREHOUSE(), CURRENT_ROLE();');
  const [rows, setRows] = useState(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/${item.id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sqlText })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Query failed', { description: data.message || data.details });
        setRows(null);
      } else {
        setRows(data.rows || []);
        toast.success('Query executed');
      }
    } catch (e) {
      setRows(null);
      toast.error('Query failed', { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Run Query</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run SQL — {item.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col w-full min-w-0 space-y-3">
          <textarea
            className="w-full min-h-40 rounded-md border bg-background px-3 py-2 text-sm"
            value={sqlText}
            onChange={e => setSqlText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
            placeholder="SELECT ..."
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground w-full">
            <span>Press Cmd/Ctrl+Enter to run</span>
            <div className="space-x-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
              <Button onClick={run} disabled={running}>{running ? 'Running…' : 'Run'}</Button>
            </div>
          </div>
          {Array.isArray(rows) && (
            <div className="w-full min-w-0 space-y-2">
              <div className="text-sm text-muted-foreground">Returned {rows.length} row(s)</div>
              {rows.length > 0 && (
                <div className="w-full min-w-0 border rounded-md overflow-x-auto overflow-y-auto max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(rows[0]).map((key) => (
                          <TableHead key={key}>{key}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 50).map((row, idx) => (
                        <TableRow key={idx}>
                          {Object.keys(rows[0]).map((key) => (
                            <TableCell key={key}>{String(row[key])}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


