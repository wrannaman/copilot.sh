-- ============================================================================
-- Action AI – Supabase Schema (org-scoped, RLS-first)
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

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE job_status AS ENUM ('queued','running','succeeded','failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_type') THEN
    CREATE TYPE integration_type AS ENUM ('notion','google_calendar','gmail');
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- Organizations & Memberships (multi-tenancy foundation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON organization_memberships(organization_id);

-- Users MUST belong to an org to see/use anything.
-- (Enforced via RLS policies below; optionally add a guard view if desired.)

-- Invites
CREATE TABLE IF NOT EXISTS organization_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON organization_invites(email);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON organization_invites(token);

-- ----------------------------------------------------------------------------
-- Core: Sessions, transcripts, digests, vectors
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT,
  status session_status NOT NULL DEFAULT 'idle',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  audio_path TEXT,             -- storage path (private)
  audio_mime TEXT,             -- e.g., audio/webm
  error_message TEXT,
  calendar_event_id TEXT,      -- external Google event id (nullable)
  calendar_anchor TIMESTAMPTZ, -- start time anchor for the session
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_creator ON sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Raw transcript (single text blob per session; keep it simple for v0)
CREATE TABLE IF NOT EXISTS session_transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text TEXT,                   -- full transcript
  words_json JSONB,            -- optional per-word timing if you add it later
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_transcript ON session_transcripts(session_id);

-- Digest (summary, actions, commitments) – structured output to power Notion/email
CREATE TABLE IF NOT EXISTS session_digests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT,
  actions JSONB NOT NULL DEFAULT '[]',      -- [{owner, task, due, source_ts}]
  commitments JSONB NOT NULL DEFAULT '[]',  -- [{to, promise, due, source_ts}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_session_digest ON session_digests(session_id);

-- Vectors for RAG (chunked embeddings)
CREATE TABLE IF NOT EXISTS session_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(768),     -- adjust dim to your embedding model
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"ts_range":"00:10-00:40"}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_session ON session_chunks(session_id);
-- IVFFLAT index (build after you have some data)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON session_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- Calendar mirror (lightweight; read-only link to GCal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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

-- ----------------------------------------------------------------------------
-- Integrations (Notion, Google Calendar, Gmail)
-- Store tokens encrypted or via external secrets; keep minimal here.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type integration_type NOT NULL,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- store minimal tokens/ids; prefer KMS/VAULT in prod
  scopes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, type)
);

CREATE INDEX IF NOT EXISTS idx_integrations_org_type ON integrations(organization_id, type);

-- ----------------------------------------------------------------------------
-- Processing Jobs (transcribe/summarize) – simple queue tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('transcribe','summarize','embed')),
  status job_status NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_org ON processing_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_jobs_session ON processing_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status);

-- ----------------------------------------------------------------------------
-- Outbound Logs (Notion writes, emails)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('notion','email')),
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed')) DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_org ON outbound_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbound_session ON outbound_events(session_id);
CREATE INDEX IF NOT EXISTS idx_outbound_channel ON outbound_events(channel);

-- ----------------------------------------------------------------------------
-- AUDIT TRAIL (optional but recommended)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- ----------------------------------------------------------------------------
-- Helper Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_organization_with_owner(
  org_name TEXT,
  org_slug TEXT,
  owner_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE new_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug, display_name)
  VALUES (org_name, org_slug, org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO organization_memberships (user_id, organization_id, role)
  VALUES (owner_id, new_org_id, 'owner');

  RETURN new_org_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_organizations(user_uuid UUID)
RETURNS TABLE(org_id UUID, org_name TEXT, org_slug TEXT, user_role user_role)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.slug, om.role
  FROM organizations o
  JOIN organization_memberships om ON o.id = om.organization_id
  WHERE om.user_id = user_uuid;
END;
$$;

-- ----------------------------------------------------------------------------
-- RLS Enablement
-- ----------------------------------------------------------------------------
ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_transcripts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_digests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_chunks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- RLS Policies (org-scoped)
-- Users can only interact with rows in orgs they belong to.
-- Editors/admin/owner can write; viewers read-only where appropriate.
-- ----------------------------------------------------------------------------

-- organizations
CREATE POLICY "view my orgs" ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "update my orgs (owner/admin)" ON organizations
  FOR UPDATE USING (
    id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
CREATE POLICY "create org (any auth)" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- organization_memberships
CREATE POLICY "view my memberships" ON organization_memberships
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "owners manage memberships" ON organization_memberships
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- organization_invites
CREATE POLICY "org members view invites" ON organization_invites
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "owners manage invites" ON organization_invites
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid() AND role = 'owner')
  );

