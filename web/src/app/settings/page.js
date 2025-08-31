"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Preferences
  const [prompt, setPrompt] = useState("");
  const [topics, setTopics] = useState("");
  const [actionItems, setActionItems] = useState("");

  const parsedTopics = useMemo(() =>
    topics
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    [topics]);

  const parsedActionItems = useMemo(() =>
    actionItems
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    [actionItems]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const res = await fetch("/api/settings/summary", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json();
        setPrompt((data?.prompt && data.prompt.trim()) ? data.prompt : (data?.default_prompt || ""));
        setTopics((data?.topics || []).join(", "));
        setActionItems((data?.action_items || []).join(", "));
      } catch (e) {
        setError(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/settings/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: (prompt || "").trim(),
          topics: parsedTopics,
          action_items: parsedActionItems,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSuccess("Saved");
    } catch (e) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onReset = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/settings/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) throw new Error("Reset failed");
      const data = await res.json();
      setPrompt((data?.prompt && data.prompt.trim()) ? data.prompt : (data?.default_prompt || ""));
      setTopics((data?.topics || []).join(", "));
      setActionItems((data?.action_items || []).join(", "));
      setSuccess("Reverted to default");
    } catch (e) {
      setError(e?.message || "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AuthenticatedNav />
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>
        <div className="max-w-3xl space-y-6">
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <form onSubmit={onSave} className="space-y-6">
              {error ? (
                <div className="text-sm text-red-500">{error}</div>
              ) : null}
              {success ? (
                <div className="text-sm text-green-600">{success}</div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium">Default summary prompt</label>
                <Textarea
                  rows={10}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe how to summarize: tone, structure, constraints…"
                />
                <p className="text-xs text-muted-foreground">
                  This overrides the base summarization instructions. You can still provide per-summary overrides when summarizing a specific session.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Topics to emphasize (comma-separated)</label>
                <Input
                  value={topics}
                  onChange={(e) => setTopics(e.target.value)}
                  placeholder="roadmap, hiring, blockers"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Action items to extract (comma-separated)</label>
                <Input
                  value={actionItems}
                  onChange={(e) => setActionItems(e.target.value)}
                  placeholder="PRs to open, follow-ups, owners, deadlines"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>Save</Button>
                <Button type="button" variant="secondary" onClick={onReset} disabled={saving}>Revert to default</Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}


