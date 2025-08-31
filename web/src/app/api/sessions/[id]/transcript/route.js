import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authAny(request) {
  let supabase = await createAuthClient()
  let { data, error } = await supabase.auth.getUser()
  let deviceOrgId = null
  if (error || !data?.user) {
    const authHeader = request.headers.get('authorization') || ''
    const headerKey = request.headers.get('x-device-key') || ''
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : ''
    if (bearer) {
      try {
        const svc = createServiceClient()
        const { data: jwtUser, error: jwtErr } = await svc.auth.getUser(bearer)
        if (!jwtErr && jwtUser?.user) {
          data = { user: jwtUser.user }
          supabase = svc
        }
      } catch { }
    }
    if (!data?.user) {
      const deviceKey = headerKey || (!bearer ? '' : '')
      if (!deviceKey) return { supabase: null, data: null, deviceOrgId: null }
      const svc = createServiceClient()
      const { data: deviceRow } = await svc
        .from('device_api_keys')
        .select('user_id, organization_id, active')
        .eq('key', deviceKey)
        .maybeSingle()
      if (!deviceRow || deviceRow.active === false) return { supabase: null, data: null, deviceOrgId: null }
      supabase = svc
      deviceOrgId = deviceRow.organization_id
    }
  }
  return { supabase, data, deviceOrgId }
}

export async function GET(request, { params }) {
  try {
    const { supabase, data, deviceOrgId } = await authAny(request)
    if (!data?.user && !deviceOrgId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id, transcript_storage_path, raw_transcript_path')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    let text = ''
    const svc = createServiceClient()
    // Prefer diarized raw JSON → format into readable transcript
    if (session.raw_transcript_path) {
      try {
        console.log('[transcript] raw_json_path:', session.raw_transcript_path)
        const { data: rawBlob } = await svc.storage
          .from('copilot.sh')
          .download(session.raw_transcript_path)
        if (rawBlob) {
          const rawJsonText = await rawBlob.text()
          try {
            console.log('[transcript] raw_transcript_path:', session.raw_transcript_path)
            console.log('[transcript] raw_transcript_json_len:', rawJsonText.length)
            console.log('[transcript] raw_transcript_json_preview:', rawJsonText.slice(0, 2000))
          } catch { }
          try {
            const raw = JSON.parse(rawJsonText)
            try {
              console.log('[transcript] raw_json_parsed_keys:', Object.keys(raw || {}))
              console.log('[transcript] raw_json_parsed_preview_obj:', {
                sessionId: raw?.sessionId,
                processedAt: raw?.processedAt,
                resultsCount: Array.isArray(raw?.results) ? raw.results.length : null,
                firstAlt: raw?.results?.[0]?.alternatives?.[0]?.transcript?.slice(0, 200) || null
              })
            } catch { }
            const formatted = formatDiarizedTranscript(raw)
            if (formatted && formatted.trim()) {
              text = formatted
            }
          } catch { }
        }
      } catch { }
    }
    // Finally, flat storage text as last resort
    console.log('[transcript] session:', { id: session.id, org: session.organization_id, txt: !!session.transcript_storage_path, raw: !!session.raw_transcript_path })
    if (session.transcript_storage_path && !text) {
      try {
        const { data: blob } = await svc.storage
          .from('copilot.sh')
          .download(session.transcript_storage_path)
        if (blob) {
          const rawTxt = await blob.text()
          try {
            console.log('[transcript] transcript_storage_path:', session.transcript_storage_path)
            console.log('[transcript] transcript_txt_len:', rawTxt.length)
            console.log('[transcript] transcript_txt_preview:', rawTxt.slice(0, 2000))
          } catch { }
          text = formatStorageText(rawTxt)
        }
      } catch { }
    }
    // Redundant raw re-download removed; logs above include content previews

    if (!text) return NextResponse.json({ message: 'Transcript not available' }, { status: 404 })
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to fetch transcript', details: e?.message }, { status: 500 })
  }
}

function formatDiarizedTranscript(raw) {
  const results = Array.isArray(raw?.results) ? raw.results : (Array.isArray(raw) ? raw : [])
  // 1) If we have word-level diarization, group by speaker with time ranges
  const words = []
  for (const r of results) {
    const alt = r?.alternatives?.[0]
    const w = Array.isArray(alt?.words) ? alt.words : []
    for (const word of w) {
      const tag = Number.isFinite(word?.speakerTag) ? word.speakerTag : (typeof word?.speakerTag === 'number' ? word.speakerTag : null)
      const start = toSeconds(word?.startTime)
      const end = toSeconds(word?.endTime)
      const text = String(word?.word || '').trim()
      if (text) words.push({ speakerTag: tag, start, end, text })
    }
  }
  if (words.length > 0) {
    // Only trust diarization if we have at least 2 speakers and decent coverage
    const tagged = words.filter(w => Number.isFinite(w.speakerTag))
    const coverage = tagged.length / words.length
    const uniqueSpeakers = new Set(tagged.map(w => w.speakerTag)).size
    if (uniqueSpeakers < 2 || coverage < 0.5) {
      // Fallback to per-result formatting when diarization is unreliable
      const resLines = []
      let prevEnd = 0
      for (const r of results) {
        const altTxt = String(r?.alternatives?.[0]?.transcript || '').trim()
        if (!altTxt) continue
        const end = toSeconds(r?.resultEndTime)
        const start = prevEnd
        prevEnd = end
        const body = wrapAt(altTxt.replace(/\s+/g, ' '), 120)
        resLines.push(`[${formatTime(start)}-${formatTime(end)}] ${body}`)
      }
      return resLines.join('\n')
    }

    // Group consecutive words by speaker (ignore untagged words)
    const blocks = []
    let current = null
    for (const w of tagged) {
      if (!current || current.speakerTag !== w.speakerTag) {
        if (current) blocks.push(current)
        current = { speakerTag: w.speakerTag, start: w.start, end: w.end, words: [w.text] }
      } else {
        current.end = w.end
        current.words.push(w.text)
      }
    }
    if (current) blocks.push(current)
    // Ensure blocks are sorted by start time
    blocks.sort((a, b) => (a.start || 0) - (b.start || 0))
    const lines = blocks.map(b => {
      const start = formatTime(b.start)
      const end = formatTime(b.end)
      const text = wrapAt(b.words.join(' ').replace(/\s+/g, ' ').trim(), 120)
      return `[${start}-${end}] Speaker ${b.speakerTag}:\n${text}`
    })
    return lines.join('\n')
  }
  // 2) Else, if results contain chunked transcripts with end times, line per result
  if (Array.isArray(results) && results.length > 0) {
    let prevEnd = 0
    const lines = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const altTxt = String(r?.alternatives?.[0]?.transcript || '').trim()
      if (!altTxt) continue
      const end = toSeconds(r?.resultEndTime)
      const start = prevEnd
      prevEnd = end
      const body = wrapAt(altTxt.replace(/\s+/g, ' '), 120)
      lines.push(`[${formatTime(start)}-${formatTime(end)}] ${body}`)
    }
    if (lines.length) return lines.join('\n')
  }
  // 3) Final fallback: split transcriptText into readable sentences
  const fallback = String(raw?.transcriptText || '').trim()
  if (!fallback) return ''
  const sents = splitSentences(fallback)
  return wrapAt(sents.join('\n'), 120)
}

