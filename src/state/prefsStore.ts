import { create } from 'zustand'

const KEY = 'card-writer:prefs'

export type Font = 'serif' | 'sans'
export type OutlineView = 'brief' | 'detail'
// 阅读模式的版式：book = 小开本单栏书页，paper = 论文式双栏
export type Layout = 'book' | 'paper'
// 阅读模式读哪一种文字：中文 / 英文 / 中英对照
export type ReadLang = 'zh' | 'en' | 'both'
export type Prefs = { font: Font; size: number; measure: number; outlineView: OutlineView; railWidth: number; layout: Layout; readLang: ReadLang }

const DEFAULT_PREFS: Prefs = { font: 'serif', size: 15, measure: 680, outlineView: 'brief', railWidth: 172, layout: 'book', readLang: 'zh' }

export const RAIL_WIDTH_MIN = 150
export const RAIL_WIDTH_MAX = 520

export function clampRailWidth(px: number): number {
  return Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, px))
}

type PrefsState = {
  prefs: Prefs
  setFont: (font: Font) => void
  setSize: (size: number) => void
  setMeasure: (measure: number) => void
  setOutlineView: (view: OutlineView) => void
  setRailWidth: (px: number) => void
  setLayout: (layout: Layout) => void
  setReadLang: (readLang: ReadLang) => void
  __resetForTest: () => void
}

export function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && (p.font === 'serif' || p.font === 'sans') && typeof p.size === 'number' && typeof p.measure === 'number') {
        // outlineView / railWidth / layout / readLang 是后加的字段——老的持久化数据里没有，缺省/非法值都落回默认。
        const outlineView: OutlineView = p.outlineView === 'detail' ? 'detail' : 'brief'
        const railWidth = typeof p.railWidth === 'number' ? clampRailWidth(p.railWidth) : DEFAULT_PREFS.railWidth
        const layout: Layout = p.layout === 'paper' ? 'paper' : 'book'
        const readLang: ReadLang = p.readLang === 'en' || p.readLang === 'both' ? p.readLang : 'zh'
        return { font: p.font, size: p.size, measure: p.measure, outlineView, railWidth, layout, readLang }
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
  setOutlineView: (outlineView) => {
    const prefs = { ...get().prefs, outlineView }
    persist(prefs)
    set({ prefs })
  },
  setRailWidth: (px) => {
    const prefs = { ...get().prefs, railWidth: clampRailWidth(px) }
    persist(prefs)
    set({ prefs })
  },
  setLayout: (layout) => {
    const prefs = { ...get().prefs, layout }
    persist(prefs)
    set({ prefs })
  },
  setReadLang: (readLang) => {
    const prefs = { ...get().prefs, readLang }
    persist(prefs)
    set({ prefs })
  },
  __resetForTest: () => {
    const prefs = { ...DEFAULT_PREFS }
    persist(prefs)
    set({ prefs })
  },
}))
