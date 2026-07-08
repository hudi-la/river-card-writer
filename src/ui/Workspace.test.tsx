import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Workspace } from './Workspace'
import { useBookStore } from '../state/bookStore'

beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })

describe('Workspace', () => {
  it('显示章列表，点“＋新一章”后多一章', async () => {
    render(<Workspace />)
    expect(screen.getByText('第一章')).toBeTruthy()
    await userEvent.click(screen.getByText('＋ 新一章'))
    expect(useBookStore.getState().book.chapters.length).toBe(2)
  })
})
