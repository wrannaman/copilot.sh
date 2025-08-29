import { create } from 'zustand'
import { toast } from 'sonner'

export const useTranscriptionStore = create((set, get) => ({
  // State
  isRecording: false,
  textArray: [],
  currentPartial: '',
  recentTranscripts: [],
  isSending: false,
  errorMessage: '',
  errorCode: null,
  recognitionMode: 'remote', // 'local' (browser) or 'remote' 
  mediaStream: null,
  mediaRecorder: null,
  chunkIntervalMs: 10000,
  nextSendAt: 0,
  audioLevel: 0,
  audioLevelTimer: null,
  audioContext: null,
  audioAnalyser: null,
  audioSource: null,
  audioMonitorTimer: null,
  remoteInFlight: false,
  remotePendingBlob: null,
  preferredDeviceId: null,
  remoteRotateTimer: null,
  _recordingStartedAt: 0,
  _lastHeardAt: 0,
  _silenceWarned: false,
  _restartPending: false,
  _lastRestartAt: 0,
  _restartFailures: 0,
  _restartWindowStart: 0,
  _restartTimer: null,

  // Timers
  sendTimer: null,
  recognition: null,

  // Error helpers
  clearError: () => set({ errorMessage: '', errorCode: null }),

  // Mode
  setRecognitionMode: (mode) => {
    const m = mode === 'remote' ? 'remote' : 'local'
    set({ recognitionMode: m })
  },

  setPreferredDeviceId: (deviceId) => {
    set({ preferredDeviceId: deviceId || null })
  },

  // Audio monitor (for remote mode)
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
          // Compute peak deviation from 128 (center) as a simple level
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
  startRecording: async () => {
    const store = get()
    if (store.isRecording) return

    set({ isRecording: true, textArray: [], currentPartial: '', recentTranscripts: [], errorMessage: '', errorCode: null, _recordingStartedAt: Date.now(), _lastHeardAt: 0, _silenceWarned: false, _restartPending: false, _lastRestartAt: 0, _restartFailures: 0, _restartWindowStart: Date.now(), _restartTimer: null, nextSendAt: Date.now() + get().chunkIntervalMs, audioLevel: 0 })

    // Start a gentle audio level decay so the meter falls between updates
    if (!get().audioLevelTimer) {
      const decay = setInterval(() => {
        set((state) => ({ audioLevel: Math.max(0, state.audioLevel * 0.85 - 0.02) }))
      }, 100)
      set({ audioLevelTimer: decay })
    }

    // Remote mode: record audio chunks and send to API
    if (get().recognitionMode === 'remote') {
      try {
        let stream
        const preferred = get().preferredDeviceId
        try {
          const constraints = preferred ? { audio: { deviceId: { exact: preferred } } } : { audio: true }
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (e1) {
          console.warn('[REMOTE] preferred mic failed, falling back to default:', e1?.name)
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        }
        let mimeType = ''
        if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus'
        } else if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus'
        } else {
          mimeType = 'audio/webm'
        }

        const setupRecorder = () => {
          const recorder = new MediaRecorder(stream, { mimeType })
          recorder.ondataavailable = async (e) => {
            const blob = e.data
            if (!blob || blob.size === 0) return
            // nextSendAt is set when we schedule the next rotation

            const processBlob = async (b) => {
              try {
                const fileName = mimeType.includes('ogg') ? 'chunk.ogg' : 'chunk.webm'
                const file = new File([b], fileName, { type: mimeType })

                const form = new FormData()
                form.append('chunk', file)
                form.append('mimeType', mimeType)
                form.append('mode', 'cloud')

                const res = await fetch('/api/transcribe', { method: 'POST', body: form })
                const data = await res.json()
                const finalized = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : ''
                if (finalized) {
                  const transcript = {
                    seq: Date.now(),
                    text: finalized,
                    timestamp: new Date().toLocaleTimeString()
                  }
                  set(state => ({
                    recentTranscripts: [transcript, ...state.recentTranscripts.slice(0, 9)]
                  }))
                }
              } catch (err) {
                console.error('[REMOTE] send chunk failed:', err)
                set({ errorMessage: 'Failed to send audio chunk', errorCode: 'remote-send-failed' })
              }
            }

            const s = get()
            if (s.remoteInFlight) {
              set({ remotePendingBlob: blob })
              return
            }
            set({ remoteInFlight: true, isSending: true })
            await processBlob(blob)
            // Drain one pending blob if present (keep latest)
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
            // Immediately start a new recorder to minimize gap
            const newRec = setupRecorder()
            newRec.start()
            // Schedule next rotation
            try { if (s.remoteRotateTimer) clearTimeout(s.remoteRotateTimer) } catch { }
            const nextTimer = setTimeout(() => {
              try { newRec.stop() } catch { }
            }, get().chunkIntervalMs)
            set({ mediaRecorder: newRec, remoteRotateTimer: nextTimer, nextSendAt: Date.now() + get().chunkIntervalMs })
          }
          return recorder
        }

        const rec = setupRecorder()

        rec.start()
        const rotateTimer = setTimeout(() => {
          try { rec.stop() } catch { }
        }, get().chunkIntervalMs)
        set({ mediaStream: stream, mediaRecorder: rec, remoteInFlight: false, remotePendingBlob: null, remoteRotateTimer: rotateTimer, nextSendAt: Date.now() + get().chunkIntervalMs })
        get().startAudioMonitor(stream)
        return
      } catch (e) {
        console.warn('[REMOTE] failed to start:', e)
        const msg = 'Microphone access failed or MediaRecorder unsupported.'
        set({ errorMessage: msg, errorCode: 'remote-start-failed' })
        return
      }
    }

    // Local (browser) STT
    // If a preferred device is chosen, open a stream for monitoring so the level bar reflects that mic.
    try {
      const preferred = get().preferredDeviceId
      if (preferred) {
        try {
          const monitorStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferred } } })
          set({ mediaStream: monitorStream })
          get().startAudioMonitor(monitorStream)
        } catch (monErr) {
          console.warn('[LOCAL] preferred mic monitor failed, fallback to default monitor:', monErr?.name)
          try {
            const monitorStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            set({ mediaStream: monitorStream })
            get().startAudioMonitor(monitorStream)
          } catch (_) { }
        }
      }
    } catch (_) { }

    const SR = window.webkitSpeechRecognition || window.SpeechRecognition
    if (!SR) {
      const msg = 'Speech Recognition is not supported in this browser.'
      set({ errorMessage: msg, errorCode: 'unsupported' })
      toast.warning(msg)
      return
    }

    const recog = new SR()
    recog.lang = 'en-US'
    recog.continuous = true
    recog.interimResults = true
    recog.maxAlternatives = 1

    recog.onstart = () => {
      const now = Date.now()
      set({ _lastRestartAt: now, _restartPending: false })
      console.log('[STT] onstart')
    }

    recog.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        if (res.isFinal) {
          const text = res[0]?.transcript?.trim()
          if (text) {
            console.log('[STT] final:', text)
            set(state => ({
              textArray: [...state.textArray, text],
              currentPartial: '',
              errorMessage: '',
              errorCode: null,
              _lastHeardAt: Date.now()
            }))
          }
        } else {
          const partial = res[0]?.transcript?.trim() || ""
          set(state => ({
            currentPartial: partial,
            _lastHeardAt: partial ? Date.now() : get()._lastHeardAt,
            audioLevel: partial ? Math.min(1, state.audioLevel * 0.5 + 0.5) : state.audioLevel
          }))
        }
      }
    }

    recog.onerror = (e) => {
      console.warn('[STT] error:', e.error)
      let message = 'Speech recognition error.'
      switch (e.error) {
        case 'no-speech':
          // benign, do not surface loudly; recognition will restart via onend
          return
        case 'audio-capture':
          message = 'No microphone available. Please connect or enable a microphone.'
          toast.error(message)
          break
        case 'not-allowed':
        case 'service-not-allowed':
          message = 'Microphone access denied. Please allow microphone permissions in your browser.'
          toast.error(message)
          break
        case 'network':
          message = 'Network error occurred with speech recognition.'
          toast.warning(message)
          try { get().stopRecording() } catch { }
          break
        case 'aborted':
          // user-initiated stop; ignore
          return
        default:
          message = `Speech recognition error: ${e.error}`
      }
      set({ errorMessage: message, errorCode: e.error || 'stt-error' })
    }

    recog.onend = () => {
      const current = get()
      console.log('[STT] onend')
      if (!current.isRecording) return

      // Debounce rapid-fire onend
      if (current._restartPending || current._restartTimer) return

      const now = Date.now()
      // Sliding window for failures
      let windowStart = current._restartWindowStart || now
      let failures = current._restartFailures || 0
      if (now - windowStart > 30000) {
        windowStart = now
        failures = 0
      }

      const sinceLast = now - (current._lastRestartAt || 0)
      const sinceHeard = now - (current._lastHeardAt || current._recordingStartedAt || now)
      const minGapMs = 3000
      const doImmediate = sinceLast >= minGapMs

      const tryRestart = () => {
        try {
          set({ _restartPending: true })
          recog.start()
          set({ _restartPending: false, _lastRestartAt: Date.now(), _restartFailures: failures, _restartWindowStart: windowStart, _restartTimer: null })
        } catch (err) {
          console.warn('[STT] auto-restart failed', err)
          failures += 1
          set({ _restartPending: false, _restartFailures: failures, _restartWindowStart: windowStart, _lastRestartAt: Date.now(), _restartTimer: null })
          if (failures >= 8) {
            const msg = 'Speech recognition keeps stopping. Check mic and reload the page.'
            set({ errorMessage: msg, errorCode: 'ended-loop' })
            toast.warning(msg)
            return
          }
          // Backoff retry
          const dynamicBase = sinceHeard < 4000 ? minGapMs : 2000
          const backoffMs = Math.min(6000, dynamicBase + failures * 500)
          const t = setTimeout(() => {
            set({ _restartTimer: null })
            tryRestart()
          }, backoffMs)
          set({ _restartTimer: t })
        }
      }

      if (doImmediate) {
        tryRestart()
      } else {
        const delay = Math.max(1000, minGapMs - sinceLast)
        const t = setTimeout(() => {
          set({ _restartTimer: null })
          tryRestart()
        }, delay)
        set({ _restartTimer: t, _restartPending: true })
      }
    }

    try {
      recog.start()
      set({ recognition: recog })
    } catch (e) {
      console.warn('[STT] start failed', e)
      const msg = 'Failed to start speech recognition.'
      set({ errorMessage: msg, errorCode: 'start-failed' })
      toast.error(msg)
    }

    // Start send + silence check timer (local mode)
    const timer = setInterval(() => {
      const current = get()
      if (!current.isRecording) return

      // 1) Silence/no-text warning after 5s of no partials or finals
      const now = Date.now()
      const lastHeard = current._lastHeardAt || current._recordingStartedAt
      const elapsedMs = now - lastHeard
      if (elapsedMs >= 5000 && !current._silenceWarned) {
        toast.info('No speech detected for 5s. Is your mic muted or too quiet?')
        set({ _silenceWarned: true })
      }

      // 2) Periodic send
      if (!current.isSending) {
        current.sendText()
      }
      set({ nextSendAt: Date.now() + get().chunkIntervalMs })
    }, get().chunkIntervalMs)

    set({ sendTimer: timer })
  },

  stopRecording: () => {
    const store = get()

    if (store.sendTimer) {
      clearInterval(store.sendTimer)
    }

    if (store._restartTimer) {
      try { clearTimeout(store._restartTimer) } catch { }
    }

    if (store.mediaRecorder) {
      try { store.mediaRecorder.stop() } catch { }
    }
    if (store.remoteRotateTimer) {
      try { clearTimeout(store.remoteRotateTimer) } catch { }
    }
    if (store.mediaStream) {
      try { store.mediaStream.getTracks().forEach(t => t.stop()) } catch { }
    }
    get().stopAudioMonitor()

    if (store.recognition) {
      try { store.recognition.stop() } catch { }
    }

    if (store.audioLevelTimer) {
      try { clearInterval(store.audioLevelTimer) } catch { }
    }

    set({
      isRecording: false,
      sendTimer: null,
      recognition: null,
      mediaStream: null,
      mediaRecorder: null,
      nextSendAt: 0,
      audioLevel: 0,
      audioLevelTimer: null,
      textArray: [],
      currentPartial: '',
      _recordingStartedAt: 0,
      _lastHeardAt: 0,
      _silenceWarned: false,
      _restartPending: false,
      _lastRestartAt: 0,
      _restartFailures: 0,
      _restartWindowStart: 0,
      _restartTimer: null
    })
  },

  stopAndFlush: async () => {
    const store = get()
    // Remote mode: just stop recording; nothing to flush client-side
    if (store.recognitionMode === 'remote') {
      get().stopRecording()
      return
    }
    // Stop timers and recognition first (local)
    if (store.sendTimer) {
      clearInterval(store.sendTimer)
    }
    if (store.recognition) {
      try { store.recognition.stop() } catch { }
    }
    // Build final text BEFORE clearing buffers
    const finalText = [
      ...(store.textArray || []),
      (store.currentPartial && store.currentPartial.trim()) ? store.currentPartial.trim() : null
    ].filter(Boolean).join(' ').trim()

    // Set non-text state immediately
    set({ isRecording: false, sendTimer: null, recognition: null })

    if (finalText) {
      try {
        await get().sendText(finalText)
      } catch (e) {
        console.error('[STOP FLUSH] failed:', e)
        const msg = 'Failed to save final transcript.'
        set({ errorMessage: msg, errorCode: 'final-send-failed' })
        toast.error(msg)
      }
    } else {
      // Nothing to send; clear preview buffers
      set({ textArray: [], currentPartial: '' })
    }
  },

  sendText: async (overrideText = null) => {
    if (!overrideText) {
      const s = get()
      if (s.isSending) return
    }
    let textToSend = ''
    if (overrideText != null) {
      textToSend = String(overrideText).trim()
      // Clear preview immediately if we forced a send
      set({ textArray: [], currentPartial: '' })
    } else {
      // Atomically select finalized text to send (and only clear if we actually send)
      const MIN_WORDS = 3
      let didSelect = false
      set((state) => {
        const candidate = (state.textArray || []).join(' ').trim()
        if (!candidate) return {}
        const wordCount = candidate.split(/\s+/).filter(Boolean).length
        if (wordCount < MIN_WORDS) {
          // Not enough to send yet; keep accumulating
          textToSend = ''
          return {}
        }
        textToSend = candidate
        didSelect = true
        return { textArray: [] }
      })
      if (!didSelect) {
        return
      }
    }

    if (!textToSend) {
      return
    }

    console.log('[SEND] sending:', textToSend)

    // preview already cleared atomically above

    try {
      set({ isSending: true })
      const form = new FormData()
      form.append('text', textToSend)
      form.append('mode', 'browser')

      const res = await fetch('/api/transcribe', { method: 'POST', body: form })
      const data = await res.json()

      const finalized = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : textToSend
      if (finalized) {
        const transcript = {
          seq: Date.now(),
          text: finalized,
          timestamp: new Date().toLocaleTimeString()
        }

        set(state => ({
          recentTranscripts: [transcript, ...state.recentTranscripts.slice(0, 9)]
        }))
        // Clear any in-progress partial so the preview disappears
        set({ currentPartial: '' })
      }
    } catch (e) {
      console.error('[SEND] failed:', e)
      const msg = 'Failed to save transcript. Please try again.'
      set({ errorMessage: msg, errorCode: 'send-failed' })
      toast.error(msg)
    } finally {
      set({ isSending: false })
    }
  }
}))
