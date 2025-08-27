"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SessionDetailPage({ params }) {
  const { id } = params || {};
  const searchParams = useSearchParams();
  const tParam = searchParams.get("t");
  const initialSeconds = tParam ? parseInt(tParam, 10) || 0 : 0;

  const [session, setSession] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSeconds, setActiveSeconds] = useState(initialSeconds);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      const supabase = createClient();

      const [{ data: s }, { data: cs }] = await Promise.all([
        supabase
          .from("sessions")
          .select("id,title,created_at,duration_seconds,calendar_event_id")
          .eq("id", id)
          .single(),
        supabase
          .from("session_chunks")
          .select("id,content,start_time_seconds,end_time_seconds,speaker_tag,created_at")
          .eq("session_id", id)
          .order("start_time_seconds", { ascending: true })
          .limit(1000)
      ]);

      setSession(s || null);
      setChunks(Array.isArray(cs) ? cs : []);
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    setActiveSeconds(initialSeconds);
  }, [initialSeconds]);

  const activeIndex = useMemo(() => {
    if (!Array.isArray(chunks) || chunks.length === 0) return -1;
    const idx = chunks.findIndex((c) => {
      const s = c.start_time_seconds || 0;
      const e = c.end_time_seconds != null ? c.end_time_seconds : (s + 10);
      return activeSeconds >= s && activeSeconds <= e;
    });
    return idx;
  }, [chunks, activeSeconds]);

  return (
    <div className="container mx-auto px-4 py-6">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>{session?.title || "Session"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Session ID: {session?.id}</div>
                {Number.isFinite(session?.duration_seconds) && (
                  <Badge variant="outline">{Math.floor(session.duration_seconds / 60)}:{String(session.duration_seconds % 60).padStart(2, "0")}</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm">Jump to:</span>
                {[0, 30, 60, 120, 300].map((s) => (
                  <Button key={s} size="sm" variant="outline" onClick={() => setActiveSeconds(s)}>
                    {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
                  </Button>
                ))}
              </div>

              <div className="space-y-2">
                {chunks.map((c, i) => (
                  <div
                    key={c.id}
                    className={`p-3 rounded border ${i === activeIndex ? "border-primary bg-primary/5" : "border-border"}`}
                    onClick={() => setActiveSeconds(c.start_time_seconds || 0)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <div>
                        {Math.floor((c.start_time_seconds || 0) / 60)}:{String((c.start_time_seconds || 0) % 60).padStart(2, "0")}
                        {c.speaker_tag ? ` · Speaker ${c.speaker_tag}` : ""}
                      </div>
                    </div>
                    <div className="text-sm leading-relaxed">{c.content}</div>
                  </div>
                ))}
                {chunks.length === 0 && (
                  <div className="text-sm text-muted-foreground">No transcript chunks found.</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


