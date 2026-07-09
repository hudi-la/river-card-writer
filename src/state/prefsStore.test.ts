import { describe, it, expect, beforeEach } from 'vitest'
import { usePrefsStore } from './prefsStore'

beforeEach(() => {
  localStorage.clear()
  usePrefsStore.getState().__resetForTest()
})

describe('prefsStore', () => {
  it('默认值：serif / 15 / 680', () => {
    const s = usePrefsStore.getState()
    expect(s.prefs).toEqual({ font: 'serif', size: 15, measure: 680 })
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
