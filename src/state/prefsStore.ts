import { create } from 'zustand'

const KEY = 'card-writer:prefs'

export type Font = 'serif' | 'sans'
export type Prefs = { font: Font; size: number; measure: number }

const DEFAULT_PREFS: Prefs = { font: 'serif', size: 15, measure: 680 }

type PrefsState = {
  prefs: Prefs
  setFont: (font: Font) => void
  setSize: (size: number) => void
  setMeasure: (measure: number) => void
  __resetForTest: () => void
}

export function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && (p.font === 'serif' || p.font === 'sans') && typeof p.size === 'number' && typeof p.measure === 'number') {
        return p
      }
    }
  } catch {}
  return { ...DEFAULT_PREFS }
}

function persist(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch (e) {
    console.warn('persist failed', e)
  }
}

export const usePrefsStore = create<PrefsState>((set, get) => ({
  prefs: load(),
  setFont: (font) => {
    const prefs = { ...get().prefs, font }
    persist(prefs)
    set({ prefs })
  },
  setSize: (size) => {
    const prefs = { ...get().prefs, size }
    persist(prefs)
    set({ prefs })
  },
  setMeasure: (measure) => {
    const prefs = { ...get().prefs, measure }
    persist(prefs)
    set({ prefs })
  },
  __resetForTest: () => {
    const prefs = { ...DEFAULT_PREFS }
    persist(prefs)
    set({ prefs })
  },
}))
