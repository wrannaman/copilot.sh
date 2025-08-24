-- Add storage policies for organization logos
-- Allow organization owners/admins to upload and manage organization logos

-- Drop existing policies to recreate them with org logo support
DROP POLICY IF EXISTS "org members can insert to org or questionnaire folders" ON storage.objects;
DROP POLICY IF EXISTS "org members can read from org or questionnaire folders" ON storage.objects;
DROP POLICY IF EXISTS "org members can update org or questionnaire folders" ON storage.objects;
DROP POLICY IF EXISTS "org members can delete org or questionnaire folders" ON storage.objects;

-- Allow INSERT to questionnaires and organization-logos folders
CREATE POLICY "org members can insert to allowed folders"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'secreq'
  AND (
    -- Questionnaires folder (existing)
    (split_part(name, '/', 1) = 'questionnaires'
    AND (
      -- org folder: questionnaires/<orgId>/...
      EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id::text = split_part(name, '/', 2)
      )
      OR
      -- questionnaire folder: questionnaires/<questionnaireId>/...
      EXISTS (
        SELECT 1
        FROM public.questionnaires q
        JOIN public.organization_memberships om
          ON om.organization_id = q.organization_id
        WHERE q.id::text = split_part(name, '/', 2)
          AND om.user_id = auth.uid()
      )
    ))
    OR
    -- Organization logos folder (new)
    (split_part(name, '/', 1) = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(name, '/', 2)
        AND om.role IN ('owner', 'admin')
    ))
  )
);

-- Allow SELECT from questionnaires and organization-logos folders
CREATE POLICY "org members can read from allowed folders"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'secreq'
  AND (
    -- Questionnaires folder (existing)
    (split_part(name, '/', 1) = 'questionnaires'
    AND (
      EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        WHERE om.user_id = auth.uid()
          AND om.organization_id::text = split_part(name, '/', 2)
      )
      OR
      EXISTS (
        SELECT 1
        FROM public.questionnaires q
        JOIN public.organization_memberships om
          ON om.organization_id = q.organization_id
        WHERE q.id::text = split_part(name, '/', 2)
          AND om.user_id = auth.uid()
      )
    ))
    OR
    -- Organization logos folder (new) - any org member can read
    (split_part(name, '/', 1) = 'organization-logos'
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.user_id = auth.uid()
        AND om.organization_id::text = split_part(name, '/', 2)
    ))
  )
);

-- Allow UPDATE for organization logos (owners/admins only)
CREATE POLICY "org admins can update org logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'secreq'
  AND split_part(name, '/', 1) = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id::text = split_part(name, '/', 2)
      AND om.role IN ('owner', 'admin')
  )
);

-- Allow DELETE for organization logos (owners/admins only)
CREATE POLICY "org admins can delete org logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'secreq'
  AND split_part(name, '/', 1) = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id::text = split_part(name, '/', 2)
      AND om.role IN ('owner', 'admin')
  )
);
