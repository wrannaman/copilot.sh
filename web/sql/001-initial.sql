-- ============================================================================
-- Copilot AI – Supabase Schema (org-scoped, RLS-first)
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ----------------------------------------------------------------------------
-- Types
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'editor', 'viewer');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('idle','uploaded','transcribing','summarizing','ready','error');
  END IF;


  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_type') THEN
    CREATE TYPE integration_type AS ENUM ('notion','google_calendar','gmail');
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- Organizations & Memberships (multi-tenancy foundation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  display_name TEXT,
  logo_url TEXT,
  timezone TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(organization_id);

-- Users MUST belong to an org to see/use anything.
-- (Enforced via RLS policies below; optionally add a guard view if desired.)

-- Invites
CREATE TABLE IF NOT EXISTS org_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON org_invites(token);

-- ----------------------------------------------------------------------------
-- Core: Sessions, transcripts, digests, vectors
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT,
  summary_prompt TEXT,
  summary_text TEXT,
  structured_data JSONB,
  summary_embedding VECTOR(768),
  status session_status NOT NULL DEFAULT 'idle',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  audio_path TEXT,             -- storage path (private)
  audio_mime TEXT,             -- e.g., audio/webm
  transcript_storage_path TEXT, -- path to transcript file in storage
  raw_transcript_path TEXT,    -- path to raw transcript JSON with timestamps/confidence
  whisperx_json_path TEXT,    -- path to whisperx JSON file with timestamps/confidence
  whisperx_status TEXT,
  whisperx_text_path TEXT,
  whisperx_started_at TIMESTAMPTZ,
  whisperx_error TEXT,
  error_message TEXT,
  calendar_event_id TEXT,      -- external Google event id (nullable)
  calendar_anchor TIMESTAMPTZ, -- start time anchor for the session
  calendar_event_ref UUID REFERENCES calendar_events(id) ON DELETE SET NULL, -- explicit link to our calendar_events row
  gcs_operation_name TEXT,     -- Google Cloud Speech operation name for recovery
  gcs_audio_uri TEXT,          -- GCS URI for audio file during transcription
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_creator ON sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_calendar_event_ref ON sessions(calendar_event_ref);
CREATE INDEX IF NOT EXISTS idx_sessions_structured_data ON sessions USING GIN ((structured_data));
CREATE INDEX IF NOT EXISTS idx_sessions_summary_embedding ON sessions USING ivfflat (summary_embedding vector_cosine_ops) WITH (lists = 100);

-- Chunked transcript with embeddings for search (per session)
CREATE TABLE IF NOT EXISTS session_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  start_time_seconds INTEGER,
  end_time_seconds INTEGER,
  speaker_tag TEXT,
  embedding VECTOR(768),
  ts tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_chunks_session ON session_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_session_chunks_created ON session_chunks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_chunks_ts ON session_chunks USING GIN (ts);
-- Cosine distance index for pgvector (tune lists as needed)
CREATE INDEX IF NOT EXISTS idx_session_chunks_embedding ON session_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- Tags (free-form, per-organization) and session_tags (join)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_ci TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name_ci)
);

CREATE INDEX IF NOT EXISTS idx_tags_org ON tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_tags_name_ci ON tags(organization_id, name_ci);

CREATE TABLE IF NOT EXISTS session_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tags_session ON session_tags(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag_id);

-- ----------------------------------------------------------------------------
-- Device API Keys (for headless devices like Raspberry Pi)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  label TEXT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_device_api_keys_user ON device_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_device_api_keys_org ON device_api_keys(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE device_api_keys TO service_role;

-- ----------------------------------------------------------------------------
-- Grants for server (service_role) to manage orgs and memberships
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org TO service_role;
GRANT SELECT, UPDATE ON TABLE org TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org_members TO service_role;
GRANT SELECT ON TABLE org_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_transcripts TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_chunks TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tags TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_tags TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Calendar mirror (lightweight; read-only link to GCal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,      -- Google event id
  title TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  attendees JSONB NOT NULL DEFAULT '[]',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_cal_events_org ON calendar_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_cal_events_time ON calendar_events(starts_at, ends_at);

-- Grants for calendar_events
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE calendar_events TO service_role;

-- ----------------------------------------------------------------------------
-- Integrations (Notion, Google Calendar, Gmail)
-- Store tokens encrypted or via external secrets; keep minimal here.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  type integration_type NOT NULL,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  account_email TEXT,
  access_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- store minimal tokens/ids; prefer KMS/VAULT in prod
  scopes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, type, account_email)
);

CREATE INDEX IF NOT EXISTS idx_integrations_org_type ON integrations(organization_id, type);

-- Grants for integrations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integrations TO service_role;

-- (processing jobs removed for simplification)

-- (outbound events removed for simplification)

