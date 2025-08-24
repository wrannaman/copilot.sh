-- -- Drop All Script - Completely clean the database
-- -- WARNING: This will delete ALL data and schema objects!

-- -- Drop existing functions first (they depend on types and tables)
-- DROP FUNCTION IF EXISTS get_user_organizations(UUID) CASCADE;
-- DROP FUNCTION IF EXISTS create_organization_with_owner(TEXT, TEXT, UUID) CASCADE;
-- DROP FUNCTION IF EXISTS match_document_chunks(vector(768), UUID[], float, int) CASCADE;
-- DROP FUNCTION IF EXISTS match_qa_library(vector(768), UUID, float, int) CASCADE;
-- DROP FUNCTION IF EXISTS get_questionnaire_stats(UUID) CASCADE;

-- -- Drop all tables (in reverse dependency order)
-- DROP TABLE IF EXISTS item_versions CASCADE;
-- DROP TABLE IF EXISTS audit_logs CASCADE;
-- DROP TABLE IF EXISTS chat_conversations CASCADE;
-- DROP TABLE IF EXISTS document_chunks CASCADE;
-- DROP TABLE IF EXISTS qa_library CASCADE;
-- DROP TABLE IF EXISTS questionnaire_items CASCADE;
-- DROP TABLE IF EXISTS questionnaires CASCADE;
-- DROP TABLE IF EXISTS dataset_files CASCADE;
-- DROP TABLE IF EXISTS datasets CASCADE;
-- DROP TABLE IF EXISTS organization_memberships CASCADE;
-- DROP TABLE IF EXISTS organizations CASCADE;

-- -- Drop custom types
-- DROP TYPE IF EXISTS user_role CASCADE;

-- -- Drop indexes (should be dropped automatically with tables, but just in case)
-- DROP INDEX IF EXISTS idx_organization_memberships_user CASCADE;
-- DROP INDEX IF EXISTS idx_organization_memberships_org CASCADE;
-- DROP INDEX IF EXISTS idx_questionnaires_org CASCADE;
-- DROP INDEX IF EXISTS idx_questionnaire_items_questionnaire CASCADE;
-- DROP INDEX IF EXISTS idx_questionnaire_items_status CASCADE;
-- DROP INDEX IF EXISTS idx_qa_library_org CASCADE;
-- DROP INDEX IF EXISTS idx_document_chunks_dataset CASCADE;
-- DROP INDEX IF EXISTS idx_audit_logs_org CASCADE;
-- DROP INDEX IF EXISTS idx_audit_logs_user CASCADE;

-- -- Note: Extensions are NOT dropped as they might be used by other schemas
-- -- If you want to drop extensions too, uncomment these:
-- -- DROP EXTENSION IF EXISTS vector CASCADE;
-- -- DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;

-- -- Confirm completion
-- SELECT 'All SecReq schema objects have been dropped successfully!' as status;
