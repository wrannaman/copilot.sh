-- Tags + session_tags migration (idempotent)
-- Creates free-form org-scoped tags and a join table to sessions

BEGIN;

-- Tables
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.org(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_ci TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name_ci)
);

CREATE INDEX IF NOT EXISTS idx_tags_org ON public.tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_tags_name_ci ON public.tags(organization_id, name_ci);

CREATE TABLE IF NOT EXISTS public.session_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_session_tags_session ON public.session_tags(session_id);
CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON public.session_tags(tag_id);

-- RLS enable
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_tags ENABLE ROW LEVEL SECURITY;

-- Policies: tags
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'org members select tags'
  ) THEN
    CREATE POLICY "org members select tags" ON public.tags
      FOR SELECT USING (
        organization_id IN (SELECT organization_id FROM public.org_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tags' AND policyname = 'editors manage tags'
  ) THEN
    CREATE POLICY "editors manage tags" ON public.tags
      FOR ALL TO authenticated
      USING (
        organization_id IN (
          SELECT organization_id FROM public.org_members 
          WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
        )
      )
      WITH CHECK (
        organization_id IN (
          SELECT organization_id FROM public.org_members 
          WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
        )
      );
  END IF;
END $$;

-- Policies: session_tags
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'session_tags' AND policyname = 'org members select session_tags'
  ) THEN
    CREATE POLICY "org members select session_tags" ON public.session_tags
      FOR SELECT USING (
        session_id IN (
          SELECT s.id FROM public.sessions s 
          JOIN public.org_members om ON s.organization_id = om.organization_id
          WHERE om.user_id = auth.uid()
        )
        AND tag_id IN (
          SELECT t.id FROM public.tags t
          JOIN public.org_members om2 ON t.organization_id = om2.organization_id
          WHERE om2.user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'session_tags' AND policyname = 'editors manage session_tags'
  ) THEN
    CREATE POLICY "editors manage session_tags" ON public.session_tags
      FOR ALL TO authenticated
      USING (
        session_id IN (
          SELECT s.id FROM public.sessions s 
          JOIN public.org_members om ON s.organization_id = om.organization_id
          WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor')
        )
        AND tag_id IN (
          SELECT t.id FROM public.tags t
          JOIN public.org_members om2 ON t.organization_id = om2.organization_id
          WHERE om2.user_id = auth.uid() AND om2.role IN ('owner','admin','editor')
        )
      )
      WITH CHECK (
        session_id IN (
          SELECT s.id FROM public.sessions s 
          JOIN public.org_members om ON s.organization_id = om.organization_id
          WHERE om.user_id = auth.uid() AND om.role IN ('owner','admin','editor')
        )
        AND tag_id IN (
          SELECT t.id FROM public.tags t
          JOIN public.org_members om2 ON t.organization_id = om2.organization_id
          WHERE om2.user_id = auth.uid() AND om2.role IN ('owner','admin','editor')
        )
      );
  END IF;
END $$;

COMMIT;


