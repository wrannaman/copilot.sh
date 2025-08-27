import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST() {
  try {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
    if (!slackWebhookUrl) {
      return NextResponse.json({ message: 'Missing SLACK_WEBHOOK_URL' }, { status: 500 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    // Only notify if the user account was just created (within the last 30 seconds)
    const createdAtStr = data.user.created_at
    const createdAt = createdAtStr ? new Date(createdAtStr) : null
    const isRecent = createdAt ? (Date.now() - createdAt.getTime()) <= 30_000 : false
    if (!isRecent) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const email = data.user.email || 'unknown'
    const payload = {
      text: `copilot.sh - ${email} signed up`
    }

    const res = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      return NextResponse.json({ message: 'Failed to notify Slack' }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ message: 'Unexpected error', details: err.message }, { status: 500 })
  }
}


