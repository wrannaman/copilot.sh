-- Fix Supabase Storage RLS policies for the secreq bucket

-- First, check if bucket exists (if not, create it)
INSERT INTO storage.buckets (id, name, public)
VALUES ('secreq', 'secreq', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files to their own org folders
CREATE POLICY "Users can upload files to their datasets" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user belongs to the organization that owns the dataset
    (storage.foldername(name))[1] = 'datasets' AND
    (storage.foldername(name))[2] IN (
      SELECT d.id::text 
      FROM datasets d
      JOIN organization_memberships om ON d.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Allow authenticated users to download files from their datasets
CREATE POLICY "Users can download files from their datasets" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user belongs to the organization that owns the dataset
    (storage.foldername(name))[1] = 'datasets' AND
    (storage.foldername(name))[2] IN (
      SELECT d.id::text 
      FROM datasets d
      JOIN organization_memberships om ON d.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

-- Allow users to delete files from their datasets (for cleanup)
CREATE POLICY "Users can delete files from their datasets" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'secreq' AND
    auth.uid() IS NOT NULL AND
    -- Check if user belongs to the organization that owns the dataset
    (storage.foldername(name))[1] = 'datasets' AND
    (storage.foldername(name))[2] IN (
      SELECT d.id::text 
      FROM datasets d
      JOIN organization_memberships om ON d.organization_id = om.organization_id
      WHERE om.user_id = auth.uid()
      AND om.role IN ('owner', 'editor')  -- Only owners/editors can delete
    )
  );

-- Alternative simpler policy if the above is too complex:
-- This allows any authenticated user to access any file in the secreq bucket
-- (Use this if you want to simplify permissions for now)

/*
DROP POLICY IF EXISTS "Users can upload files to their datasets" ON storage.objects;
DROP POLICY IF EXISTS "Users can download files from their datasets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete files from their datasets" ON storage.objects;

CREATE POLICY "Authenticated users can manage secreq files" ON storage.objects
  FOR ALL USING (bucket_id = 'secreq' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'secreq' AND auth.uid() IS NOT NULL);
*/
