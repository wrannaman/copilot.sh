"use client";

import { useEffect, useMemo, useState, useCallback } from 'react';
import { withAuth, useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircleIcon, CheckIcon } from 'lucide-react';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import SnowflakeQueryDialog from '@/components/integrations/snowflake/QueryDialog';
import SnowflakeBrowseDialog from '@/components/integrations/snowflake/BrowseDialog';

function EditIntegrationButton({ item, onSaved }) {
  const { token } = useAuth();
  const apiUrl = ``
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...item.config, name: item.name, type: item.type });

  useEffect(() => {
    const cfg = item.config || {};
    const secret = cfg.password || cfg.token || '';
    setForm({ ...cfg, password: secret, name: item.name, type: item.type });
  }, [item]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name, type: form.type, config: {
            account: form.account,
            user: form.user,
            password: form.password,
            authenticator: form.authenticator,
            role: form.role,
            warehouse: form.warehouse,
            database: form.database,
            schema: form.schema,
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success('Integration updated');
      setOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error('Update failed', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Integration</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Name</Label>
            <Input className="col-span-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Account</Label>
            <Input className="col-span-3" value={form.account || ''} onChange={e => setForm({ ...form, account: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">User</Label>
            <Input className="col-span-3" value={form.user || ''} onChange={e => setForm({ ...form, user: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">{(/^https?:/i.test(form.authenticator || '') || (form.authenticator || 'PROGRAMMATIC_ACCESS_TOKEN').toUpperCase() === 'SNOWFLAKE') ? 'Password' : 'Token'}</Label>
            <Input className="col-span-3" type="password" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={(form.authenticator || '').toUpperCase() === 'SNOWFLAKE' ? 'Enter password' : 'Paste PAT / OAuth token'} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Authenticator</Label>
            <div className="col-span-3">
              <Select
                value={((/^https?:/i.test(form.authenticator || '')) ? 'CUSTOM' : (form.authenticator || 'PROGRAMMATIC_ACCESS_TOKEN').toUpperCase())}
                onValueChange={(v) => setForm(prev => (v === 'CUSTOM' ? { ...prev, authenticator: '', password: '' } : { ...prev, authenticator: v, password: '' }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select authenticator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROGRAMMATIC_ACCESS_TOKEN">Programmatic access token</SelectItem>
                  <SelectItem value="SNOWFLAKE">Username & Password</SelectItem>
                  <SelectItem value="CUSTOM">Custom authenticator URL</SelectItem>
                </SelectContent>
              </Select>
              {((form.authenticator || '') === '' || /^https?:/i.test(form.authenticator || '')) && (
                <Input className="mt-2" placeholder="https://youraccount.okta.com" value={form.authenticator || ''} onChange={e => setForm({ ...form, authenticator: e.target.value })} />
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Role</Label>
            <Input className="col-span-3" value={form.role || ''} onChange={e => setForm({ ...form, role: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Warehouse</Label>
            <Input className="col-span-3" value={form.warehouse || ''} onChange={e => setForm({ ...form, warehouse: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Database</Label>
            <Input className="col-span-3" value={form.database || ''} onChange={e => setForm({ ...form, database: e.target.value })} />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Schema</Label>
            <Input className="col-span-3" value={form.schema || ''} onChange={e => setForm({ ...form, schema: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }) {
  if (status === 'active') {
    return (
      <Badge variant="secondary" className="bg-emerald-500 text-white dark:bg-emerald-600 gap-1">
        <CheckIcon className="h-3.5 w-3.5" />
        Active
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertCircleIcon className="h-3.5 w-3.5" />
        Error
      </Badge>
    );
  }
  return <Badge variant="outline">Inactive</Badge>;
}

function IntegrationsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const apiUrl = ""
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [created, setCreated] = useState(null);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseId, setBrowseId] = useState(null);
  const [databases, setDatabases] = useState([]);
  const [browseName, setBrowseName] = useState('');
  const [schemas, setSchemas] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [selectedSchema, setSelectedSchema] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [sampleRows, setSampleRows] = useState(null);

  const [form, setForm] = useState({
    name: 'Snowflake',
    account: '',
    user: '',
    password: '',
    authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
    role: 'ACCOUNTADMIN',
    warehouse: '',
    database: '',
    schema: ''
  });
  const [integrationType, setIntegrationType] = useState('snowflake');

  const load = useCallback(async () => {
    const res = await fetch(`${apiUrl}/integrations`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok) setItems(data);
  }, [apiUrl, token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: form.name || 'Snowflake', type: integrationType, config: form })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create', { description: data.message || data.details });
        return;
      }
      setCreated(data);
      toast.success('Integration created', { description: 'Now test the connection.' });
      await load();
    } catch (e) {
      toast.error('Create failed', { description: e.message });
    } finally { setLoading(false); }
  }

  async function handleTest(integrationId) {
    setTestLoading(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/${integrationId}/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Connection failed', { description: data.message || data.details });
      } else {
        toast.success('Connection OK', { description: 'Snowflake credentials verified.' });
        await load();
      }
    } catch (e) {
      toast.error('Connection failed', { description: e.message });
    } finally { setTestLoading(false); }
  }



  async function openBrowse(id) {
    setBrowseId(id);
    const match = items.find((x) => x.id === id);
    setBrowseName(match?.name || '');
    setBrowseOpen(true);
    setSelectedDb('');
    setSelectedSchema('');
    setSelectedTable('');
    setSchemas([]);
    setTables([]);
    setSampleRows(null);
    try {
      const res = await fetch(`${apiUrl}/integrations/${id}/databases`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setDatabases(data.rows || []);
      else {
        toast.error(data.error || 'Load databases failed', { description: data.message || data.details });
      }
    } catch (e) {
      setDatabases([]);
      toast.error('Load databases failed', { description: e.message });
    }
  }

  async function loadSchemas(id, database) {
    try {
      const res = await fetch(`${apiUrl}/integrations/${id}/schemas?database=${encodeURIComponent(database)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setSchemas(data.rows || []);
      else {
        toast.error(data.error || 'Load schemas failed', { description: data.message || data.details });
      }
    } catch (e) {
      setSchemas([]);
      toast.error('Load schemas failed', { description: e.message });
    }
  }

  async function loadTables(id, database, schema) {
    try {
      const url = `${apiUrl}/integrations/${id}/tables?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setTables(data.rows || []);
      else {
        toast.error(data.error || 'Load tables failed', { description: data.message || data.details });
      }
    } catch (e) {
      setTables([]);
      toast.error('Load tables failed', { description: e.message });
    }
  }

  async function loadSampleRows() {
    if (!browseId || !selectedDb || !selectedSchema || !selectedTable) return;
    setTestLoading(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/${browseId}/sample-rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ database: selectedDb, schema: selectedSchema, table: selectedTable, limit: 25 })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to fetch rows', { description: data.message || data.details });
        setSampleRows(null);
      } else {
        setSampleRows(data.rows || []);
      }
    } catch (e) {
      setSampleRows(null);
      toast.error('Fetch rows failed', { description: e.message });
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />
      <main className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add Integration</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Snowflake Integration</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Integration Type</Label>
                  <div className="col-span-3">
                    <Select value={integrationType} onValueChange={setIntegrationType}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select integration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="snowflake">Snowflake</SelectItem>
                        <SelectItem value="more_coming" disabled>More coming soon…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Name</Label>
                  <Input className="col-span-3" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Account</Label>
                  <Input className="col-span-3" value={form.account} onChange={e => setForm({ ...form, account: e.target.value })} placeholder="e.g. ABCD-XY12345" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">User</Label>
                  <Input className="col-span-3" value={form.user} onChange={e => setForm({ ...form, user: e.target.value })} />
                </div>
                {((form.authenticator || 'PROGRAMMATIC_ACCESS_TOKEN').toUpperCase() === 'SNOWFLAKE') && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Password</Label>
                    <Input type="password" className="col-span-3" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Enter password" />
                  </div>
                )}
                {((form.authenticator || 'PROGRAMMATIC_ACCESS_TOKEN').toUpperCase() === 'PROGRAMMATIC_ACCESS_TOKEN') && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Token</Label>
                    <Input className="col-span-3" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Paste PAT / OAuth token" />
                  </div>
                )}
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Authenticator</Label>
                  <div className="col-span-3">
                    <Select
                      value={(form.authenticator || 'PROGRAMMATIC_ACCESS_TOKEN').toUpperCase()}
                      onValueChange={(v) => setForm(prev => ({ ...prev, authenticator: v, password: '' }))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select authenticator" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PROGRAMMATIC_ACCESS_TOKEN">Programmatic access token</SelectItem>
                        <SelectItem value="SNOWFLAKE">Username & Password</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Role</Label>
                  <Input className="col-span-3" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Warehouse</Label>
                  <Input className="col-span-3" value={form.warehouse} onChange={e => setForm({ ...form, warehouse: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Database</Label>
                  <Input className="col-span-3" value={form.database} onChange={e => setForm({ ...form, database: e.target.value })} />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Schema</Label>
                  <Input className="col-span-3" value={form.schema} onChange={e => setForm({ ...form, schema: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={async () => { await handleCreate(); setOpen(false); }} disabled={loading}>{loading ? 'Creating...' : 'Create'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configured Integrations</CardTitle>
            <CardDescription>Manage and test your data connections.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Tested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.name}</TableCell>
                    <TableCell>{it.type}</TableCell>
                    <TableCell><StatusBadge status={it.status} /></TableCell>
                    <TableCell>{it.last_tested_at ? new Date(it.last_tested_at).toLocaleString() : '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => handleTest(it.id)} disabled={testLoading}>{testLoading ? 'Testing...' : 'Test'}</Button>
                        {it.type === 'snowflake' && <SnowflakeQueryDialog item={it} />}
                        {it.type === 'snowflake' && <SnowflakeBrowseDialog item={it} />}
                        <EditIntegrationButton item={it} onSaved={load} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">No integrations yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

          </CardContent>
        </Card>

        {/* legacy browse dialog removed; handled by per-row component */}
      </main>
    </div>
  );
}

export default withAuth(IntegrationsPage);


