import { NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@/utils/supabase/server';
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
      .select('id, title, duration_seconds, created_at')
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

    const sessionIds = sessions.map(s => s.id);
    
    // Apply date filters if specified
    let filteredSessionIds = sessionIds;
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
        filteredSessionIds = sessions
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

    // Use the existing match_session_chunks RPC function
    const { data: chunks, error: chunksError } = await supabase.rpc('match_session_chunks', {
      query_embedding: queryEmbedding,
      session_ids: filteredSessionIds,
      match_threshold: 0.6, // Lower threshold for more results
      match_count: limit
    });

    if (chunksError) {
      console.error('❌ Error matching chunks:', chunksError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        results: [],
        message: 'No matching content found'
      });
    }

    // Enrich results with session metadata
    const enrichedResults = chunks.map(chunk => {
      const session = sessions.find(s => s.id === chunk.session_id);
      return {
        ...chunk,
        session_title: session?.title,
        session_created_at: session?.created_at,
        session_duration_seconds: session?.duration_seconds,
        created_at: session?.created_at || chunk.created_at
      };
    });

    // Group results by session and include basic text search as fallback
    const sessionGroups = {};
    enrichedResults.forEach(result => {
      if (!sessionGroups[result.session_id]) {
        sessionGroups[result.session_id] = [];
      }
      sessionGroups[result.session_id].push(result);
    });

    console.log('✅ SEARCH RESULTS →', {
      totalChunks: chunks.length,
      sessionsMatched: Object.keys(sessionGroups).length
    });

    return NextResponse.json({
      results: enrichedResults,
      metadata: {
        totalResults: enrichedResults.length,
        sessionsSearched: filteredSessionIds.length,
        sessionsMatched: Object.keys(sessionGroups).length,
        query,
        filters
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
