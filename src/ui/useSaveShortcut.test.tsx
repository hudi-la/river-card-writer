import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { isSaveShortcut, triggerSave, useSaveShortcut } from './useSaveShortcut'
import { useBookStore, EMPTY_DOC } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { useToastStore } from '../state/toastStore'
import * as snapshotsModule from '../state/snapshots'
import type { SyncSupabaseClient } from '../state/sync'
import type { Library } from '../state/bookStore'

const AUTH_ORIGINAL = useAuthStore.getState()
const BOOK_ORIGINAL = useBookStore.getState()

function makeLibrary(): Library {
  return {
    books: [{ id: 'uuid-a', title: '书', doc: structuredClone(EMPTY_DOC), boxes: [] }],
    activeBookId: 'uuid-a',
    universalBoxes: [],
  }
}

function makeMockClient(overrides: { upsertError?: string } = {}) {
  const upsertMock = vi.fn().mockResolvedValue({ error: overrides.upsertError ? { message: overrides.upsertError } : null })
  const client: SyncSupabaseClient = {
    from: vi.fn(() => ({ select: vi.fn(), upsert: upsertMock, delete: () => ({ eq: vi.fn() }) })),
  }
  return { client, upsertMock }
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState(AUTH_ORIGINAL, true)
  useBookStore.setState({ ...BOOK_ORIGINAL, library: makeLibrary() }, true)
  useToastStore.getState().__resetForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isSaveShortcut', () => {
  it('Cmd+S（metaKey）→ true', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true }))).toBe(true)
  })
  it('Ctrl+S（ctrlKey）→ true', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))).toBe(true)
  })
  it('大写 S 也命中（key 不区分大小写判断）', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 'S', metaKey: true }))).toBe(true)
  })
  it('普通的 s（无修饰键）→ false', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's' }))).toBe(false)
  })
  it('Cmd+Alt+S（带 altKey）→ false，避免跟别的组合键冲突', () => {
    expect(isSaveShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true, altKey: true }))).toBe(false)
  })
})

describe('triggerSave（决策 + toast 落地）', () => {
  it('云未配置（cloudEnabled=false）→ 本地快照 + "云同步未配置" toast，不带登录动作', async () => {
    const spy = vi.spyOn(snapshotsModule, 'pushSnapshot')
    await triggerSave({ cloudEnabled: false, client: null })
    expect(spy).toHaveBeenCalled()
    expect(useToastStore.getState().toast?.text).toContain('云同步未配置')
    expect(useToastStore.getState().toast?.action).toBeUndefined()
  })

  it('已配置云但未登录 → "未登录，不会上云" toast，带"点此登录"动作；点击后调用 authStore.requestSignIn', async () => {
    useAuthStore.setState({ status: 'signed-out', session: null })
    await triggerSave({ cloudEnabled: true, client: makeMockClient().client })

    const toast = useToastStore.getState().toast
    expect(toast?.text).toContain('未登录')
    expect(toast?.text).toContain('不会上云')
    expect(toast?.action?.label).toBe('点此登录')

    const requestSignIn = vi.fn()
    useAuthStore.setState({ requestSignIn })
    toast!.action!.onClick()
    expect(requestSignIn).toHaveBeenCalled()
  })

  it('已登录 → 强制上传全部书+通用盒子，成功后显示"已保存到云端"toast（带时间）', async () => {
    useAuthStore.setState({ status: 'signed-in', session: { user: { id: 'user-1' } } as any })
    const { client, upsertMock } = makeMockClient()

    await triggerSave({ cloudEnabled: true, client })

    expect(upsertMock).toHaveBeenCalled()
    const toast = useToastStore.getState().toast
    expect(toast?.kind).toBe('success')
    expect(toast?.text).toContain('已保存到云端')
    expect(toast?.text).toMatch(/\d{2}:\d{2}/)
  })

  it('已登录但云端写入失败 → "保存失败：<原因>" 错误 toast', async () => {
    useAuthStore.setState({ status: 'signed-in', session: { user: { id: 'user-1' } } as any })
    const { client } = makeMockClient({ upsertError: '网络异常' })

    await triggerSave({ cloudEnabled: true, client })

    const toast = useToastStore.getState().toast
    expect(toast?.kind).toBe('error')
    expect(toast?.text).toBe('保存失败：网络异常')
  })
})

describe('useSaveShortcut（挂载后监听全局 keydown）', () => {
  function Mount() {
    useSaveShortcut()
    return null
  }

  it('Cmd+S 触发 → preventDefault 拦掉浏览器保存对话框', () => {
    render(<Mount />)
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Ctrl+S 触发 → preventDefault 拦掉浏览器保存对话框', () => {
    render(<Mount />)
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('普通的 s（无修饰键）→ 不 preventDefault，不产生 toast', () => {
    render(<Mount />)
    const event = new KeyboardEvent('keydown', { key: 's', cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(useToastStore.getState().toast).toBe(null)
  })

  it('默认（未登录）状态下 Cmd+S → 最终落到本地专属 toast，且推了一份本地快照', async () => {
    const spy = vi.spyOn(snapshotsModule, 'pushSnapshot')
    useAuthStore.setState({ status: 'signed-out', session: null })
    render(<Mount />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }))
    // triggerSave 内部是 async；handler 用 void triggerSave() 触发，等待微任务队列排空。
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(spy).toHaveBeenCalled()
    const toast = useToastStore.getState().toast
    expect(toast).not.toBe(null)
    expect(toast?.text).not.toContain('已保存到云端')
  })

  it('卸载后 Cmd+S 不再触发（事件监听已清理）', () => {
    const { unmount } = render(<Mount />)
    unmount()
    useToastStore.getState().__resetForTest()
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
