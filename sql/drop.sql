-- Drop views first
DROP VIEW IF EXISTS v_my_orgs CASCADE;
DROP VIEW IF EXISTS v_my_sessions CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS create_organization_with_owner(TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_organizations(UUID) CASCADE;
DROP FUNCTION IF EXISTS match_session_chunks(INT, FLOAT, VECTOR, UUID[]) CASCADE;

-- Drop tables (CASCADE handles dependencies)
DROP TABLE IF EXISTS org_invites CASCADE;
DROP TABLE IF EXISTS org_members CASCADE;
DROP TABLE IF EXISTS org CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS session_transcripts CASCADE;
DROP TABLE IF EXISTS session_chunks CASCADE;
DROP TABLE IF EXISTS calendar_events CASCADE;
DROP TABLE IF EXISTS integrations CASCADE;

-- Drop custom types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS integration_type CASCADE;