-- sessions
CREATE POLICY "org members select sessions" ON sessions
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage sessions" ON sessions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );
CREATE POLICY "editors update/delete sessions" ON sessions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );
CREATE POLICY "editors delete sessions" ON sessions
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
    )
  );

-- session_transcripts / session_digests / session_chunks follow session
CREATE POLICY "org members select transcripts" ON session_transcripts
  FOR SELECT USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid())
  );
CREATE POLICY "editors manage transcripts" ON session_transcripts
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor'))
  );

CREATE POLICY "org members select digests" ON session_digests
  FOR SELECT USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid())
  );
CREATE POLICY "editors manage digests" ON session_digests
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor'))
  );

CREATE POLICY "org members select chunks" ON session_chunks
  FOR SELECT USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid())
  );
CREATE POLICY "editors manage chunks" ON session_chunks
  FOR ALL USING (
    session_id IN (SELECT id FROM sessions s 
                   JOIN organization_memberships om ON s.organization_id = om.organization_id
                   WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor'))
  );

-- calendar_events
CREATE POLICY "org members select cal events" ON calendar_events
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage cal events" ON calendar_events
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );

-- integrations
CREATE POLICY "org members select integrations" ON integrations
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "owners manage integrations" ON integrations
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
  );

-- processing_jobs
CREATE POLICY "org members select jobs" ON processing_jobs
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage jobs" ON processing_jobs
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );

-- outbound_events
CREATE POLICY "org members select outbound" ON outbound_events
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "editors manage outbound" ON outbound_events
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid() AND role IN ('owner','admin','editor'))
  );

-- audit_logs
CREATE POLICY "org members view audit" ON audit_logs
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_memberships WHERE user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Storage: private bucket `copilot` with org/session-scoped paths
-- Paths:
--   copilot/audio/<org_id>/<session_id>.webm
--   copilot/exports/<org_id>/...       (future)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('copilot', 'copilot', false)
ON CONFLICT (id) DO NOTHING;

-- Helpers for path checks
-- NOTE: storage.foldername(name) is available in Supabase; we’ll use split_part here for clarity.

-- Uploads (INSERT)
CREATE POLICY "org members can upload session audio" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'copilot'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM sessions s
      JOIN organization_memberships om ON s.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND s.id::text = split_part(name, '/', 3) -- <session_id>.webm is 3rd segment (audio/<org>/<session>)
        AND s.organization_id::text = split_part(name, '/', 2)
    )
  );

-- Reads (SELECT)
CREATE POLICY "org members can read session audio" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'copilot'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_memberships om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- Deletes/Updates (owners/admin/editor allowed)
CREATE POLICY "editors can manage session audio" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'copilot'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_memberships om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND om.role IN ('owner','admin','editor')
        AND o.id::text = split_part(name, '/', 2)
    )
  )
  WITH CHECK (
    bucket_id = 'copilot'
    AND split_part(name, '/', 1) = 'audio'
    AND EXISTS (
      SELECT 1
      FROM organizations o
      JOIN organization_memberships om ON o.id = om.organization_id
      WHERE om.user_id = auth.uid()
        AND om.role IN ('owner','admin','editor')
        AND o.id::text = split_part(name, '/', 2)
    )
  );

-- ----------------------------------------------------------------------------
-- Convenience Views (optional)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_my_orgs AS
SELECT o.*
FROM organizations o
JOIN organization_memberships om ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

CREATE OR REPLACE VIEW v_my_sessions AS
SELECT s.*
FROM sessions s
JOIN organization_memberships om ON s.organization_id = om.organization_id
WHERE om.user_id = auth.uid();

-- ----------------------------------------------------------------------------
-- Minimal Search Function (semantic + optional time range filter)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_session_chunks(
  org_id UUID,
  query_embedding VECTOR(768),
  time_from TIMESTAMPTZ DEFAULT NULL,
  time_to   TIMESTAMPTZ DEFAULT NULL,
  top_k INT DEFAULT 10
) RETURNS TABLE(
  session_id UUID,
  chunk_id UUID,
  content TEXT,
  similarity FLOAT4,
  started_at TIMESTAMPTZ,
  calendar_anchor TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.session_id,
    sc.id,
    sc.content,
    1 - (sc.embedding <=> query_embedding) AS similarity,
    s.started_at,
    s.calendar_anchor
  FROM session_chunks sc
  JOIN sessions s ON sc.session_id = s.id
  WHERE s.organization_id = org_id
    AND (time_from IS NULL OR s.started_at >= time_from)
    AND (time_to   IS NULL OR s.started_at <= time_to)
  ORDER BY sc.embedding <-> query_embedding
  LIMIT top_k;
END;
$$;

-- ----------------------------------------------------------------------------
-- Done
-- ----------------------------------------------------------------------------