-- (audit logs removed for simplification)

-- ----------------------------------------------------------------------------
-- Helper Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_organization_with_owner(
  org_name TEXT,
  owner_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE new_org_id UUID;
BEGIN
  INSERT INTO org (name, display_name)
  VALUES (org_name, org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO org_members (user_id, organization_id, role)
  VALUES (owner_id, new_org_id, 'owner');

  RETURN new_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_organizations(user_uuid UUID)
RETURNS TABLE(org_id UUID, org_name TEXT, user_role user_role)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, om.role
  FROM org o
  JOIN org_members om ON o.id = om.organization_id
  WHERE om.user_id = user_uuid;
END;
$$;

-- Convenience: current user orgs (RLS-safe; no params)
CREATE OR REPLACE FUNCTION my_organizations()
RETURNS TABLE(org_id UUID, org_name TEXT, user_role user_role)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT o.id, o.name, om.role
  FROM org o
  JOIN org_members om ON o.id = om.organization_id
  WHERE om.user_id = auth.uid();
$$;

-- Idempotent: ensure current user belongs to exactly one org; if none, create and make them owner
-- Returns the org_id. Intended for use in auth callback with user token.
CREATE OR REPLACE FUNCTION ensure_current_user_org(preferred_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org_id UUID;
BEGIN
  -- Prevent duplicate org creation during concurrent logins for the same user
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 42));

  -- Try to find any existing membership for this user (first wins)
  SELECT o.id INTO v_org_id
  FROM org o
  JOIN org_members om ON o.id = om.organization_id
  WHERE om.user_id = auth.uid()
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    -- Create a new org and add current user as owner
    INSERT INTO org (name, display_name)
    VALUES (COALESCE(NULLIF(TRIM(preferred_name), ''), 'Personal'), COALESCE(NULLIF(TRIM(preferred_name), ''), 'Personal'))
    RETURNING id INTO v_org_id;

    INSERT INTO org_members (user_id, organization_id, role)
    VALUES (auth.uid(), v_org_id, 'owner')
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  RETURN v_org_id;
END;
$$;

-- Service-only: list users in an org (attachable to session/cookie server-side)
CREATE OR REPLACE FUNCTION get_org_users(p_org_id UUID)
RETURNS TABLE(user_id UUID, role user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.user_id, om.role
  FROM org_members om
  WHERE om.organization_id = p_org_id;
$$;

-- ----------------------------------------------------------------------------
-- RLS Enablement
-- ----------------------------------------------------------------------------
ALTER TABLE org                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_transcripts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_chunks         ENABLE ROW LEVEL SECURITY;
-- (digests/chunks removed)
ALTER TABLE calendar_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_tags           ENABLE ROW LEVEL SECURITY;
-- (jobs/outbound/audit removed)

-- RLS for deleted tables removed

-- ----------------------------------------------------------------------------
-- RLS Policies (org-scoped)
-- Users can only interact with rows in orgs they belong to.
-- Editors/admin/owner can write; viewers read-only where appropriate.
-- ----------------------------------------------------------------------------

-- org
CREATE POLICY "view my orgs" ON org
  FOR SELECT USING (
    id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update my orgs (owner/admin)" ON org;
CREATE POLICY "managers update orgs" ON org
  FOR UPDATE TO authenticated
  USING (
    id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );
CREATE POLICY "create org (any auth)" ON org
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- org_members
-- Clean up any legacy recursive policies before creating safe ones
DROP POLICY IF EXISTS "owners manage memberships" ON org_members;
DROP POLICY IF EXISTS "manage memberships" ON org_members;
-- Avoid recursive reference to org_members inside its own policy
CREATE POLICY "view my memberships" ON org_members
  FOR SELECT USING (user_id = auth.uid());
-- Management policies can be added via functions or handled by service role; omitted here to prevent recursion

-- org_invites
CREATE POLICY "org members view invites" ON org_invites
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
-- Allow owners/admins/editors to insert/update/delete invites in their org
DROP POLICY IF EXISTS "owners manage invites" ON org_invites;
CREATE POLICY "managers manage invites" ON org_invites
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );

-- Base table privileges for client (RLS still enforced)
GRANT SELECT, INSERT, UPDATE ON TABLE org_invites TO authenticated;

-- sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members select sessions" ON sessions
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage sessions" ON sessions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "editors update/delete sessions" ON sessions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "editors delete sessions" ON sessions
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid()
    )
  );

-- session_transcripts follow session
CREATE POLICY "org members select transcripts" ON session_transcripts
  FOR SELECT USING (
    session_id IN (SELECT s.id FROM sessions s 
                   JOIN org_members om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid())
  );
CREATE POLICY "editors manage transcripts" ON session_transcripts
  FOR ALL USING (
    session_id IN (SELECT s.id FROM sessions s 
                   JOIN org_members om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid())
  );

