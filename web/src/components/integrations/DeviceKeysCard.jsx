"use client"

import { useEffect, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/toast-provider';

export default function DeviceKeysCard() {
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [label, setLabel] = useState("")

  const { toast } = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/devices')
      const j = await res.json()
      if (res.ok) setKeys(j.keys || [])
      else toast?.error(j.message || 'Failed to load keys')
    } catch (e) {
      toast?.error('Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const createKey = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined })
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.message || 'Failed to create key')
      setNewKey(j)
      setLabel("")
      await load()
      toast?.success('Device key created')
    } catch (e) {
      toast?.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  const exampleEnv = (apiUrl, keyValue) => `API=${apiUrl}\nDEVICE_API_KEY=${keyValue}\n`;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>Create API keys for Raspberry Pi ingest and copy a ready .env.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input id="label" placeholder="Conference room Pi" value={label} onChange={e => setLabel(e.target.value)} />
          </div>
          <Button onClick={createKey} disabled={creating}>{creating ? 'Creating…' : 'New Device Key'}</Button>
        </div>

        {newKey && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm text-muted-foreground">Copy this key now. It won't be shown again:</div>
            <div className="font-mono text-sm break-all">{newKey.key}</div>
            <div className="text-sm mt-2">One-line install (Pi):</div>
            <pre className="bg-muted p-2 rounded text-xs overflow-auto">
              {`curl -fsSL "${currentOrigin}/api/install?device_key=${newKey.key}" | bash`}
            </pre>
            <div className="text-sm mt-2">Example <code>.env</code>:</div>
            <pre className="bg-muted p-2 rounded text-xs overflow-auto">
              {exampleEnv(currentOrigin, newKey.key)}
            </pre>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">Existing keys</div>
          <div className="space-y-2">
            {(keys || []).map(k => (
              <div key={k.id} className="flex items-center justify-between rounded border p-2">
                <div className="text-sm">
                  <div className="font-medium">{k.label || 'Untitled device'}</div>
                  <div className="text-muted-foreground">{k.key_masked}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleString()}` : 'Never used'}
                </div>
              </div>
            ))}
            {(!keys || keys.length === 0) && !loading && (
              <div className="text-sm text-muted-foreground">No device keys yet.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}


