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

it('焦点留在弹窗内并在关闭后返回触发按钮', async () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(<Modal open title="焦点测试" onClose={() => {}}><button>最后</button></Modal>)
  expect(document.activeElement).toBe(screen.getByRole('dialog'))
  await userEvent.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByText('最后'))
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByLabelText('关闭'))
  view.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})
