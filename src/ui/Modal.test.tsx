import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

describe('Modal', () => {
  it('open=false 时不渲染任何内容', () => {
    render(
      <Modal open={false} title="标题" onClose={() => {}}>
        <p>内容</p>
      </Modal>,
    )
    expect(screen.queryByText('标题')).toBeNull()
    expect(screen.queryByText('内容')).toBeNull()
  })

  it('open=true 时渲染标题和 children', () => {
    render(
      <Modal open title="我的标题" onClose={() => {}}>
        <p>我的内容</p>
      </Modal>,
    )
    expect(screen.getByText('我的标题')).toBeTruthy()
    expect(screen.getByText('我的内容')).toBeTruthy()
  })

  it('按 Esc 调用 onClose', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="标题" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点遮罩（面板外）调用 onClose', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="标题" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    )
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement
    await userEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点面板内部不调用 onClose（不冒泡到遮罩）', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="标题" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    )
    await userEvent.click(screen.getByText('内容'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('点关闭按钮调用 onClose', async () => {
    const onClose = vi.fn()
    render(
      <Modal open title="标题" onClose={onClose}>
        <p>内容</p>
      </Modal>,
    )
    await userEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