-- session_chunks follow session
CREATE POLICY "org members select chunks" ON session_chunks
  FOR SELECT USING (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );
CREATE POLICY "editors manage chunks" ON session_chunks
  FOR ALL USING (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  ) WITH CHECK (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- transcript segments removed; using storage-based transcripts

-- (digests/chunks policies removed)

-- calendar_events
CREATE POLICY "org members select cal events" ON calendar_events
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage cal events" ON calendar_events
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );

-- integrations
CREATE POLICY "org members select integrations" ON integrations
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "owners manage integrations" ON integrations
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  )
  WITH CHECK (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );
CREATE POLICY "owners insert integrations" ON integrations
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );
CREATE POLICY "owners delete integrations" ON integrations
  FOR DELETE USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );

-- tags (org-scoped)
CREATE POLICY "org members select tags" ON tags
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage tags" ON tags
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );

-- session_tags (join limited to same-org sessions and tags)
CREATE POLICY "org members select session_tags" ON session_tags
  FOR SELECT USING (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
    AND tag_id IN (
      SELECT t.id FROM tags t
      JOIN org_members om2 ON t.organization_id = om2.organization_id
      WHERE om2.user_id = auth.uid()
    )
  );
CREATE POLICY "editors manage session_tags" ON session_tags
  FOR ALL TO authenticated
  USING (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor')
    )
    AND tag_id IN (
      SELECT t.id FROM tags t
      JOIN org_members om2 ON t.organization_id = om2.organization_id
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT s.id FROM sessions s 
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor')
    )
    AND tag_id IN (
      SELECT t.id FROM tags t
      JOIN org_members om2 ON t.organization_id = om2.organization_id
      WHERE om2.user_id = auth.uid() AND om2.role IN ('owner','admin','editor')
    )
  );

-- device_api_keys
ALTER TABLE device_api_keys ENABLE ROW LEVEL SECURITY;

-- Allow owners/admins/editors to view keys; viewers have no access
CREATE POLICY "org members select device keys" ON device_api_keys
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );

-- Only owners/admins can create/update/delete keys
CREATE POLICY "owners manage device keys" ON device_api_keys
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );


-- ----------------------------------------------------------------------------
-- Storage: private bucket `copilot.sh` with org/session-scoped paths
-- Paths:
--   copilot/audio/<org_id>/<session_id>.webm
--   copilot/exports/<org_id>/...       (future)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('copilot.sh', 'copilot.sh', false)
ON CONFLICT (id) DO NOTHING;

-- Helpers for path checks
-- NOTE: storage.foldername(name) is available in Supabase; we’ll use split_part here for clarity.

-- Uploads (INSERT): audio
CREATE POLICY "org members can upload session audio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM sessions s
      JOIN org_members om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND s.id::text = split_part(name, '/', 3) -- <session_id>.webm is 3rd segment (audio/<org>/<session>)
        AND s.organization_id::text = split_part(name, '/', 2)
    )
  );

