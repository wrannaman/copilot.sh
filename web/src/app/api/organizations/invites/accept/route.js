import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/utils/supabase/server'

export async function POST(request) {
  try {
    const { token } = await request.json()
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ message: 'Missing invite token' }, { status: 400 })
    }

    // Get authenticated user from cookies/session
    const authClient = await createClient()
    const { data: userData, error: userError } = await authClient.auth.getUser()
    if (userError || !userData?.user) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 })
    }

    const authedUser = userData.user
    const authedEmail = (authedUser.email || '').toLowerCase()

    const supabase = await createServiceClient()

    // Look up invite
    const { data: invite, error: inviteError } = await supabase
      .from('org_invites')
      .select('id, organization_id, email, role, status, expires_at')
      .eq('token', token)
      .single()

    if (inviteError || !invite) {
      return NextResponse.json({ message: 'Invalid invite token' }, { status: 404 })
    }

    if (invite.status !== 'pending') {
      return NextResponse.json({ message: 'Invite already used or not available' }, { status: 400 })
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ message: 'Invite has expired' }, { status: 400 })
    }

    // Ensure the authenticated email matches the invite email
    if (authedEmail !== (invite.email || '').toLowerCase()) {
      return NextResponse.json({ message: 'Invite email does not match signed-in user' }, { status: 403 })
    }

    // Add membership (upsert to handle retries)
    const { error: memberError } = await supabase
      .from('org_members')
      .upsert({
        user_id: authedUser.id,
        organization_id: invite.organization_id,
        role: invite.role,
      }, { onConflict: 'user_id,organization_id' })

    if (memberError) {
      return NextResponse.json({ message: 'Failed to add membership', details: memberError.message }, { status: 500 })
    }

    // Mark invite as accepted
    await supabase
      .from('org_invites')
      .update({ status: 'accepted' })
      .eq('id', invite.id)

    return NextResponse.json({
      message: 'Invitation accepted',
      organization_id: invite.organization_id,
      role: invite.role,
    })
  } catch (err) {
    return NextResponse.json({ message: 'Unexpected error', details: err.message }, { status: 500 })
  }
}


