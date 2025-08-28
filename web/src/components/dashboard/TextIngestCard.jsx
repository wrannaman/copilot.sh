"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";

export default function TextIngestCard() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("mode", "browser");
      form.append("text", text.trim());
      // Accept either full ISO or local datetime-local value
      // If user provided a datetime-local (YYYY-MM-DDTHH:mm), convert to ISO
      let ts = timestamp;
      try {
        const maybeDate = new Date(timestamp);
        if (!Number.isNaN(maybeDate.getTime())) {
          ts = maybeDate.toISOString();
        }
      } catch (_) { }
      form.append("timestamp", ts);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || "Failed to submit text");
      }

      toast.success("Added to your day", { description: "Text ingested and indexed." });
      setText("");
    } catch (err) {
      toast.error("Ingest failed", { description: err?.message || String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Text Ingest</CardTitle>
        <CardDescription>Paste notes, Slack, or a doc snippet and set when it happened.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="ingest-text">Text</Label>
              <Textarea
                id="ingest-text"
                placeholder="Dump anything here…"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ingest-ts">Timestamp</Label>
              <Input
                id="ingest-ts"
                type="datetime-local"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                disabled={submitting}
              />
              <Button type="submit" className="w-full" disabled={submitting || !text.trim()}>
                {submitting ? "Adding…" : "Add to My Day"}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}