-- Reads (SELECT): audio
CREATE POLICY "org members can read session audio" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- Deletes/Updates (owners/admin/editor allowed): audio
CREATE POLICY "editors can manage session audio" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND om.role IN ('owner','admin','editor')
        AND o.id::text = split_part(name, '/', 2)
    )
  )
  WITH CHECK (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND om.role IN ('owner','admin','editor')
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- Uploads (INSERT): transcripts
CREATE POLICY "org members can upload transcripts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'transcripts'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- Reads (SELECT): transcripts
CREATE POLICY "org members can read transcripts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'transcripts'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- Deletes/Updates (owners/admin/editor allowed): transcripts
CREATE POLICY "org members can manage transcripts" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'transcripts'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  )
  WITH CHECK (
    bucket_id = 'copilot.sh'
    AND split_part(name, '/', 1) = 'transcripts'
    AND EXISTS (
      SELECT 1
      FROM org o
      JOIN org_members om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- ----------------------------------------------------------------------------
-- Convenience Views (optional)
-- ----------------------------------------------------------------------------
-- Note: helper view v_my_orgs removed; query org via org_members with RLS instead.

-- Note: helper view v_my_sessions removed; query sessions joined to org_members with RLS instead.

-- Harden defaults so future views/tables don't inherit broad privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated, service_role;

-- Explicit function grants
GRANT EXECUTE ON FUNCTION my_organizations() TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_current_user_org(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_users(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- Semantic search RPC: match_session_chunks
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_session_chunks(
  match_count INT,
  match_threshold FLOAT,
  query_embedding VECTOR(768),
  session_ids UUID[]
) RETURNS TABLE (
  id UUID,
  session_id UUID,
  content TEXT,
  start_time_seconds INT,
  end_time_seconds INT,
  speaker_tag TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sc.id,
    sc.session_id,
    sc.content,
    sc.start_time_seconds,
    sc.end_time_seconds,
    sc.speaker_tag,
    sc.created_at,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM session_chunks sc
  WHERE sc.session_id = ANY(session_ids)
    AND sc.embedding IS NOT NULL
    AND (1 - (sc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY sc.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_session_chunks(INT, FLOAT, VECTOR, UUID[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Session-level search RPC: search_sessions
-- Caller should supply a query embedding; optional owner filter looks inside structured_data
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_sessions(
  p_org_id UUID,
  p_query_embedding VECTOR(768),
  p_owner_filter TEXT DEFAULT NULL,
  p_match_count INT DEFAULT 10
) RETURNS TABLE (
  id UUID,
  title TEXT,
  summary_text TEXT,
  started_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql
STABLE
AS $$
  WITH semantic AS (
    SELECT
      s.id,
      s.title,
      s.summary_text,
      s.started_at,
      (1 - (s.summary_embedding <=> p_query_embedding)) AS similarity
    FROM sessions s
    WHERE s.organization_id = p_org_id
      AND s.status = 'ready'
      AND s.summary_embedding IS NOT NULL
  ),
  owner_hits AS (
    SELECT s.id
    FROM sessions s
    WHERE s.organization_id = p_org_id
      AND s.status = 'ready'
      AND p_owner_filter IS NOT NULL
      AND s.structured_data @> jsonb_build_object('action_items', jsonb_build_array(jsonb_build_object('owner', p_owner_filter)))
  )
  SELECT sem.id, sem.title, sem.summary_text, sem.started_at,
         CASE WHEN oh.id IS NOT NULL THEN GREATEST(sem.similarity, 1.0) ELSE sem.similarity END AS similarity
  FROM semantic sem
  LEFT JOIN owner_hits oh ON sem.id = oh.id
  ORDER BY similarity DESC NULLS LAST
  LIMIT p_match_count;
$$;

GRANT EXECUTE ON FUNCTION search_sessions(UUID, VECTOR, TEXT, INT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Hybrid search RPC: hybrid_search (sessions + chunks)
-- Caller provides semantic embedding and optional websearch tsquery string
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hybrid_search(
  p_org_id UUID,
  p_query_embedding VECTOR(768),
  p_tsquery TEXT DEFAULT NULL,
  p_match_count INT DEFAULT 20
) RETURNS TABLE (
  result_type TEXT,
  session_id UUID,
  session_title TEXT,
  chunk_id UUID,
  content TEXT,
  start_time_seconds INT,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tsquery TSQUERY;
BEGIN
  IF p_tsquery IS NOT NULL AND length(trim(p_tsquery)) > 0 THEN
    v_tsquery := websearch_to_tsquery('english', p_tsquery);
  ELSE
    v_tsquery := NULL;
  END IF;

  RETURN QUERY
  WITH results AS (
    -- Session-level semantic over summaries
    SELECT
      'session'::TEXT AS result_type,
      s.id AS session_id,
      s.title AS session_title,
      NULL::uuid AS chunk_id,
      s.summary_text AS content,
      NULL::int AS start_time_seconds,
      (1 - (s.summary_embedding <=> p_query_embedding)) AS similarity
    FROM sessions s
    WHERE s.organization_id = p_org_id AND s.status = 'ready' AND s.summary_embedding IS NOT NULL

    UNION ALL

    -- Chunk-level semantic
    SELECT
      'chunk'::TEXT AS result_type,
      sc.session_id,
      s.title AS session_title,
      sc.id AS chunk_id,
      sc.content,
      sc.start_time_seconds,
      (1 - (sc.embedding <=> p_query_embedding)) AS similarity
    FROM session_chunks sc
    JOIN sessions s ON sc.session_id = s.id
    WHERE s.organization_id = p_org_id AND s.status = 'ready' AND sc.embedding IS NOT NULL

    UNION ALL

    -- Chunk-level FTS
    SELECT
      'chunk'::TEXT AS result_type,
      sc.session_id,
      s.title AS session_title,
      sc.id AS chunk_id,
      sc.content,
      sc.start_time_seconds,
      ts_rank(sc.ts, v_tsquery) AS similarity
    FROM session_chunks sc
    JOIN sessions s ON sc.session_id = s.id
    WHERE v_tsquery IS NOT NULL AND s.organization_id = p_org_id AND s.status = 'ready' AND sc.ts @@ v_tsquery
  )
  SELECT *
  FROM results
  WHERE similarity IS NOT NULL AND similarity > 0.5
  ORDER BY similarity DESC
  LIMIT p_match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION hybrid_search(UUID, VECTOR, TEXT, INT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Done
-- ----------------------------------------------------------------------------