function toSeconds(ts) {
  if (!ts) return 0
  if (typeof ts === 'string') {
    const m = ts.match(/([0-9]+)(?:\.([0-9]+))?s/)
    if (m) {
      const s = parseInt(m[1] || '0', 10)
      const frac = m[2] ? parseFloat('0.' + m[2]) : 0
      return s + frac
    }
    const n = Number(ts)
    return Number.isFinite(n) ? n : 0
  }
  const s = Number(ts.seconds || 0)
  const nanos = Number(ts.nanos || 0)
  return s + nanos / 1e9
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) sec = 0
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
function formatStorageText(txt) {
  if (!txt || typeof txt !== 'string') return ''
  const lines = []
  const rawLines = txt.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of rawLines) {
    const m = line.match(/^_TIMESTAMP_([^|]+)\|(.*)$/)
    let stamp = ''
    let body = line
    if (m) {
      const iso = m[1]
      body = m[2] || ''
      // Render as YYYY-MM-DD HH:MM
      try {
        const d = new Date(iso)
        const y = d.getUTCFullYear()
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
        const da = String(d.getUTCDate()).padStart(2, '0')
        const hh = String(d.getUTCHours()).padStart(2, '0')
        const mm = String(d.getUTCMinutes()).padStart(2, '0')
        stamp = `[${y}-${mo}-${da} ${hh}:${mm}] `
      } catch { stamp = '' }
    }
    const normalized = body.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    // Split into readable sentences
    const split = normalized.replace(/([\.?!])\s+/g, '$1\n').split('\n')
    for (const s of split) {
      const segment = s.trim()
      if (segment) lines.push(`${stamp}${segment}`)
    }
  }
  // Fallback: if nothing parsed, return the original text
  return lines.length ? lines.join('\n') : txt
}

function splitSentences(text) {
  if (!text) return []
  return text
    .replace(/\s+/g, ' ')
    .replace(/([\.?!])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

function wrapAt(text, max = 120) {
  if (!text) return ''
  const lines = []
  for (const rawLine of String(text).split('\n')) {
    let line = rawLine.trim()
    while (line.length > max) {
      // break at last space before max
      const cut = line.lastIndexOf(' ', max)
      if (cut <= 0) break
      lines.push(line.slice(0, cut))
      line = line.slice(cut + 1)
    }
    if (line) lines.push(line)
  }
  return lines.join('\n')
}


