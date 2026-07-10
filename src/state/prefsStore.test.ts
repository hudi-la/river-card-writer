import { describe, it, expect, beforeEach } from 'vitest'
import { usePrefsStore, load } from './prefsStore'

beforeEach(() => {
  localStorage.clear()
  usePrefsStore.getState().__resetForTest()
})

describe('prefsStore', () => {
  it('默认值：serif / 15 / 680 / brief', () => {
    const s = usePrefsStore.getState()
    expect(s.prefs).toEqual({ font: 'serif', size: 15, measure: 680, outlineView: 'brief' })
  })

  it('setOutlineView 改并持久化到 card-writer:prefs', () => {
    usePrefsStore.getState().setOutlineView('detail')
    expect(usePrefsStore.getState().prefs.outlineView).toBe('detail')
    const raw = JSON.parse(localStorage.getItem('card-writer:prefs')!)
    expect(raw.outlineView).toBe('detail')
  })

  it('老的持久化数据没有 outlineView 字段时，load() 缺省回 brief', () => {
    localStorage.setItem('card-writer:prefs', JSON.stringify({ font: 'sans', size: 16, measure: 700 }))
    expect(load().outlineView).toBe('brief')
  })

  it('setFont 改并持久化到 card-writer:prefs', () => {
    usePrefsStore.getState().setFont('sans')
    expect(usePrefsStore.getState().prefs.font).toBe('sans')
    const raw = JSON.parse(localStorage.getItem('card-writer:prefs')!)
    expect(raw.font).toBe('sans')
  })

  it('setSize 改并持久化到 card-writer:prefs', () => {
    usePrefsStore.getState().setSize(18)
    expect(usePrefsStore.getState().prefs.size).toBe(18)
    const raw = JSON.parse(localStorage.getItem('card-writer:prefs')!)
    expect(raw.size).toBe(18)
  })

  it('setMeasure 改并持久化到 card-writer:prefs', () => {
    usePrefsStore.getState().setMeasure(720)
    expect(usePrefsStore.getState().prefs.measure).toBe(720)
    const raw = JSON.parse(localStorage.getItem('card-writer:prefs')!)
    expect(raw.measure).toBe(720)
  })
})
