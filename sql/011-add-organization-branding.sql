-- Add organization branding fields
-- This adds display_name and logo_url to the organizations table

ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Update display_name to match name where it's null
UPDATE organizations 
SET display_name = name 
WHERE display_name IS NULL;
