import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performSave } from './save'
import * as snapshots from './snapshots'
import { EMPTY_DOC } from './bookStore'
import type { Book, Library } from './bookStore'
import type { SyncSupabaseClient } from './sync'

function makeBook(id: string, title = '书'): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [] }
}

function makeLibrary(books: Book[] = [makeBook('uuid-a')]): Library {
  return { books, activeBookId: books[0]?.id ?? null, universalBoxes: [] }
}

function makeMockClient(overrides: { upsertError?: string; upsertThrows?: boolean } = {}) {
  const upsertMock = vi.fn().mockImplementation(async () => {
    if (overrides.upsertThrows) throw new Error('network down')
    if (overrides.upsertError) return { error: { message: overrides.upsertError } }
    return { error: null }
  })
  const client: SyncSupabaseClient = {
    from: vi.fn(() => ({ select: vi.fn(), upsert: upsertMock, delete: () => ({ eq: vi.fn() }) })),
  }
  return { client, upsertMock }
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('performSave（Cmd+S 决策核心：始终先落本地快照，再按登录状态决定是否强推云端）', () => {
  it('任何情况下都先 pushSnapshot 一次本地快照', async () => {
    const spy = vi.spyOn(snapshots, 'pushSnapshot')
    const library = makeLibrary()
    await performSave({ library, cloudEnabled: false, signedIn: false, ownerId: undefined, client: null })
    expect(spy).toHaveBeenCalledWith(library)
  })

  it('云同步未配置（cloudEnabled=false）→ local-only，reason=cloud-disabled，不碰 client', async () => {
    const library = makeLibrary()
    const outcome = await performSave({ library, cloudEnabled: false, signedIn: false, ownerId: undefined, client: null })
    expect(outcome).toEqual({ kind: 'local-only', reason: 'cloud-disabled' })
  })

  it('云同步已配置但未登录（signedIn=false）→ local-only，reason=not-signed-in，不调用 client', async () => {
    const { client, upsertMock } = makeMockClient()
    const library = makeLibrary()
    const outcome = await performSave({ library, cloudEnabled: true, signedIn: false, ownerId: undefined, client })
    expect(outcome).toEqual({ kind: 'local-only', reason: 'not-signed-in' })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('signedIn=true 但 ownerId 缺失（异常态防御）→ 仍然 local-only/not-signed-in，不崩', async () => {
    const { client, upsertMock } = makeMockClient()
    const library = makeLibrary()
    const outcome = await performSave({ library, cloudEnabled: true, signedIn: true, ownerId: undefined, client })
    expect(outcome).toEqual({ kind: 'local-only', reason: 'not-signed-in' })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('已登录 → 强制上传全部书 + 通用盒子，成功后返回 cloud-success', async () => {
    const { client, upsertMock } = makeMockClient()
    const library = makeLibrary([makeBook('uuid-a', 'A'), makeBook('uuid-b', 'B')])
    const outcome = await performSave({ library, cloudEnabled: true, signedIn: true, ownerId: 'owner-1', client })
    expect(outcome).toEqual({ kind: 'cloud-success' })
    expect(upsertMock).toHaveBeenCalled()
  })

  it('已登录但云端 upsert 报错 → 返回 cloud-error 并带上原因', async () => {
    const { client } = makeMockClient({ upsertError: '写入失败' })
    const library = makeLibrary()
    const outcome = await performSave({ library, cloudEnabled: true, signedIn: true, ownerId: 'owner-1', client })
    expect(outcome).toEqual({ kind: 'cloud-error', error: '写入失败' })
  })

  it('已登录但 client 抛异常 → 捕获住，返回 cloud-error，绝不向外抛出', async () => {
    const { client } = makeMockClient({ upsertThrows: true })
    const library = makeLibrary()
    await expect(performSave({ library, cloudEnabled: true, signedIn: true, ownerId: 'owner-1', client })).resolves.toEqual({
      kind: 'cloud-error',
      error: 'network down',
    })
  })

  it('pushSnapshot 本身抛异常也不会让 performSave 抛出（双保险生效）', async () => {
    vi.spyOn(snapshots, 'pushSnapshot').mockImplementation(() => {
      throw new Error('snapshot boom')
    })
    const library = makeLibrary()
    await expect(
      performSave({ library, cloudEnabled: false, signedIn: false, ownerId: undefined, client: null })
    ).resolves.toEqual({ kind: 'local-only', reason: 'cloud-disabled' })
  })
})
