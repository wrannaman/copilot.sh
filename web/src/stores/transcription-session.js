import { create } from 'zustand'
import { toast } from 'sonner'

export const useTranscriptionStore = create((set, get) => ({
  // State
  isRecording: false,
  isSending: false,
  errorMessage: '',
  errorCode: null,
  mediaStream: null,
  mediaRecorder: null,
  remoteRotateTimer: null,
  chunkIntervalMs: 5000,
  nextSendAt: 0,
  preferredDeviceId: null,
  audioLevel: 0,
  audioLevelTimer: null,
  audioContext: null,
  audioAnalyser: null,
  audioSource: null,
  audioMonitorTimer: null,
  remoteInFlight: false,
  remotePendingBlob: null,
  sessionId: null,
  seq: 0,
  recentTranscripts: [],
  summary: null,
  summarizing: false,

  // Helpers
  clearError: () => set({ errorMessage: '', errorCode: null }),
  setPreferredDeviceId: (deviceId) => set({ preferredDeviceId: deviceId || null }),

  startAudioMonitor: (stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      src.connect(analyser)
      const buf = new Uint8Array(analyser.fftSize)
      const monitor = setInterval(() => {
        try {
          analyser.getByteTimeDomainData(buf)
          let peak = 0
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i] - 128) / 128
            if (v > peak) peak = v
          }
          const smoothed = Math.min(1, Math.max(0, peak))
          set({ audioLevel: smoothed })
        } catch { }
      }, 100)
      set({ audioContext: ctx, audioAnalyser: analyser, audioSource: src, audioMonitorTimer: monitor })
    } catch { }
  },

  stopAudioMonitor: () => {
    const s = get()
    if (s.audioMonitorTimer) {
      try { clearInterval(s.audioMonitorTimer) } catch { }
    }
    if (s.audioContext) {
      try { s.audioContext.close() } catch { }
    }
    set({ audioMonitorTimer: null, audioContext: null, audioAnalyser: null, audioSource: null, audioLevel: 0 })
  },

  // Actions
  startRecording: async (options = {}) => {
    const store = get()
    if (store.isRecording) return

    set({ isRecording: true, errorMessage: '', errorCode: null, recentTranscripts: [], nextSendAt: Date.now() + get().chunkIntervalMs, audioLevel: 0 })

    // Create session
    let sessionId = null
    try {
      const payload = {}
      if (options && typeof options.title === 'string') payload.title = options.title
      if (options && typeof options.summaryPrompt === 'string') payload.summary_prompt = options.summaryPrompt
      const res = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(`create session ${res.status}`)
      const data = await res.json()
      sessionId = data.session_id
      if (!sessionId) throw new Error('no session id')
    } catch (e) {
      const msg = 'Failed to create session.'
      set({ errorMessage: msg, errorCode: 'session-create-failed', isRecording: false })
      toast.error(msg)
      return
    }

    // Start meter decay
    if (!get().audioLevelTimer) {
      const decay = setInterval(() => {
        set((state) => ({ audioLevel: Math.max(0, state.audioLevel * 0.85 - 0.02) }))
      }, 100)
      set({ audioLevelTimer: decay })
    }

    try {
      let stream
      const preferred = get().preferredDeviceId
      try {
        const constraints = preferred ? { audio: { deviceId: { exact: preferred } } } : { audio: true }
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (e1) {
        console.warn('[REMOTE] preferred mic failed, fallback:', e1?.name)
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      let mimeType = ''
      if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus'
      } else if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else {
        mimeType = 'audio/webm'
      }

      const setupRecorder = () => {
        const recorder = new MediaRecorder(stream, { mimeType })
        recorder.ondataavailable = async (e) => {
          const blob = e.data
          if (!blob || blob.size === 0) return

          const processBlob = async (b) => {
            try {
              const fileName = mimeType.includes('ogg') ? 'chunk.ogg' : 'chunk.webm'
              const file = new File([b], fileName, { type: mimeType })
              const form = new FormData()
              form.append('chunk', file)
              form.append('mimeType', mimeType)
              form.append('seq', String(get().seq))

              const res = await fetch(`/api/sessions/${get().sessionId}/chunk`, { method: 'POST', body: form })
              const data = await res.json()
              const live = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : ''
              if (live) {
                const transcript = { seq: Date.now(), text: live, timestamp: new Date().toLocaleTimeString() }
                set(state => ({ recentTranscripts: [transcript, ...state.recentTranscripts.slice(0, 9)] }))
              }
            } catch (err) {
              console.error('[REMOTE] chunk send failed:', err)
              set({ errorMessage: 'Failed to send audio chunk', errorCode: 'remote-send-failed' })
            } finally {
              set({ seq: get().seq + 1 })
            }
          }

          const s = get()
          if (s.remoteInFlight) {
            set({ remotePendingBlob: blob })
            return
          }
          set({ remoteInFlight: true, isSending: true })
          await processBlob(blob)
          const pending = get().remotePendingBlob
          if (pending) {
            set({ remotePendingBlob: null })
            await processBlob(pending)
          }
          set({ remoteInFlight: false, isSending: false })
        }
        recorder.onstop = () => {
          const s = get()
          if (!s.isRecording) return
          const newRec = setupRecorder()
          newRec.start()
          try { if (s.remoteRotateTimer) clearTimeout(s.remoteRotateTimer) } catch { }
          const nextTimer = setTimeout(() => { try { newRec.stop() } catch { } }, get().chunkIntervalMs)
          set({ mediaRecorder: newRec, remoteRotateTimer: nextTimer, nextSendAt: Date.now() + get().chunkIntervalMs })
        }
        return recorder
      }

      set({ sessionId, seq: 0 })
      const rec = setupRecorder()
      rec.start()
      const rotateTimer = setTimeout(() => { try { rec.stop() } catch { } }, get().chunkIntervalMs)
      set({ mediaStream: stream, mediaRecorder: rec, remoteInFlight: false, remotePendingBlob: null, remoteRotateTimer: rotateTimer, nextSendAt: Date.now() + get().chunkIntervalMs })
      get().startAudioMonitor(stream)
      return
    } catch (e) {
      console.warn('[REMOTE] failed to start:', e)
      const msg = 'Microphone access failed or MediaRecorder unsupported.'
      set({ errorMessage: msg, errorCode: 'remote-start-failed', isRecording: false })
      toast.error(msg)
      return
    }
  },

  stopRecording: async () => {
    const store = get()

    if (store.remoteRotateTimer) {
      try { clearTimeout(store.remoteRotateTimer) } catch { }
    }
    if (store.mediaRecorder) {
      try { store.mediaRecorder.stop() } catch { }
    }
    if (store.mediaStream) {
      try { store.mediaStream.getTracks().forEach(t => t.stop()) } catch { }
    }
    get().stopAudioMonitor()

    if (store.audioLevelTimer) {
      try { clearInterval(store.audioLevelTimer) } catch { }
    }

    set({ isRecording: false, mediaStream: null, mediaRecorder: null, nextSendAt: 0, audioLevel: 0, audioLevelTimer: null })

    // Finalize session and enqueue worker
    if (store.sessionId) {
      try {
        await fetch(`/api/sessions/${store.sessionId}/stop`, { method: 'POST' })
        await fetch(`/api/sessions/${store.sessionId}/finalize`, { method: 'POST' })
      } catch (_) { }
    }
    set({ sessionId: null, seq: 0 })
  },

  finalizeAndSummarize: async (customPrompt = '') => {
    const s = get()
    if (!s.sessionId) return
    try {
      await fetch(`/api/sessions/${s.sessionId}/finalize`, { method: 'POST' })
      let ready = false
      for (let i = 0; i < 40 && !ready; i++) {
        const st = await (await fetch(`/api/sessions/${s.sessionId}/status`)).json()
        ready = st?.status === 'ready' || (st?.processed ?? 0) >= (st?.parts ?? 0)
        if (!ready) {
          await fetch(`/api/sessions/${s.sessionId}/finalize`, { method: 'POST' })
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    } catch (e) {
      console.warn('finalize failed', e)
    }

    try {
      set({ summarizing: true })
      const res = await fetch(`/api/sessions/${s.sessionId}/summarize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: String(customPrompt || '') })
      })
      const obj = await res.json()
      set({ summary: obj, summarizing: false })
      return obj
    } catch (e) {
      set({ summarizing: false })
      console.warn('summarize failed', e)
    }
  }
}))


