import { describe, it, expect, beforeEach } from 'vitest'
import { usePrefsStore, load, clampRailWidth, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX } from './prefsStore'

beforeEach(() => {
  localStorage.clear()
  usePrefsStore.getState().__resetForTest()
})

describe('prefsStore', () => {
  it('默认值：serif / 15 / 680 / brief / 172', () => {
    const s = usePrefsStore.getState()
    expect(s.prefs).toEqual({ font: 'serif', size: 15, measure: 680, outlineView: 'brief', railWidth: 172 })
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

  it('setRailWidth 改并持久化到 card-writer:prefs', () => {
    usePrefsStore.getState().setRailWidth(260)
    expect(usePrefsStore.getState().prefs.railWidth).toBe(260)
    const raw = JSON.parse(localStorage.getItem('card-writer:prefs')!)
    expect(raw.railWidth).toBe(260)
  })

  it('setRailWidth 夹在 [150, 520] 区间内', () => {
    usePrefsStore.getState().setRailWidth(10)
    expect(usePrefsStore.getState().prefs.railWidth).toBe(RAIL_WIDTH_MIN)
    usePrefsStore.getState().setRailWidth(9999)
    expect(usePrefsStore.getState().prefs.railWidth).toBe(RAIL_WIDTH_MAX)
  })

  it('clampRailWidth 是纯函数，直接夹值', () => {
    expect(clampRailWidth(100)).toBe(150)
    expect(clampRailWidth(300)).toBe(300)
    expect(clampRailWidth(600)).toBe(520)
  })

  it('老的持久化数据没有 railWidth 字段时，load() 缺省回 172', () => {
    localStorage.setItem('card-writer:prefs', JSON.stringify({ font: 'sans', size: 16, measure: 700 }))
    expect(load().railWidth).toBe(172)
  })

  it('持久化数据里 railWidth 越界时，load() 夹回合法区间', () => {
    localStorage.setItem('card-writer:prefs', JSON.stringify({ font: 'sans', size: 16, measure: 700, railWidth: 5 }))
    expect(load().railWidth).toBe(RAIL_WIDTH_MIN)
  })
})
