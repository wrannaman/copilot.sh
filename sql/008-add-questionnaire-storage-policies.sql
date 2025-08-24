-- Add storage policies for questionnaire files

-- Ensure the secreq bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('secreq', 'secreq', false)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can upload questionnaire files" ON storage.objects;
DROP POLICY IF EXISTS "Users can download questionnaire files" ON storage.objects;
DROP POLICY IF EXISTS "Users can manage questionnaire files" ON storage.objects;

-- Allow authenticated users to upload questionnaire files to their organization's folders
CREATE POLICY "Users can upload questionnaire files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user belongs to the organization and it's a questionnaire folder
    (storage.foldername(name))[1] = 'questionnaires' AND
    (storage.foldername(name))[2] IN (
      SELECT q.id::text 
      FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Allow authenticated users to download questionnaire files from their organization
CREATE POLICY "Users can download questionnaire files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user belongs to the organization and it's a questionnaire folder
    (storage.foldername(name))[1] = 'questionnaires' AND
    (storage.foldername(name))[2] IN (
      SELECT q.id::text 
      FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Allow users to update/delete questionnaire files from their organization (editors+ only)
CREATE POLICY "Users can manage questionnaire files" ON storage.objects
  FOR ALL USING (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user is owner/editor and it's a questionnaire folder
    (storage.foldername(name))[1] = 'questionnaires' AND
    (storage.foldername(name))[2] IN (
      SELECT q.id::text 
      FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user is owner/editor and it's a questionnaire folder
    (storage.foldername(name))[1] = 'questionnaires' AND
    (storage.foldername(name))[2] IN (
      SELECT q.id::text 
      FROM questionnaires q
      JOIN organization_memberships om ON q.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'editor')
    )
  );

-- Alternative simpler policy (uncomment if the above is too complex):
/*
DROP POLICY IF EXISTS "Users can upload questionnaire files" ON storage.objects;
DROP POLICY IF EXISTS "Users can download questionnaire files" ON storage.objects;
DROP POLICY IF EXISTS "Users can manage questionnaire files" ON storage.objects;

CREATE POLICY "Authenticated users can manage questionnaire files" ON storage.objects
  FOR ALL USING (
    bucket_id = 'secreq' AND 
    auth.uid() IS NOT NULL AND
    (storage.foldername(name))[1] = 'questionnaires'
  )
  WITH CHECK (
    bucket_id = 'secreq' AND 
    auth.uid() IS NOT NULL AND
    (storage.foldername(name))[1] = 'questionnaires'
  );
*/
