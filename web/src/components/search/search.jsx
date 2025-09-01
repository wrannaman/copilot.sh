"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/components/toast-provider";
import { createClient } from "@/utils/supabase/client";
import {
  Search as SearchIcon,
  Clock,
  Calendar,
  MessageSquare,
  Loader2,
  Filter,
  ExternalLink,
  Play,
  User,
  X
} from "lucide-react";
import QuickActions from "@/components/dashboard/QuickActions";

export function SearchComponent() {
  const { user, currentOrganization } = useAuth();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState({
    dateRange: "all", // all, today, week, month
    sessionType: "all" // all, meetings, recordings
  });
  const [meetingEvents, setMeetingEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const searchInputRef = useRef(null);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim() || !currentOrganization) return;

    setLoading(true);
    setHasSearched(true);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query.trim(),
          organizationId: currentOrganization.org_id,
          filters: selectedFilters,
          limit: 20,
        }),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error("Search error:", error);
      toast.error("Search failed", {
        description: "Unable to search your sessions. Please try again.",
      });
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    searchInputRef.current?.focus();
  };

  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now - date;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else {
      return `${diffInDays}d ago`;
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return "";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const highlightQuery = (text, query) => {
    if (!query.trim()) return text;

    const regex = new RegExp(`(${query.trim()})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 rounded px-1">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Compute absolute wall-clock time for a result (ms since epoch)
  const getResultTimestampMs = (result) => {
    try {
      const sessionStartIso = result.session_created_at || result.created_at;
      if (!sessionStartIso) return null;
      const baseMs = new Date(sessionStartIso).getTime();
      const offsetMs = (result.start_time_seconds || 0) * 1000;
      if (Number.isNaN(baseMs)) return null;
      return baseMs + offsetMs;
    } catch (_) {
      return null;
    }
  };

  // Fetch calendar events overlapping the time span of current results
  useEffect(() => {
    const fetchOverlappingEvents = async () => {
      if (!currentOrganization?.org_id || !results || results.length === 0) {
        setMeetingEvents([]);
        return;
      }

      // Determine min/max timestamps covered by the results
      const timestamps = results
        .map(getResultTimestampMs)
        .filter((v) => typeof v === "number" && !Number.isNaN(v));

      if (timestamps.length === 0) {
        setMeetingEvents([]);
        return;
      }

      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);

      try {
        setEventsLoading(true);
        const supabase = createClient();
        const { data, error } = await supabase
          .from("calendar_events")
          .select("id,title,starts_at,ends_at")
          .eq("organization_id", currentOrganization.org_id)
          .lte("starts_at", new Date(maxTs).toISOString())
          .gte("ends_at", new Date(minTs).toISOString())
          .order("starts_at", { ascending: true });

        if (error) {
          console.error("Calendar events fetch error:", error);
          setMeetingEvents([]);
          return;
        }

        setMeetingEvents(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Calendar events fetch exception:", err);
        setMeetingEvents([]);
      } finally {
        setEventsLoading(false);
      }
    };

    fetchOverlappingEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, currentOrganization?.org_id]);

  const findEventForTimestamp = (tsMs) => {
    if (!Array.isArray(meetingEvents) || meetingEvents.length === 0) return null;
    for (const ev of meetingEvents) {
      const startMs = ev.starts_at ? new Date(ev.starts_at).getTime() : null;
      const endMs = ev.ends_at ? new Date(ev.ends_at).getTime() : null;
      if (startMs == null) continue;
      // If no end provided, treat as point-in-time or all-day start; a ts after start qualifies
      if (endMs == null) {
        if (tsMs >= startMs) return ev;
      } else if (tsMs >= startMs && tsMs <= endMs) {
        return ev;
      }
    }
    return null;
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Search Input */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchIcon className="h-5 w-5" />
            Search your conversations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search conversations, topics, commitments..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pr-10"
                />
                {query && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button type="submit" disabled={!query.trim() || loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SearchIcon className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Quick filters:</span>
              </div>
              {[[
                { key: "today", apply: (q) => ({ dateRange: "today" }) },
                { key: "this week", apply: (q) => ({ dateRange: "week" }) },
                { key: "meetings", apply: (q) => ({ sessionType: "meetings" }) },
                { key: "recordings", apply: (q) => ({ sessionType: "recordings" }) }
              ]].flat().map((filter) => (
                <Badge
                  key={filter.key}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => {
                    if (!currentOrganization?.org_id) return;
                    const nextFilters = {
                      ...selectedFilters,
                      ...filter.apply(query)
                    };
                    setSelectedFilters(nextFilters);
                    if (query.trim()) {
                      // Fire search immediately with the new filters
                      (async () => {
                        try {
                          setLoading(true);
                          setHasSearched(true);
                          const response = await fetch("/api/search", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              query: query.trim(),
                              organizationId: currentOrganization.org_id,
                              filters: nextFilters,
                              limit: 20
                            })
                          });
                          if (!response.ok) throw new Error("Search failed");
                          const data = await response.json();
                          setResults(data.results || []);
                        } catch (err) {
                          console.error("Quick filter search error:", err);
                          toast.error("Search failed", { description: "Unable to search your sessions." });
                          setResults([]);
                        } finally {
                          setLoading(false);
                        }
                      })();
                    } else {
                      // If no query yet, just set the filter; user can type then submit
                      searchInputRef.current?.focus();
                    }
                  }}
                >
                  {filter.key}
                </Badge>
              ))}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Search Results */}
      {loading && (
        <div className="text-center py-8">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Searching your conversations...</p>
        </div>
      )}

      {!loading && hasSearched && results.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <SearchIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium mb-2">No results found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Try a different search term or check your spelling
            </p>
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions when no results after searching */}
      {!loading && hasSearched && results.length === 0 && (
        <div className="mt-4">
          <QuickActions />
        </div>
      )}

      {/* Quick Actions initially before any search */}
      {!loading && !hasSearched && results.length === 0 && (
        <QuickActions />
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">
              Found {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
            </h3>
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              Clear results
            </Button>
          </div>

          {results.map((result, index) => (
            <Card key={`${result.session_id}-${index}`} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="space-y-3">
                  {/* Session Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {result.session_title || "Untitled Session"}
                        </span>
                      </div>
                      {result.duration_seconds && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(result.duration_seconds)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(result.created_at)}
                      </span>
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          href={`/sessions/${result.session_id}${result.start_time_seconds ? `?t=${Math.floor(result.start_time_seconds)}` : ""}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open session details"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Content Preview */}
                  <div className="space-y-2">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-start gap-3">
                        {result.speaker_tag && (
                          <div className="flex items-center gap-1 mt-1">
                            <User className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              Speaker {result.speaker_tag}
                            </span>
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm leading-relaxed">
                            {highlightQuery(result.content, query)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Timestamp and Actions */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-4">
                        {result.start_time_seconds && (
                          <div className="flex items-center gap-1">
                            <Play className="h-3 w-3" />
                            <span>
                              {formatDuration(result.start_time_seconds)}
                            </span>
                          </div>
                        )}
                        <Badge variant="outline" className="text-xs">
                          Similarity: {Math.round((result.similarity || 0) * 100)}%
                        </Badge>
                        {(() => {
                          // Prefer API-provided calendar_event; fallback to client-side lookup
                          const apiEvent = result.calendar_event;
                          if (apiEvent) {
                            return (
                              <Badge variant="outline" className="text-xs flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                <span>During: {apiEvent.title || 'Meeting'}</span>
                              </Badge>
                            );
                          }
                          const tsMs = getResultTimestampMs(result);
                          const ev = tsMs ? findEventForTimestamp(tsMs) : null;
                          if (!ev) return null;
                          return (
                            <Badge variant="outline" className="text-xs flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>During: {ev.title || 'Meeting'}</span>
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {results.length >= 20 && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Showing first 20 results. Refine your search for more specific results.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
