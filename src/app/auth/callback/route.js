import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const next = url.searchParams.get('next') || '/dashboard'
    const code = url.searchParams.get('code')
    const token_hash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type')

    // 1) Complete auth as the user (SSR client with anon key + cookies)
    const supabase = await createClient()
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return NextResponse.redirect(new URL('/auth/login', request.url))
    } else if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash })
      if (error) return NextResponse.redirect(new URL('/auth/login', request.url))
    } else {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // 2) Ensure org + membership using admin (service role) client
    const { data: userRes } = await supabase.auth.getUser()
    const userId = userRes?.user?.id
    if (userId) {
      const admin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE,
        { auth: { persistSession: false } }
      )

      // Existing membership?
      const { data: membership } = await admin
        .from('org_members')
        .select('organization_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!membership?.organization_id) {
        const { data: org } = await admin
          .from('org')
          .upsert({ id: userId, name: 'My Organization', display_name: 'My Organization' }, { onConflict: 'id' })
          .select('id')
          .single()

        if (org?.id) {
          await admin
            .from('org_members')
            .upsert({ user_id: userId, organization_id: org.id, role: 'owner' }, { onConflict: 'user_id,organization_id' })
        }
      }
    }

    // 3) Redirect to next
    return NextResponse.redirect(new URL(next, request.url))
  } catch {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }
}


