"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Mic, Square, Loader2 } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { useTranscriptionStore } from "@/stores/transcription";

export default function RecordPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <div className="container mx-auto max-w-3xl py-8">
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
    textArray,
    currentPartial,
    recentTranscripts,
    errorMessage,
    clearError,
    startRecording,
    stopAndFlush,
    sendText
  } = useTranscriptionStore();

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");

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
        if (cmteck) setSelectedDeviceId(cmteck.deviceId);
      } catch (e) {
        console.warn('Device enumeration failed', e);
      }
    }
    loadDevices();
  }, []);

  const currentText = textArray.join(' ');
  const preview = currentText + (currentPartial ? ' ' + currentPartial : '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recorder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {isRecording ? (
              <span className="inline-flex items-center gap-2 text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Recording • Sends every 5s
              </span>
            ) : isSending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="text-muted-foreground">Idle</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <Button onClick={startRecording} size="icon" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                <Mic className="h-7 w-7 sm:h-8 sm:w-8" />
              </Button>
            ) : (
              <Button onClick={async () => {
                try {
                  await stopAndFlush();
                } catch (e) {
                  console.error('[STOP FLUSH] failed:', e);
                }
              }} size="icon" variant="destructive" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                <Square className="h-7 w-7 sm:h-8 sm:w-8" />
              </Button>
            )}
          </div>
        </div>
        {errorMessage && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
            <button
              onClick={clearError}
              className="text-xs underline decoration-dotted hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Microphone selector */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">Microphone</Label>
          <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
            <SelectTrigger className="w-full">
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
        {preview && (
          <div className="rounded-md border p-2 text-sm flex items-center justify-between">
            <div>
              <span className="text-muted-foreground"></span> {preview}
            </div>
            {isSending && (
              <span className="ml-3 text-xs text-muted-foreground">Saving…</span>
            )}
          </div>
        )}

        {/* Recent Transcripts */}
        {recentTranscripts.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Recent Transcripts</Label>
            <div className="space-y-1 p-3 bg-muted/50 rounded-md">
              {recentTranscripts.map((transcript) => (
                <div key={transcript.seq} className="text-sm">
                  <span className="text-xs text-muted-foreground">{transcript.timestamp}</span>
                  <div className="pl-2 text-foreground">{transcript.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
