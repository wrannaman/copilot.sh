import { NextResponse } from 'next/server';
import { createServiceClient } from '@/utils/supabase/server';
import { embedTexts } from '@/server/ai/embedding';

export async function POST(req) {
  try {
    const { query, organizationId, filters = {}, limit = 20 } = await req.json();

    console.log('🔍 SEARCH REQUEST →', { query, organizationId, filters, limit });

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // First, get all sessions for this organization to use as session filter
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('id, title, duration_seconds, created_at, started_at, calendar_event_id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (sessionsError) {
      console.error('❌ Error fetching sessions:', sessionsError);
      return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        results: [],
        message: 'No sessions found for this organization'
      });
    }

    // Create embeddings for the search query
    const [queryEmbedding] = await embedTexts([query]);

    if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
      throw new Error('Failed to create embedding for query');
    }

    // Start with all sessions, then apply filters before building the id list
    let filteredSessions = sessions;

    // Apply session type filter: 'meetings' => has calendar_event_id, 'recordings' => no calendar_event_id
    if (filters.sessionType && filters.sessionType !== 'all') {
      if (filters.sessionType === 'meetings') {
        filteredSessions = filteredSessions.filter(s => !!s.calendar_event_id);
      } else if (filters.sessionType === 'recordings') {
        filteredSessions = filteredSessions.filter(s => !s.calendar_event_id);
      }
    }

    // Apply date filters if specified
    let filteredSessionIds = filteredSessions.map(s => s.id);
    if (filters.dateRange && filters.dateRange !== 'all') {
      const now = new Date();
      let cutoffDate;

      switch (filters.dateRange) {
        case 'today':
          cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoffDate = null;
      }

      if (cutoffDate) {
        filteredSessionIds = filteredSessions
          .filter(s => new Date(s.created_at) >= cutoffDate)
          .map(s => s.id);
      }
    }

    if (filteredSessionIds.length === 0) {
      return NextResponse.json({
        results: [],
        message: 'No sessions found in the specified date range'
      });
    }

    // Run BOTH semantic vector search and keyword search, then fuse with RRF
    const [{ data: vectorResults, error: vectorError }, { data: keywordResults, error: keywordError }] = await Promise.all([
      supabase.rpc('match_session_chunks', {
        query_embedding: queryEmbedding,
        session_ids: filteredSessionIds,
        match_threshold: 0.6,
        match_count: limit
      }),
      supabase
        .from('session_chunks')
        .select('id, session_id, content, start_time_seconds, end_time_seconds, speaker_tag, created_at')
        .in('session_id', filteredSessionIds)
        .textSearch('ts', query, { type: 'websearch', config: 'english' })
        .limit(limit)
        .order('created_at', { ascending: false })
    ]);

    if (vectorError) {
      console.error('❌ Error matching chunks (vector):', vectorError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
    if (keywordError) {
      console.warn('⚠️ Keyword search issue:', keywordError);
    }

    const safeVector = Array.isArray(vectorResults) ? vectorResults : [];
    const safeKeyword = Array.isArray(keywordResults) ? keywordResults : [];

    // Helper to enrich with session metadata
    function enrich(row) {
      const session = sessions.find(s => s.id === row.session_id);
      return {
        ...row,
        session_title: session?.title,
        session_created_at: session?.created_at,
        session_started_at: session?.started_at,
        session_duration_seconds: session?.duration_seconds,
        created_at: session?.created_at || row.created_at
      };
    }

    const enrichedVector = safeVector.map(enrich);
    const enrichedKeyword = safeKeyword.map(r => enrich({ ...r, similarity: 0.75 }));

    // RRF fusion
    const k = 60;
    const rrfMap = new Map(); // id -> { row, score }

    for (let i = 0; i < enrichedVector.length; i++) {
      const row = enrichedVector[i];
      const score = 1 / (k + (i + 1));
      const existing = rrfMap.get(row.id);
      if (!existing) rrfMap.set(row.id, { row, score, hasVector: true });
      else rrfMap.set(row.id, { ...existing, score: existing.score + score, row: { ...existing.row, ...row }, hasVector: true });
    }

    for (let i = 0; i < enrichedKeyword.length; i++) {
      const row = enrichedKeyword[i];
      const score = 1 / (k + (i + 1));
      const existing = rrfMap.get(row.id);
      if (!existing) rrfMap.set(row.id, { row, score, hasVector: false });
      else rrfMap.set(row.id, { ...existing, score: existing.score + score, row: { ...row, ...existing.row } });
    }

    let fused = Array.from(rrfMap.values()).map(v => ({ ...v.row, rrf_score: v.score }));
    if (fused.length === 0) {
      return NextResponse.json({
        results: [],
        message: 'No matching content found'
      });
    }

    fused.sort((a, b) => (b.rrf_score || 0) - (a.rrf_score || 0));
    const enrichedResults = fused.slice(0, limit);

    // Compute absolute timestamp (ISO) for each chunk when possible
    for (const r of enrichedResults) {
      try {
        const baseIso = r.session_started_at || r.session_created_at || r.created_at;
        const baseMs = baseIso ? new Date(baseIso).getTime() : NaN;
        const offsetMs = (r.start_time_seconds || 0) * 1000;
        if (!Number.isNaN(baseMs)) {
          const tsMs = baseMs + offsetMs;
          r.absolute_timestamp = new Date(tsMs).toISOString();
        }
      } catch (_) { }
    }

    // Attach calendar event attribution if possible by computing absolute timestamps
    try {
      const timestamps = enrichedResults
        .map((r) => {
          const baseIso = r.session_started_at || r.session_created_at || r.created_at;
          if (!baseIso) return null;
          const baseMs = new Date(baseIso).getTime();
          const offsetMs = (r.start_time_seconds || 0) * 1000;
          if (Number.isNaN(baseMs)) return null;
          return baseMs + offsetMs;
        })
        .filter((v) => typeof v === 'number' && !Number.isNaN(v));

      if (timestamps.length > 0) {
        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);

        const minIso = new Date(minTs).toISOString();
        const maxIso = new Date(maxTs).toISOString();

        // Include events where ends_at is null (open-ended) as overlapping
        const { data: events, error: eventsError } = await supabase
          .from('calendar_events')
          .select('id,title,starts_at,ends_at')
          .eq('organization_id', organizationId)
          .or(`and(starts_at.lte.${maxIso},ends_at.gte.${minIso}),and(starts_at.lte.${maxIso},ends_at.is.null)`)
          .order('starts_at', { ascending: true });

        if (!eventsError && Array.isArray(events) && events.length) {
          for (const r of enrichedResults) {
            const baseIso = r.session_started_at || r.session_created_at || r.created_at;
            const baseMs = baseIso ? new Date(baseIso).getTime() : NaN;
            if (Number.isNaN(baseMs)) continue;
            const tsMs = baseMs + (r.start_time_seconds || 0) * 1000;
            // Ensure absolute timestamp is present
            if (!r.absolute_timestamp) {
              try { r.absolute_timestamp = new Date(tsMs).toISOString(); } catch (_) { }
            }
            const overlapping = events.filter((ev) => {
              const s = ev.starts_at ? new Date(ev.starts_at).getTime() : null;
              const e = ev.ends_at ? new Date(ev.ends_at).getTime() : null;
              if (s == null) return false;
              if (e == null) return tsMs >= s; // open-ended
              return tsMs >= s && tsMs <= e;
            });
            if (overlapping.length > 0) {
              r.calendar_events = overlapping;
              r.calendar_event = overlapping[0];
            }
          }
        }
      }
    } catch (attribErr) {
      console.warn('⚠️ Calendar attribution failed:', attribErr);
    }

    // Group results by session and include basic text search as fallback
    const sessionGroups = {};
    enrichedResults.forEach(result => {
      if (!sessionGroups[result.session_id]) {
        sessionGroups[result.session_id] = [];
      }
      sessionGroups[result.session_id].push(result);
    });

    console.log('✅ SEARCH RESULTS (hybrid_rrf) →', {
      totalChunks: enrichedResults.length,
      sessionsMatched: Object.keys(sessionGroups).length
    });

    return NextResponse.json({
      results: enrichedResults,
      metadata: {
        totalResults: enrichedResults.length,
        sessionsSearched: filteredSessionIds.length,
        sessionsMatched: Object.keys(sessionGroups).length,
        query,
        filters,
        searchType: 'hybrid_rrf'
      }
    });

  } catch (error) {
    console.error('❌ Search API error:', error);
    return NextResponse.json(
      {
        error: 'Search failed',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for simple keyword-only searches
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const organizationId = searchParams.get('org');

    if (!query || !organizationId) {
      return NextResponse.json({ error: 'Query and organization ID are required' }, { status: 400 });
    }

    // Simple text search using PostgreSQL full-text search on session_chunks.ts column
    const supabase = await createServiceClient();

    const { data: chunks, error } = await supabase
      .from('session_chunks')
      .select(`
        id,
        session_id,
        content,
        start_time_seconds,
        end_time_seconds,
        speaker_tag,
        created_at,
        sessions!inner(
          id,
          title,
          duration_seconds,
          created_at,
          organization_id
        )
      `)
      .eq('sessions.organization_id', organizationId)
      .textSearch('ts', query, {
        type: 'websearch',
        config: 'english'
      })
      .limit(20)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Text search error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    // Transform the results to match the expected format
    const results = (chunks || []).map(chunk => ({
      id: chunk.id,
      session_id: chunk.session_id,
      content: chunk.content,
      start_time_seconds: chunk.start_time_seconds,
      end_time_seconds: chunk.end_time_seconds,
      speaker_tag: chunk.speaker_tag,
      created_at: chunk.created_at,
      session_title: chunk.sessions?.title,
      session_created_at: chunk.sessions?.created_at,
      duration_seconds: chunk.sessions?.duration_seconds,
      similarity: 0.8 // Default similarity for text search
    }));

    return NextResponse.json({
      results,
      metadata: {
        totalResults: results.length,
        searchType: 'text',
        query
      }
    });

  } catch (error) {
    console.error('❌ Text search error:', error);
    return NextResponse.json(
      {
        error: 'Search failed',
        details: error.message
      },
      { status: 500 }
    );
  }
}
