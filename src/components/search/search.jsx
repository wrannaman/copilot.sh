"use client";

import { useState, useRef } from "react";
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
              {["today", "this week", "meetings", "recordings"].map((filter) => (
                <Badge
                  key={filter}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => {
                    // Quick filter implementation would go here
                    setQuery(filter === "meetings" ? "meeting" : filter === "recordings" ? "recording" : `${filter}`);
                  }}
                >
                  {filter}
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
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4" />
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

      {/* Getting Started Help */}
      {!hasSearched && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Search Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2">What you can search for:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Specific topics discussed</li>
                  <li>• Action items and commitments</li>
                  <li>• People mentioned</li>
                  <li>• Questions and decisions</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium mb-2">Search examples:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• "project deadline"</li>
                  <li>• "follow up with Sarah"</li>
                  <li>• "budget discussion"</li>
                  <li>• "next steps"</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
