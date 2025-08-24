 -- Clean Supabase Schema with Fixed RLS Policies
-- Single source of truth - drop everything and run this

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing functions first (they depend on types)
DROP FUNCTION IF EXISTS get_user_organizations(UUID);
DROP FUNCTION IF EXISTS create_organization_with_owner(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS match_document_chunks(vector(768), UUID[], float, int);
DROP FUNCTION IF EXISTS match_qa_library(vector(768), UUID, float, int);
DROP FUNCTION IF EXISTS get_questionnaire_stats(UUID);

-- Drop existing tables if they exist (in correct order to handle dependencies)
DROP TABLE IF EXISTS item_versions CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS qa_library CASCADE;
DROP TABLE IF EXISTS questionnaire_items CASCADE;
DROP TABLE IF EXISTS questionnaires CASCADE;
DROP TABLE IF EXISTS dataset_files CASCADE;
DROP TABLE IF EXISTS datasets CASCADE;
DROP TABLE IF EXISTS organization_memberships CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- Drop custom types (after functions and tables)
DROP TYPE IF EXISTS user_role CASCADE;

-- Create custom types
CREATE TYPE user_role AS ENUM ('owner', 'editor', 'viewer');

-- Organizations table (multi-tenant)
CREATE TABLE organizations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization memberships (RBAC)
CREATE TABLE organization_memberships (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);

-- Datasets (collateral management)
CREATE TABLE datasets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Dataset files
CREATE TABLE dataset_files (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Questionnaires
CREATE TABLE questionnaires (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  original_file_path TEXT NOT NULL,
  field_mappings JSONB NOT NULL DEFAULT '{}',
  selected_datasets UUID[] DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Questions and answers
CREATE TABLE questionnaire_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  questionnaire_id UUID REFERENCES questionnaires(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  original_answer TEXT,
  draft_answer TEXT,
  final_answer TEXT,
  section TEXT,
  row_number INTEGER,
  confidence_score FLOAT,
  status TEXT DEFAULT 'pending', -- pending, needs_sme, approved, rejected
  citations JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- QA Library (for reuse)
CREATE TABLE qa_library (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  section TEXT,
  metadata JSONB DEFAULT '{}',
  embedding vector(768),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document chunks for RAG
CREATE TABLE document_chunks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  file_id UUID REFERENCES dataset_files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB DEFAULT '{}',
  chunk_index INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat conversations
CREATE TABLE chat_conversations (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  questionnaire_id UUID REFERENCES questionnaires(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  messages JSONB DEFAULT '[]',
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log
CREATE TABLE audit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Version history
CREATE TABLE item_versions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  questionnaire_item_id UUID REFERENCES questionnaire_items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  answer TEXT NOT NULL,
  confidence_score FLOAT,
  citations JSONB DEFAULT '[]',
  changed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_organization_memberships_user ON organization_memberships(user_id);
CREATE INDEX idx_organization_memberships_org ON organization_memberships(organization_id);
CREATE INDEX idx_questionnaires_org ON questionnaires(organization_id);
CREATE INDEX idx_questionnaire_items_questionnaire ON questionnaire_items(questionnaire_id);
CREATE INDEX idx_questionnaire_items_status ON questionnaire_items(status);
CREATE INDEX idx_qa_library_org ON qa_library(organization_id);
CREATE INDEX idx_document_chunks_dataset ON document_chunks(dataset_id);
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);

-- Vector similarity search indexes
CREATE INDEX ON qa_library USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES - CLEAN AND NON-RECURSIVE
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ORGANIZATION_MEMBERSHIPS - Read-only for users, system manages memberships
-- ============================================================================

-- Users can only VIEW their own memberships (no modification)
CREATE POLICY "Users can view own memberships" ON organization_memberships
  FOR SELECT USING (user_id = auth.uid());

-- Only organization owners can manage memberships (invite/remove users)
CREATE POLICY "Owners can manage org memberships" ON organization_memberships
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Owners can update org memberships" ON organization_memberships
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Owners can delete org memberships" ON organization_memberships
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ============================================================================
-- ORGANIZATIONS - Users can only see orgs they're members of
-- ============================================================================
CREATE POLICY "Users can view their organizations" ON organizations
  FOR SELECT USING (
    id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update their organization" ON organizations
  FOR UPDATE USING (
    id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "Authenticated users can create organizations" ON organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================================
-- DATASETS - Org members can view, editors+ can manage
-- ============================================================================
CREATE POLICY "Org members can view datasets" ON datasets
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage datasets" ON datasets
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================================================
-- DATASET_FILES - Follow dataset permissions
-- ============================================================================
CREATE POLICY "Dataset access controls files" ON dataset_files
  FOR ALL USING (
    dataset_id IN (
      SELECT d.id FROM datasets d
      JOIN organization_memberships om ON d.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- QUESTIONNAIRES - Org members can view, editors+ can manage
-- ============================================================================
CREATE POLICY "Org members can view questionnaires" ON questionnaires
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage questionnaires" ON questionnaires
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================================================
-- QUESTIONNAIRE_ITEMS - Follow questionnaire permissions
-- ============================================================================
CREATE POLICY "Questionnaire access controls items" ON questionnaire_items
  FOR ALL USING (
    questionnaire_id IN (
      SELECT q.id FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- QA_LIBRARY - Org members can view, editors+ can manage
-- ============================================================================
CREATE POLICY "Org members can view qa_library" ON qa_library
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Editors can manage qa_library" ON qa_library
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- ============================================================================
-- DOCUMENT_CHUNKS - Follow dataset permissions
-- ============================================================================
CREATE POLICY "Dataset access controls chunks" ON document_chunks
  FOR ALL USING (
    dataset_id IN (
      SELECT d.id FROM datasets d
      JOIN organization_memberships om ON d.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- CHAT_CONVERSATIONS - Follow questionnaire permissions
-- ============================================================================
CREATE POLICY "Questionnaire access controls conversations" ON chat_conversations
  FOR ALL USING (
    questionnaire_id IN (
      SELECT q.id FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- AUDIT_LOGS - Org members can view
-- ============================================================================
CREATE POLICY "Org members can view audit logs" ON audit_logs
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- ITEM_VERSIONS - Follow questionnaire_item permissions
-- ============================================================================
CREATE POLICY "Item access controls versions" ON item_versions
  FOR ALL USING (
    questionnaire_item_id IN (
      SELECT qi.id FROM questionnaire_items qi
      JOIN questionnaires q ON qi.questionnaire_id = q.id
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- ============================================================================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ============================================================================

-- Function to get user organizations
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

-- Function to create organization with owner
CREATE OR REPLACE FUNCTION create_organization_with_owner(
  org_name TEXT,
  org_slug TEXT,
  owner_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug)
  VALUES (org_name, org_slug)
  RETURNING id INTO new_org_id;
  
  INSERT INTO organization_memberships (user_id, organization_id, role)
  VALUES (owner_id, new_org_id, 'owner');
  
  RETURN new_org_id;
END;
$$;

-- Function for vector similarity search on document chunks
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(768),
  dataset_ids UUID[],
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity float,
  file_name TEXT,
  dataset_name TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    dc.metadata,
    (dc.embedding <#> query_embedding) * -1 AS similarity,
    df.name AS file_name,
    d.name AS dataset_name
  FROM document_chunks dc
  JOIN dataset_files df ON dc.file_id = df.id
  JOIN datasets d ON dc.dataset_id = d.id
  WHERE 
    dc.dataset_id = ANY(dataset_ids)
    AND (dc.embedding <#> query_embedding) * -1 > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Function for vector similarity search on QA library
CREATE OR REPLACE FUNCTION match_qa_library(
  query_embedding vector(768),
  organization_id UUID DEFAULT NULL,
  match_threshold float DEFAULT 0.75,
  match_count int DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  question TEXT,
  answer TEXT,
  section TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    qa.id,
    qa.question,
    qa.answer,
    qa.section,
    qa.metadata,
    (qa.embedding <#> query_embedding) * -1 AS similarity
  FROM qa_library qa
  WHERE 
    (organization_id IS NULL OR qa.organization_id = organization_id)
    AND (qa.embedding <#> query_embedding) * -1 > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- Function to get questionnaire statistics
CREATE OR REPLACE FUNCTION get_questionnaire_stats(questionnaire_uuid UUID)
RETURNS TABLE(
  total_items BIGINT,
  pending_items BIGINT,
  needs_sme_items BIGINT,
  approved_items BIGINT,
  rejected_items BIGINT,
  avg_confidence FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) AS total_items,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending_items,
    COUNT(*) FILTER (WHERE status = 'needs_sme') AS needs_sme_items,
    COUNT(*) FILTER (WHERE status = 'approved') AS approved_items,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_items,
    AVG(confidence_score) AS avg_confidence
  FROM questionnaire_items
  WHERE questionnaire_id = questionnaire_uuid;
END;
$$;