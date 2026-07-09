import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignIn } from './SignIn'
import { useAuthStore } from '../state/authStore'

const ORIGINAL_STATE = useAuthStore.getState()

beforeEach(() => {
  useAuthStore.setState(ORIGINAL_STATE, true)
})

describe('SignIn', () => {
  it('输入邮箱点"发送登录链接" → 调 signInWithEmail，成功后显示查收邮箱提示', async () => {
    const signInWithEmail = vi.fn().mockResolvedValue({ sent: true })
    useAuthStore.setState({ signInWithEmail })
    render(<SignIn />)

    await userEvent.type(screen.getByPlaceholderText(/example\.com/i), 'reader@example.com')
    await userEvent.click(screen.getByText('发送登录链接'))

    expect(signInWithEmail).toHaveBeenCalledWith('reader@example.com')
    expect(await screen.findByText(/查收邮箱|登录链接/)).toBeTruthy()
  })

  it('signInWithEmail 失败 → 显示错误信息，不进入查收态', async () => {
    const signInWithEmail = vi.fn().mockResolvedValue({ sent: false, error: '发送失败' })
    useAuthStore.setState({ signInWithEmail })
    render(<SignIn />)

    await userEvent.type(screen.getByPlaceholderText(/example\.com/i), 'reader@example.com')
    await userEvent.click(screen.getByText('发送登录链接'))

    expect(await screen.findByText('发送失败')).toBeTruthy()
    expect(screen.getByText('发送登录链接')).toBeTruthy()
  })

  it('点"先本地用（不登录）" → 调用 continueLocalOnly', async () => {
    const continueLocalOnly = vi.fn()
    useAuthStore.setState({ continueLocalOnly })
    render(<SignIn />)

    await userEvent.click(screen.getByText('先本地用（不登录）'))
    expect(continueLocalOnly).toHaveBeenCalled()
  })
})
