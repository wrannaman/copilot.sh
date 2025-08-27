import { create } from 'zustand'

export const useTranscriptionStore = create((set, get) => ({
  // State
  isRecording: false,
  textArray: [],
  currentPartial: '',
  recentTranscripts: [],

  // Timers
  sendTimer: null,
  recognition: null,

  // Actions
  startRecording: () => {
    const store = get()
    if (store.isRecording) return

    set({ isRecording: true, textArray: [], currentPartial: '', recentTranscripts: [] })

    // Start STT
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    const recog = new SR()
    recog.lang = 'en-US'
    recog.continuous = true
    recog.interimResults = true

    recog.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]
        if (res.isFinal) {
          const text = res[0]?.transcript?.trim()
          if (text) {
            console.log('[STT] final:', text)
            set(state => ({
              textArray: [...state.textArray, text],
              currentPartial: ''
            }))
          }
        } else {
          const partial = res[0]?.transcript?.trim() || ""
          set({ currentPartial: partial })
        }
      }
    }

    recog.onerror = (e) => {
      console.warn('[STT] error:', e.error)
    }

    recog.onend = () => {
      console.log('[STT] onend')
    }

    try {
      recog.start()
      set({ recognition: recog })
    } catch (e) {
      console.warn('[STT] start failed', e)
    }

    // Start send timer
    const timer = setInterval(() => {
      const current = get()
      if (!current.isRecording) return
      current.sendText()
    }, 10000)

    set({ sendTimer: timer })
  },

  stopRecording: () => {
    const store = get()

    if (store.sendTimer) {
      clearInterval(store.sendTimer)
    }

    if (store.recognition) {
      try { store.recognition.stop() } catch { }
    }

    set({
      isRecording: false,
      sendTimer: null,
      recognition: null
    })
  },

  sendText: async () => {
    const store = get()
    const textToSend = store.textArray.join(' ').trim()

    if (!textToSend) {
      console.log('[SEND] no text')
      return
    }

    console.log('[SEND] sending:', textToSend)

    // Clear array immediately
    set({ textArray: [] })

    try {
      const form = new FormData()
      form.append('text', textToSend)
      form.append('mode', 'browser')

      const res = await fetch('/api/transcribe', { method: 'POST', body: form })
      const data = await res.json()

      if (data.text?.trim()) {
        const transcript = {
          seq: Date.now(),
          text: data.text.trim(),
          timestamp: new Date().toLocaleTimeString()
        }

        set(state => ({
          recentTranscripts: [transcript, ...state.recentTranscripts.slice(0, 9)]
        }))
      }
    } catch (e) {
      console.error('[SEND] failed:', e)
    }
  }
}))
