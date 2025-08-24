"use client";

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/components/toast-provider';

export default function SnowflakeBrowseDialog({ item, trigger }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', []);

  const [open, setOpen] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [selectedSchema, setSelectedSchema] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  const ensureDbs = async () => {
    if (databases.length) return;
    try {
      const res = await fetch(`${apiUrl}/integrations/${item.id}/databases`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setDatabases(data.rows || []);
      else toast.error(data.error || 'Load databases failed', { description: data.message || data.details });
    } catch (e) {
      toast.error('Load databases failed', { description: e.message });
    }
  };

  const loadSchemas = async (database) => {
    try {
      const res = await fetch(`${apiUrl}/integrations/${item.id}/schemas?database=${encodeURIComponent(database)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setSchemas(data.rows || []);
      else toast.error(data.error || 'Load schemas failed', { description: data.message || data.details });
    } catch (e) { toast.error('Load schemas failed', { description: e.message }); }
  };

  const loadTables = async (database, schema) => {
    try {
      const url = `${apiUrl}/integrations/${item.id}/tables?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setTables(data.rows || []);
      else toast.error(data.error || 'Load tables failed', { description: data.message || data.details });
    } catch (e) { toast.error('Load tables failed', { description: e.message }); }
  };

  const loadRows = async () => {
    if (!selectedDb || !selectedSchema || !selectedTable) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/${item.id}/sample-rows`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ database: selectedDb, schema: selectedSchema, table: selectedTable, limit: 25 })
      });
      const data = await res.json();
      if (res.ok) setRows(data.rows || []);
      else { setRows(null); toast.error(data.error || 'Failed to fetch rows', { description: data.message || data.details }); }
    } catch (e) { setRows(null); toast.error('Fetch rows failed', { description: e.message }); }
    finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={async (v) => { setOpen(v); if (v) await ensureDbs(); }}>
      <DialogTrigger asChild>
        {trigger || <Button variant="secondary">Browse</Button>}
      </DialogTrigger>
      <DialogContent className={`${Array.isArray(rows) && rows.length > 0 ? 'md:max-w-[1200px]' : 'sm:max-w-xl md:max-w-2xl'}`}>
        <DialogHeader>
          <DialogTitle>Browse Data — {item.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col w-full min-w-0 space-y-4 overflow-x-hidden">
          <div className="w-full min-w-0 space-y-4">
            <div className="grid grid-cols-4 items-center gap-4 min-w-0">
              <Label className="text-right">Database</Label>
              <select className="col-span-3 w-full max-w-full min-w-0 border rounded-md px-3 py-1.5 bg-background text-sm" value={selectedDb}
                onChange={async (e) => { const v = e.target.value; setSelectedDb(v); setSelectedSchema(''); setSelectedTable(''); setTables([]); setRows(null); if (v) await loadSchemas(v); }}>
                <option value="">Select database</option>
                {databases.map((d, idx) => (<option key={idx} value={d.name || d.database_name || d['name']}>{d.name || d.database_name || d['name']}</option>))}
              </select>
            </div>

            <div className="grid grid-cols-4 items-center gap-4 min-w-0">
              <Label className="text-right">Schema</Label>
              <select className="col-span-3 w-full max-w-full min-w-0 border rounded-md px-3 py-1.5 bg-background text-sm" value={selectedSchema}
                onChange={async (e) => { const v = e.target.value; setSelectedSchema(v); setSelectedTable(''); setRows(null); if (v && selectedDb) await loadTables(selectedDb, v); }} disabled={!selectedDb}>
                <option value="">Select schema</option>
                {schemas.map((s, idx) => (<option key={idx} value={s.name || s.schema_name || s['name']}>{s.name || s.schema_name || s['name']}</option>))}
              </select>
            </div>

            <div className="grid grid-cols-4 items-center gap-4 min-w-0">
              <Label className="text-right">Table</Label>
              <select className="col-span-3 w-full max-w-full min-w-0 border rounded-md px-3 py-1.5 bg-background text-sm" value={selectedTable}
                onChange={(e) => { setSelectedTable(e.target.value); setRows(null); }} disabled={!selectedDb || !selectedSchema}>
                <option value="">Select table</option>
                {tables.map((t, idx) => (<option key={idx} value={t.name}>{t.name}</option>))}
              </select>
            </div>

            <div className="flex justify-end ">
              <Button onClick={loadRows} disabled={!selectedDb || !selectedSchema || !selectedTable || loading}>{loading ? 'Loading…' : 'Load Rows'}</Button>
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


