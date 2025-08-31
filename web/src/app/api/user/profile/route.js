import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request) {
  try {
    const userClient = await createClient()
    const { data: userRes } = await userClient.auth.getUser()
    const user = userRes?.user
    if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    let body = {}
    try { body = await request.json() } catch { }
    const first_name = typeof body?.first_name === 'string' ? body.first_name : undefined
    const last_name = typeof body?.last_name === 'string' ? body.last_name : undefined
    const avatar = typeof body?.avatar === 'string' ? body.avatar : undefined

    const updates = { user_metadata: {} }
    if (first_name !== undefined) updates.user_metadata.first_name = first_name
    if (last_name !== undefined) updates.user_metadata.last_name = last_name
    if (avatar !== undefined) updates.user_metadata.avatar = avatar

    const admin = createServiceClient()
    const { data, error } = await admin.auth.admin.updateUserById(user.id, updates)
    if (error) return NextResponse.json({ message: 'Update failed', details: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, user: data?.user })
  } catch (e) {
    return NextResponse.json({ message: 'Update failed', details: e?.message }, { status: 500 })
  }
}


