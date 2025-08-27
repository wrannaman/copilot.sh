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

  // Actions
  startRecording: () => {
    const store = get()
    if (store.isRecording) return

    set({ isRecording: true, textArray: [], currentPartial: '', recentTranscripts: [], errorMessage: '', errorCode: null, _recordingStartedAt: Date.now(), _lastHeardAt: 0, _silenceWarned: false, _restartPending: false, _lastRestartAt: 0, _restartFailures: 0, _restartWindowStart: Date.now(), _restartTimer: null })

    // Start STT
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
          set({ currentPartial: partial, _lastHeardAt: partial ? Date.now() : get()._lastHeardAt })
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

    // Start send + silence check timer
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
    }, 5000)

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

    if (store.recognition) {
      try { store.recognition.stop() } catch { }
    }

    set({
      isRecording: false,
      sendTimer: null,
      recognition: null,
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
    // Stop timers and recognition first
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
