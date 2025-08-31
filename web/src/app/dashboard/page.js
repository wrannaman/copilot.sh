"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";

import Link from "next/link";
import {
  Mic,
  Search,
  Settings,
  Zap,
  Upload,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { SearchComponent } from '@/components/search/search';
// Removed inline GoogleCalendarCard from dashboard; use dedicated Integrations page
import QuickActions from '@/components/dashboard/QuickActions'

import TextIngestCard from '@/components/dashboard/TextIngestCard'
import { createClient as createSbClient } from '@/utils/supabase/client'

function DashboardContent() {
  const { user, currentOrganization } = useAuth();


  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSummaryPrompt, setUploadSummaryPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(""); // Status messages
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);

  async function handleUploadFile(file) {
    if (!file) return;

    try {
      setUploading(true);
      setUploadSuccess(false);
      setUploadStatus(`Preparing upload for ${file.name}...`);

      // 1) Create session with optional title/prompt
      setUploadStatus("Creating session...");
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: uploadTitle || null,
          summary_prompt: uploadSummaryPrompt || null
        })
      });

      if (!res.ok) throw new Error(`create session ${res.status}`);
      const data = await res.json();
      const sessionId = data?.session_id;
      const sessionOrgId = data?.session?.organization_id;
      if (!sessionId) throw new Error('no session id');

      // 2) Request signed upload URL and upload (bypass RLS limits)
      setUploadStatus("Uploading audio file...");
      const supabase = createSbClient();
      const mime = file.type || 'audio/webm';
      const signRes = await fetch(`/api/sessions/${sessionId}/signed-upload`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mimeType: mime })
      });
      if (!signRes.ok) throw new Error(`sign failed ${signRes.status}`);
      const { token, path } = await signRes.json();
      if (!token || !path) throw new Error('sign missing token or path');
      const { error: uploadErr } = await supabase.storage
        .from('copilot.sh')
        .uploadToSignedUrl(path, token, file, { contentType: mime });
      if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`);

      // 3) Finalize with optional fields
      setUploadStatus("Processing and transcribing...");
      const fin = await fetch(`/api/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: uploadTitle || null,
          summary_prompt: uploadSummaryPrompt || null
        })
      });
      if (!fin.ok) throw new Error(`finalize failed ${fin.status}`);

      // Success! But transcription is still processing
      setUploadSuccess(true);
      setUploadStatus("✅ Upload successful! Processing and transcribing audio...");

      // Poll session status to show when actually ready
      const pollStatus = async () => {
        try {
          const statusRes = await fetch(`/api/sessions/${sessionId}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status === 'ready') {
              setUploadStatus("✅ Audio transcribed and ready to search!");
              setTimeout(() => {
                setUploadTitle("");
                setUploadSummaryPrompt("");
                setUploadStatus("");
                setUploadSuccess(false);
                setSelectedFile(null);
                setUploadOpen(false);
              }, 2000);
              return;
            } else if (statusData.status === 'error') {
              setUploadStatus("❌ Transcription failed. Please try again.");
              setUploadSuccess(false);
              return;
            }
          }
          // Continue polling if still processing
          setTimeout(pollStatus, 2000);
        } catch (e) {
          console.warn('Status polling failed:', e);
          setTimeout(pollStatus, 3000);
        }
      };

      setTimeout(pollStatus, 1000);

    } catch (e) {
      console.warn('upload failed', e);
      setUploadStatus(`❌ Upload failed: ${e.message}`);
      setUploadSuccess(false);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              {currentOrganization?.logo_url && (
                <img
                  src={currentOrganization.logo_url}
                  alt={`${currentOrganization.org_name || currentOrganization.name} logo`}
                  className="h-12 w-12 object-contain rounded"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground">
                Search your conversations, find commitments, and never forget important details
              </p>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/record">
                    <Mic className="h-4 w-4 mr-2" />
                    Start Recording
                  </Link>
                </Button>

                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Audio
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Upload Audio File</DialogTitle>
                      <DialogDescription>
                        Upload an existing audio file to transcribe and summarize.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="upload-title">Session Title (Optional)</Label>
                        <Input
                          id="upload-title"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          placeholder="Weekly sync with team"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="upload-prompt">AI Summary Instructions (Optional)</Label>
                        <Textarea
                          id="upload-prompt"
                          value={uploadSummaryPrompt}
                          onChange={(e) => setUploadSummaryPrompt(e.target.value)}
                          placeholder="Summarize action items and decisions, highlight blockers."
                          className="min-h-[80px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Audio File</Label>
                        <div
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const f = e.dataTransfer.files?.[0];
                            if (f) {
                              setSelectedFile(f);
                              setUploadSuccess(false);
                            }
                          }}
                          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${selectedFile ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}`}
                        >
                          {!selectedFile ? (
                            <div className="space-y-3">
                              <div className="text-sm text-muted-foreground">
                                Drag and drop your audio file here, or
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                              >
                                Choose File
                              </Button>
                              <div className="text-xs text-muted-foreground">
                                Supports MP3, WAV, M4A, and WebM formats
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-3 py-1">
                              <CheckCircle className="h-8 w-8 text-green-600" />
                              <div className="text-sm font-medium">File selected</div>
                              <div className="text-sm">
                                <span className="font-semibold">{selectedFile.name}</span>
                                {typeof selectedFile.size === 'number' && (
                                  <span className="text-muted-foreground"> · {(selectedFile.size < 1024 * 1024)
                                    ? `${Math.max(1, Math.round(selectedFile.size / 1024))} KB`
                                    : `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => fileInputRef.current?.click()}
                                  disabled={uploading}
                                >
                                  Replace file
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedFile(null);
                                    setUploadSuccess(false);
                                  }}
                                  disabled={uploading}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/*,video/webm"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                setSelectedFile(f);
                                setUploadSuccess(false);
                              }
                              e.target.value = '';
                            }}
                            className="hidden"
                          />
                        </div>
                      </div>

                      {/* Status Messages */}
                      {uploadStatus && (
                        <div className={`p-3 rounded-lg text-sm ${uploadSuccess
                          ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                          : uploading
                            ? 'bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
                            : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                          }`}>
                          <div className="flex items-center gap-2">
                            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                            <span>{uploadStatus}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <DialogFooter className="sm:justify-between">
                      {!uploading && !uploadSuccess && (
                        <>
                          <Button
                            onClick={async () => {
                              if (!selectedFile) return;
                              await handleUploadFile(selectedFile);
                            }}
                            disabled={!selectedFile}
                          >
                            Save & Process
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setUploadOpen(false);
                              setUploadStatus("");
                              setUploadSuccess(false);
                              setSelectedFile(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {uploadSuccess && (
                        <Button
                          onClick={() => {
                            setUploadTitle("");
                            setUploadSummaryPrompt("");
                            setUploadStatus("");
                            setUploadSuccess(false);
                            setSelectedFile(null);
                            setUploadOpen(false);
                          }}
                        >
                          Done
                        </Button>
                      )}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button asChild size="sm">
                  <Link href="/integrations">
                    <Settings className="h-4 w-4 mr-2" />
                    Setup
                  </Link>
                </Button>
              </div>
            </div>
          </div>
          {/* Main Content */}
          <div className="space-y-6">
            <SearchComponent />
            {/* Text Ingest - hidden for now but want to keeep */}
            {/* <div className="w-full max-w-4xl mx-auto">
              <TextIngestCard />
            </div> */}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
} 