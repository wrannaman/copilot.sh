"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/utils/supabase/client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Mic, Square, Loader2 } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { useTranscriptionStore } from "@/stores/transcription-session";

export default function RecordPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
        <AuthenticatedNav />
        <div className="container mx-auto max-w-4xl py-12 px-6">
          <RecordContent />
        </div>
      </div>
    </AuthGuard>
  );
}

function RecordContent() {
  const {
    isRecording,
    isSending,
    recentTranscripts,
    errorMessage,
    clearError,
    startRecording,
    stopRecording,
    nextSendAt,
    audioLevel,
    setPreferredDeviceId,
    preferredDeviceId
  } = useTranscriptionStore();

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");
  const [title, setTitle] = useState("");
  const [summaryPrompt, setSummaryPrompt] = useState("");

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Load audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
        // Prime permission
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());

        // Get devices
        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all.filter(d => d.kind === 'audioinput');
        setDevices(mics);

        // Auto-select CMTECK
        const cmteck = mics.find(d => d.label.toLowerCase().includes('cmteck'));
        if (cmteck) {
          setSelectedDeviceId(cmteck.deviceId);
          setPreferredDeviceId(cmteck.deviceId);
        }
      } catch (e) {
        console.warn('Device enumeration failed', e);
      }
    }
    loadDevices();
  }, []);

  // Load nearby calendar events (started in last 15m or starting in next 2h)
  useEffect(() => {
    async function loadEvents() {
      try {
        setEventsLoading(true)
        const supabase = createClient()
        const now = Date.now()
        const min = new Date(now - 15 * 60 * 1000).toISOString()
        const max = new Date(now + 2 * 60 * 60 * 1000).toISOString()
        const { data, error } = await supabase
          .from('calendar_events')
          .select('id,title,starts_at,ends_at')
          .gte('starts_at', min)
          .lte('starts_at', max)
          .order('starts_at', { ascending: true })
          .limit(5)
        if (!error && Array.isArray(data)) setEvents(data)
      } finally {
        setEventsLoading(false)
      }
    }
    loadEvents()
  }, [])



  return (
    <div className="space-y-8">
      {/* Main Recording Section */}
      <Card className="border-0 shadow-xl bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-8 pb-8">
          {/* Recording Controls - Centered Hero Section */}
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Record Session</h1>
              <div className="text-sm text-muted-foreground">
                {isRecording ? (
                  <span className="inline-flex items-center gap-2 text-green-600 font-medium">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    Recording in progress
                  </span>
                ) : isSending ? (
                  <span className="inline-flex items-center gap-2 text-blue-600">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Processing audio…
                  </span>
                ) : (
                  <span className="text-muted-foreground">Ready to record</span>
                )}
              </div>
            </div>

            {/* Large Recording Button */}
            <div className="py-4">
              {!isRecording ? (
                <Button
                  onClick={() => startRecording({ title, summaryPrompt })}
                  size="icon"
                  className="h-20 w-20 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
                >
                  <Mic className="h-8 w-8" />
                </Button>
              ) : (
                <Button
                  onClick={async () => {
                    try {
                      await stopRecording();
                    } catch (e) {
                      console.error('[STOP] failed:', e);
                    }
                  }}
                  size="icon"
                  variant="destructive"
                  className="h-20 w-20 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  <Square className="h-8 w-8" />
                </Button>
              )}
            </div>

            {/* Status Bar */}
            <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>Audio Level</span>
                <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-gradient-to-r from-green-400 to-green-600 transition-all duration-75"
                    style={{ width: `${Math.round(Math.min(100, Math.max(0, audioLevel * 100)))}%` }}
                  />
                </div>
              </div>
              {isRecording && nextSendAt && (
                <div className="flex items-center gap-2">
                  <span>Next chunk in {Math.max(0, Math.ceil((nextSendAt - Date.now()) / 1000))}s</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {errorMessage && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="text-destructive font-medium">{errorMessage}</p>
                <Button
                  onClick={clearError}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Transcripts */}
      {recentTranscripts.length > 0 && (
        <Card className="border-0 shadow-lg bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Live Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-40 overflow-y-auto">
              {recentTranscripts.map((transcript) => (
                <div key={transcript.seq} className="border-l-2 border-muted pl-4 py-2">
                  <div className="text-xs text-muted-foreground mb-1">{transcript.timestamp}</div>
                  <div className="text-sm leading-relaxed">{transcript.text}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recording Settings */}
      <Card className={`border-0 shadow-lg bg-card/60 backdrop-blur-sm ${isRecording ? 'opacity-60' : ''}`}>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            Recording Settings
            {isRecording && (
              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                Locked during recording
              </span>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isRecording
              ? "Settings are locked while recording is in progress."
              : "Configure your recording session before you start."
            }
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Microphone Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Microphone</Label>
            <Select
              value={selectedDeviceId}
              onValueChange={(v) => { setSelectedDeviceId(v); setPreferredDeviceId(v === 'default' ? null : v); }}
              disabled={isRecording}
            >
              <SelectTrigger className={`w-full ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <SelectValue placeholder="Select microphone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Session Details */}
          <div className="grid gap-4">
            <div className="space-y-3">
              <Label htmlFor="title" className="text-sm font-medium">Session Title (Optional)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Weekly sync with team"
                className={`transition-all focus:ring-2 focus:ring-primary/20 ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isRecording}
              />
            </div>

            {/* Calendar Events */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Quick Fill from Calendar</Label>
              <div className="flex flex-wrap gap-2">
                {eventsLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading events…
                  </div>
                )}
                {!eventsLoading && events.length === 0 && (
                  <span className="text-xs text-muted-foreground">No upcoming events found.</span>
                )}
                {events.map(ev => (
                  <Button
                    key={ev.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setTitle(ev.title || '')}
                    className={`text-xs hover:bg-primary/10 transition-colors ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={isRecording}
                  >
                    {(ev.title || 'Untitled')} · {new Date(ev.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="prompt" className="text-sm font-medium">AI Summary Instructions (Optional)</Label>
              <Textarea
                id="prompt"
                value={summaryPrompt}
                onChange={(e) => setSummaryPrompt(e.target.value)}
                placeholder="Summarize action items and decisions, highlight blockers."
                className={`min-h-[80px] transition-all focus:ring-2 focus:ring-primary/20 ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isRecording}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
