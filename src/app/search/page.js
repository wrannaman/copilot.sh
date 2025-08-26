"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";
import { useToast } from "@/components/toast-provider";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
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
  X,
  ArrowLeft,
  SortAsc,
  SortDesc,
  ChevronDown,
  Sparkles,
  History
} from "lucide-react";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, currentOrganization } = useAuth();
  const { toast } = useToast();

  const [query, setQuery] = useState(searchParams?.get('q') || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [metadata, setMetadata] = useState(null);
  const [filters, setFilters] = useState({
    dateRange: searchParams?.get('date') || "all",
    sortBy: "relevance", // relevance, date, duration
    sessionType: "all"
  });
  const [expandedResults, setExpandedResults] = useState(new Set());

  const searchInputRef = useRef(null);

  // Auto-search when component mounts with query parameter
  useEffect(() => {
    if (query && currentOrganization) {
      handleSearch();
    }
  }, [currentOrganization?.org_id]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim() || !currentOrganization) return;

    setLoading(true);
    setHasSearched(true);

    // Update URL
    const params = new URLSearchParams();
    params.set('q', query.trim());
    if (filters.dateRange !== 'all') params.set('date', filters.dateRange);
    router.replace(`/search?${params.toString()}`);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query.trim(),
          organizationId: currentOrganization.org_id,
          filters,
          limit: 50, // More results on dedicated page
        }),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const data = await response.json();
      setResults(data.results || []);
      setMetadata(data.metadata);
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
    setMetadata(null);
    router.replace('/search');
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
    } else if (diffInDays < 30) {
      return `${diffInDays}d ago`;
    } else {
      return date.toLocaleDateString();
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
    
    const regex = new RegExp(`(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 rounded px-1 font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const toggleExpanded = (resultId) => {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(resultId)) {
      newExpanded.delete(resultId);
    } else {
      newExpanded.add(resultId);
    }
    setExpandedResults(newExpanded);
  };

  const groupedResults = results.reduce((groups, result) => {
    const sessionId = result.session_id;
    if (!groups[sessionId]) {
      groups[sessionId] = {
        session: {
          id: sessionId,
          title: result.session_title,
          created_at: result.session_created_at,
          duration_seconds: result.session_duration_seconds
        },
        chunks: []
      };
    }
    groups[sessionId].chunks.push(result);
    return groups;
  }, {});

  const sortedSessions = Object.values(groupedResults).sort((a, b) => {
    if (filters.sortBy === 'date') {
      return new Date(b.session.created_at) - new Date(a.session.created_at);
    } else if (filters.sortBy === 'duration') {
      return (b.session.duration_seconds || 0) - (a.session.duration_seconds || 0);
    } else {
      // Sort by relevance (first chunk's similarity)
      const aMaxSim = Math.max(...a.chunks.map(c => c.similarity || 0));
      const bMaxSim = Math.max(...b.chunks.map(c => c.similarity || 0));
      return bMaxSim - aMaxSim;
    }
  });

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <SearchIcon className="h-5 w-5 text-primary" />
              <h1 className="text-2xl font-bold">Search Results</h1>
            </div>
          </div>

          {/* Search Bar */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <form onSubmit={handleSearch} className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search conversations, topics, commitments..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="pr-10 text-lg h-12"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={clearSearch}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <Button type="submit" disabled={!query.trim() || loading} size="lg">
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <SearchIcon className="h-5 w-5" />
                    )}
                  </Button>
                </div>

                {/* Advanced Filters */}
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Filters:</span>
                  </div>
                  
                  <select
                    value={filters.dateRange}
                    onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value }))}
                    className="text-sm border border-input rounded px-2 py-1"
                  >
                    <option value="all">All time</option>
                    <option value="today">Today</option>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                  </select>

                  <select
                    value={filters.sortBy}
                    onChange={(e) => setFilters(prev => ({ ...prev, sortBy: e.target.value }))}
                    className="text-sm border border-input rounded px-2 py-1"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="date">Date</option>
                    <option value="duration">Duration</option>
                  </select>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Loading State */}
          {loading && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
              <h3 className="font-medium mb-2">Searching your conversations...</h3>
              <p className="text-muted-foreground">Using AI to find the most relevant results</p>
            </div>
          )}

          {/* Search Metadata */}
          {metadata && !loading && (
            <div className="mb-6">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <span>Found {metadata.totalResults} results in {metadata.sessionsMatched} sessions</span>
                  <span>•</span>
                  <span>Searched {metadata.sessionsSearched} total sessions</span>
                </div>
                {results.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <span>AI-powered semantic search</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* No Results */}
          {!loading && hasSearched && results.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <SearchIcon className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No results found</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  We couldn't find any conversations matching "{query}". Try different keywords or check your spelling.
                </p>
                <div className="space-y-2">
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Try a different search
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results by Session */}
          {!loading && sortedSessions.length > 0 && (
            <div className="space-y-6">
              {sortedSessions.map(({ session, chunks }) => (
                <Card key={session.id} className="overflow-hidden">
                  <CardHeader className="bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-3">
                          <Calendar className="h-5 w-5" />
                          <span>{session.title || "Untitled Session"}</span>
                          <Badge variant="outline">
                            {chunks.length} match{chunks.length !== 1 ? 'es' : ''}
                          </Badge>
                        </CardTitle>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            <span>{formatTimeAgo(session.created_at)}</span>
                          </div>
                          {session.duration_seconds && (
                            <div className="flex items-center gap-1">
                              <Play className="h-4 w-4" />
                              <span>{formatDuration(session.duration_seconds)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => toggleExpanded(session.id)}
                        >
                          <ChevronDown 
                            className={`h-4 w-4 transition-transform ${
                              expandedResults.has(session.id) ? 'rotate-180' : ''
                            }`} 
                          />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-0">
                    {chunks
                      .slice(0, expandedResults.has(session.id) ? undefined : 3)
                      .map((chunk, index) => (
                      <div 
                        key={`${chunk.id}-${index}`} 
                        className="p-6 border-b last:border-b-0 hover:bg-muted/10 transition-colors"
                      >
                        <div className="space-y-3">
                          {/* Chunk metadata */}
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <div className="flex items-center gap-4">
                              {chunk.speaker_tag && (
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  <span>Speaker {chunk.speaker_tag}</span>
                                </div>
                              )}
                              {chunk.start_time_seconds && (
                                <div className="flex items-center gap-1">
                                  <Play className="h-3 w-3" />
                                  <span>{formatDuration(chunk.start_time_seconds)}</span>
                                </div>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {Math.round((chunk.similarity || 0) * 100)}% match
                            </Badge>
                          </div>

                          {/* Content */}
                          <div className="prose prose-sm max-w-none">
                            <p className="text-sm leading-relaxed">
                              {highlightQuery(chunk.content, query)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Show more button */}
                    {chunks.length > 3 && !expandedResults.has(session.id) && (
                      <div className="p-4 text-center border-t">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => toggleExpanded(session.id)}
                        >
                          Show {chunks.length - 3} more result{chunks.length - 3 !== 1 ? 's' : ''}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {/* Load more results */}
              {results.length >= 50 && (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-4">
                    Showing first 50 results. Refine your search for more specific results.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Search Tips */}
          {!hasSearched && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Advanced Search Tips
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-6">
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-blue-500" />
                      Semantic Search
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Search by meaning, not just keywords</li>
                      <li>• "project deadline" finds time-related discussions</li>
                      <li>• "team concerns" captures worry and issues</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <User className="h-4 w-4 text-green-500" />
                      People & Actions
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Find mentions of specific people</li>
                      <li>• "Sarah will follow up" for commitments</li>
                      <li>• "next steps" for action items</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-500" />
                      Time & Context
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Use date filters for recent discussions</li>
                      <li>• Sort by relevance or date</li>
                      <li>• View exact timestamps in results</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function SearchResultsContent() {
  return (
    <AuthGuard>
      <Suspense fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }>
        <SearchResults />
      </Suspense>
    </AuthGuard>
  );
}

export default SearchResultsContent;
