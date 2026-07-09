import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadingSettings } from './ReadingSettings'
import { usePrefsStore } from '../state/prefsStore'

beforeEach(() => {
  localStorage.clear()
  usePrefsStore.getState().__resetForTest()
})

describe('ReadingSettings', () => {
  it('点齿轮打开面板，点"无衬线"切换 prefs.font', async () => {
    render(<ReadingSettings />)
    await userEvent.click(screen.getByTitle('阅读设置'))
    await userEvent.click(screen.getByText('无衬线'))
    expect(usePrefsStore.getState().prefs.font).toBe('sans')
  })

  it('拖字号 slider 更新 prefs.size', async () => {
    render(<ReadingSettings />)
    await userEvent.click(screen.getByTitle('阅读设置'))
    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '18' } })
    expect(usePrefsStore.getState().prefs.size).toBe(18)
  })

  it('拖行宽 slider 更新 prefs.measure', async () => {
    render(<ReadingSettings />)
    await userEvent.click(screen.getByTitle('阅读设置'))
    fireEvent.change(screen.getByLabelText('行宽'), { target: { value: '720' } })
    expect(usePrefsStore.getState().prefs.measure).toBe(720)
  })
})
