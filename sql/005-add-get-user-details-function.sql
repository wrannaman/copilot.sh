-- Function to get user details from auth.users
-- SECURE: Only returns users from organizations the caller belongs to
CREATE OR REPLACE FUNCTION get_user_details(user_ids UUID[])
RETURNS TABLE(
  id UUID,
  email CHARACTER VARYING,
  full_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_id UUID;
  allowed_user_ids UUID[];
BEGIN
  -- Get the calling user ID
  caller_id := auth.uid();
  
  -- Return empty if not authenticated
  IF caller_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Get all user IDs from organizations the caller belongs to
  SELECT ARRAY_AGG(DISTINCT om.user_id)
  INTO allowed_user_ids
  FROM organization_memberships om
  WHERE om.organization_id IN (
    SELECT organization_id 
    FROM organization_memberships 
    WHERE user_id = caller_id
  );
  
  -- Return empty if no allowed users found
  IF allowed_user_ids IS NULL THEN
    RETURN;
  END IF;
  
  -- Only return users that are in the same organizations AND in the requested list
  RETURN QUERY
  SELECT 
    au.id,
    au.email::CHARACTER VARYING,
    COALESCE(
      au.raw_user_meta_data->>'full_name',
      au.raw_user_meta_data->>'name', 
      split_part(au.email, '@', 1)
    )::TEXT as full_name
  FROM auth.users au
  WHERE au.id = ANY(user_ids)
    AND au.id = ANY(allowed_user_ids);
END;
$$;
