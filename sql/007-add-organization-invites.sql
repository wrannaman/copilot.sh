-- Add organization invites table for team management
CREATE TABLE IF NOT EXISTS organization_invites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  invited_by UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(organization_id, email)
);

-- Add RLS policies for organization_invites
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

-- Org members can view invites for their organization
CREATE POLICY "Org members can view invites" ON organization_invites
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid()
    )
  );

-- Only owners can manage invites
CREATE POLICY "Owners can manage invites" ON organization_invites
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_memberships 
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_organization_invites_org ON organization_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_invites_email ON organization_invites(email);
CREATE INDEX IF NOT EXISTS idx_organization_invites_token ON organization_invites(token);
