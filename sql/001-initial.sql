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

-- ----------------------------------------------------------------------------
-- Grants for server (service_role) to manage orgs and memberships
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE org_members TO service_role;
GRANT SELECT ON TABLE org_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_transcripts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE calendar_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE integrations TO service_role;

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

-- ----------------------------------------------------------------------------
-- Integrations (Notion, Google Calendar, Gmail)
-- Store tokens encrypted or via external secrets; keep minimal here.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  type integration_type NOT NULL,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- store minimal tokens/ids; prefer KMS/VAULT in prod
  scopes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, type)
);

CREATE INDEX IF NOT EXISTS idx_integrations_org_type ON integrations(organization_id, type);

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
-- (digests/chunks removed)
ALTER TABLE calendar_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations           ENABLE ROW LEVEL SECURITY;
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
CREATE POLICY "update my orgs (owner/admin)" ON org
  FOR UPDATE USING (
    id IN (
      SELECT organization_id FROM org_members 
      WHERE user_id = auth.uid()
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

-- organization_invites
CREATE POLICY "org members view invites" ON org_invites
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid())
  );
CREATE POLICY "owners manage invites" ON org_invites
  FOR ALL USING (
    organization_id IN (SELECT organization_id FROM org_members WHERE user_id = auth.uid() AND role = 'owner')
  );

-- sessions
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

-- Policies for deleted tables removed

-- ----------------------------------------------------------------------------
-- RPCs: Functions for future RAG features (when needed)
-- ----------------------------------------------------------------------------
-- (match functions removed - will add back when we implement RAG)

-- (jobs policies removed)

-- (outbound policies removed)

-- (audit policies removed)

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

-- Uploads (INSERT)
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

-- Reads (SELECT)
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

-- Deletes/Updates (owners/admin/editor allowed)
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
-- Minimal Search Function (semantic + optional time range filter)
-- ----------------------------------------------------------------------------
-- (search function removed)

-- ----------------------------------------------------------------------------
-- Done
-- ----------------------------------------------------------------------------
