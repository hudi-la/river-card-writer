import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SaveStatus } from './SaveStatus'
import { useSaveStatus } from '../state/saveStatus'
afterEach(() => { cleanup(); useSaveStatus.setState({ cloud: 'idle', localError: '', cloudError: '', retry: null }) })
it('keeps a cloud failure visible with retry and backup controls', () => {
  const retry = vi.fn().mockResolvedValue({ ok: true })
  useSaveStatus.setState({ cloud: 'error', cloudError: 'offline', retry })
  render(<SaveStatus />)
  expect(screen.getByRole('alert').textContent).toContain('尚未同步')
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '导出备份' })).toBeTruthy()
})
it('does not hide local disk failure behind cloud success', () => {
  useSaveStatus.setState({ cloud: 'saved', localError: '浏览器未能保存稿件' })
  render(<SaveStatus />)
  expect(screen.getByRole('alert').textContent).toContain('浏览器未能保存')
  expect(screen.queryByText('已同步到云端')).toBeNull()
})
