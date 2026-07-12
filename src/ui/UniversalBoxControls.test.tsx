import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UniversalBoxControls } from './UniversalBoxControls'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { exportUniversalBox } from '../state/backup'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  // jsdom 没实现 URL.createObjectURL/revokeObjectURL，导出流程要用到，先垫一个假的。
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

function cardJSON(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('UniversalBoxControls', () => {
  it('渲染导出/导入两个按钮', () => {
    render(<UniversalBoxControls />)
    expect(screen.getByText('⬇ 导出')).toBeTruthy()
    expect(screen.getByText('⬆ 导入')).toBeTruthy()
  })

  it('点导出：创建 blob URL、触发一次下载，并给出成功提示', async () => {
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON('u1', '甲'))
    render(<UniversalBoxControls />)
    await userEvent.click(screen.getByText('⬇ 导出'))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已导出 1 张卡/)).toBeTruthy()
  })

  it('导入一份合法的通用盒子备份：非破坏性地合并进现有通用盒子', async () => {
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON('kept', '已有的'))
    const backupJson = exportUniversalBox({ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardJSON('new1', '导入的')] }, '2026-07-10T00:00:00.000Z')
    const file = new File([backupJson], 'universal.json', { type: 'application/json' })

    render(<UniversalBoxControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 1 张卡/)).toBeTruthy())
    const cards = useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!.cards
    expect(cards).toHaveLength(2)
    expect(cards.some((c) => c.attrs.cardId === 'kept')).toBe(true)
    expect(cards.some((c) => c.attrs.cardId === 'new1')).toBe(true)
  })

  it('重复导入同一份文件：不堆出重复卡', async () => {
    const backupJson = exportUniversalBox({ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardJSON('once', '一次')] }, '2026-07-10T00:00:00.000Z')
    render(<UniversalBoxControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement

    await userEvent.upload(input, new File([backupJson], 'universal.json', { type: 'application/json' }))
    await waitFor(() => expect(screen.getByText(/导入了 1 张卡/)).toBeTruthy())
    await userEvent.upload(input, new File([backupJson], 'universal.json', { type: 'application/json' }))
    await waitFor(() => expect(screen.getByText(/导入了 1 张卡/)).toBeTruthy())

    expect(useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!.cards).toHaveLength(1)
  })

  it('导入损坏的文件：不改动通用盒子，显示错误提示', async () => {
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON('kept', '已有的'))
    const file = new File(['not json {{{'], 'broken.json', { type: 'application/json' })

    render(<UniversalBoxControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入失败/)).toBeTruthy())
    const cards = useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0].attrs.cardId).toBe('kept')
  })
})
