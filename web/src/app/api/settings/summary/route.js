import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const orgId = cookieStore.get('org_id')?.value
    if (!orgId) return NextResponse.json({ message: 'No org' }, { status: 400 })

    // Require auth
    const userClient = await createClient()
    const { data: userRes } = await userClient.auth.getUser()
    if (!userRes?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: org } = await supabase
      .from('org')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle()

    const prefs = (org?.settings && org.settings.summary_prefs) || {}
    const default_prompt = 'Focus on concrete information, decisions, and actionable items.'
    return NextResponse.json({
      prompt: typeof prefs.prompt === 'string' ? prefs.prompt : '',
      topics: Array.isArray(prefs.topics) ? prefs.topics : [],
      action_items: Array.isArray(prefs.action_items) ? prefs.action_items : [],
      default_prompt,
    })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to load', details: e?.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const cookieStore = await cookies()
    const orgId = cookieStore.get('org_id')?.value
    if (!orgId) return NextResponse.json({ message: 'No org' }, { status: 400 })

    // Require auth
    const userClient = await createClient()
    const { data: userRes } = await userClient.auth.getUser()
    if (!userRes?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    let body = {}
    try { body = await request.json() } catch { }
    const wantsReset = body && body.reset === true

    const supabase = createServiceClient()
    const { data: org } = await supabase
      .from('org')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle()

    const current = org?.settings || {}

    let nextSettings
    if (wantsReset) {
      nextSettings = { ...current }
      if (nextSettings && typeof nextSettings === 'object') {
        delete nextSettings.summary_prefs
      }
    } else {
      const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
      const topics = Array.isArray(body?.topics) ? body.topics : []
      const action_items = Array.isArray(body?.action_items) ? body.action_items : []
      nextSettings = {
        ...current,
        summary_prefs: { prompt, topics, action_items },
      }
    }

    const { error } = await supabase
      .from('org')
      .update({ settings: nextSettings })
      .eq('id', orgId)

    if (error) return NextResponse.json({ message: 'Save failed', details: error.message }, { status: 500 })

    const prefs = nextSettings.summary_prefs || {}
    const default_prompt = 'Focus on concrete information, decisions, and actionable items.'
    return NextResponse.json({
      ok: true,
      prompt: typeof prefs.prompt === 'string' ? prefs.prompt : '',
      topics: Array.isArray(prefs.topics) ? prefs.topics : [],
      action_items: Array.isArray(prefs.action_items) ? prefs.action_items : [],
      default_prompt,
    })
  } catch (e) {
    return NextResponse.json({ message: 'Save failed', details: e?.message }, { status: 500 })
  }
}


