import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient as createServiceClient } from '@/utils/supabase/server'

export async function POST(request) {
  try {
    const { inviteId } = await request.json()
    if (!inviteId) {
      return NextResponse.json({ message: 'Missing inviteId' }, { status: 400 })
    }

    const supabase = await createServiceClient()

    const { data: invite, error } = await supabase
      .from('organization_invites')
      .select('id, email, role, token, organization_id, status, expires_at, organizations(name)')
      .eq('id', inviteId)
      .single()

    if (error || !invite) {
      return NextResponse.json({ message: 'Invite not found' }, { status: 404 })
    }

    if (invite.status !== 'pending') {
      return NextResponse.json({ message: 'Invite already used or not available' }, { status: 400 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const acceptUrl = `${baseUrl}/accept-invite?token=${invite.token}`

    const resend = new Resend(process.env.RESEND_API_KEY)

    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial">
        <h2>You\'re invited to collaborate on ${invite.organizations?.name || 'SecReq'}</h2>
        <p>You have been invited with the role <strong>${invite.role}</strong>.</p>
        <p>This invite will expire on <strong>${new Date(invite.expires_at).toLocaleString()}</strong>.</p>
        <p><a href="${acceptUrl}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Accept Invitation</a></p>
        <p>Or copy and paste this link into your browser:<br/>${acceptUrl}</p>
      </div>
    `

    const { error: sendError } = await resend.emails.send({
      from: 'Noco <no-reply@hey.noco.io>',
      to: [invite.email.toLowerCase().trim()],
      subject: `You're invited to collaborate on ${invite.organizations?.name || 'SecReq'}`,
      html,
    })

    if (sendError) {
      return NextResponse.json({ message: 'Failed to send invite email', details: sendError.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Invite email sent' })
  } catch (err) {
    return NextResponse.json({ message: 'Unexpected error', details: err.message }, { status: 500 })
  }
}


