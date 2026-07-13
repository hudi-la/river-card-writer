import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiverEditor, findCardInDoc } from './RiverEditor'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

describe('RiverEditor', () => {
  it('把 book.doc 渲染成带 data-card-id 的 section，不再需要 chapterId prop', async () => {
    useBookStore.getState().updateDoc({
      type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] },
      ],
    })
    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')).toBeTruthy()
    expect(container.textContent).toContain('你好')
  })

  it('底部"＋ 加一张卡"按钮把新卡加进 book.doc（单文档，不再挂在某一章下）', async () => {
    useBookStore.getState().updateDoc({ type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    ] })
    const { getByText } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(getByText('加一张卡'))
    await new Promise((r) => setTimeout(r, 0))
    const cards = (useBookStore.getState().activeBook()!.doc as any).content
    expect(cards.length).toBe(2)
  })
})

describe('拖拽收尾对 WebKit pointer-capture 重定向的健壮性', () => {
  // 背景：真机 Safari 上，把手拖到盒子行时高亮正常（pointermove 走 window，没受影响），
  // 但松手后卡既不进盒子也不重排——因为 pointerdown 里 setPointerCapture 之后，
  // WebKit 有些版本会把 pointerup 完全重定向到被 capture 的元素、不再冒泡到 window，
  // 而收尾逻辑当时只挂在 window 上。
  //
  // jsdom 没有实现 elementFromPoint/真实布局，没法端到端模拟"松手时鼠标恰好在某一帧
  // 精确落在盒子行上"，所以这里把 document.elementFromPoint 打桩成固定返回目标盒子
  // 元素（等价于 CardToBox.test.tsx 里说的：直接验证命中盒子分支实际会跑的原语组合，
  // 而不是重新发明 jsdom 里没有的布局引擎)。重点验证的是收尾监听器的注册面：只朝
  // 编辑器 DOM（不冒泡到 window）派发 pointercancel/lostpointercapture，落定逻辑
  // 依然要跑起来——这正是 WebKit 场景的最小复现，也是本次修复要保证的行为。
  it('只有编辑器 DOM 收到 pointercancel（不经过 window）时，仍然把卡 park 进悬停中的盒子', async () => {
    const box = useBookStore.getState().addBox('测试盒')!
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    })

    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))

    const dom = container.querySelector('.river') as HTMLElement
    const card = container.querySelector<HTMLElement>('.card[data-card-id="c0"]')!

    // 伪造一个悬停命中的盒子行，挂到 body 上——boxElAt 只关心 elementFromPoint 的
    // 返回值上有没有 [data-box-id]，不关心它是不是真实的 BoxView。
    const fakeBoxRow = document.createElement('div')
    fakeBoxRow.dataset.boxId = box.id
    document.body.appendChild(fakeBoxRow)
    const originalElementFromPoint = document.elementFromPoint?.bind(document)
    // @ts-expect-error jsdom 没有实现这个 API，测试里按需打桩
    document.elementFromPoint = () => fakeBoxRow

    try {
      // handle 命中区判定用 e.clientX - rect.left，jsdom 里卡片的 rect 全是 0，
      // 所以任何 <= HANDLE_ZONE_PX 的 clientX 都落在把手区间内。
      card.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, pointerId: 7, button: 0, bubbles: true }))
      // 越过 DRAG_MOVE_THRESHOLD_PX，同时落到（打桩后）盒子行上方，触发高亮。
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 60, pointerId: 7, bubbles: true }))

      expect(fakeBoxRow.classList.contains('drop-target')).toBe(true) // 悬停高亮：这部分本来就没坏

      // 关键一步：只朝编辑器 DOM 派发 pointercancel，完全不碰 window——
      // 模拟 WebKit 下 pointerup 被 pointer-capture 重定向、不再冒泡到 window 的场景。
      dom.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, bubbles: true }))
    } finally {
      if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
      else delete (document as any).elementFromPoint
      fakeBoxRow.remove()
    }

    await new Promise((r) => setTimeout(r, 0))

    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.cardId).toBe('c0')
    expect((useBookStore.getState().activeBook()!.doc as any).content.length).toBe(1)
  })

  it('同一次拖拽被多个收尾事件重复触发时只 park 一次（dragRef 幂等闸门）', async () => {
    const box = useBookStore.getState().addBox('测试盒')!
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    })

    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))

    const dom = container.querySelector('.river') as HTMLElement
    const card = container.querySelector<HTMLElement>('.card[data-card-id="c0"]')!

    const fakeBoxRow = document.createElement('div')
    fakeBoxRow.dataset.boxId = box.id
    document.body.appendChild(fakeBoxRow)
    const originalElementFromPoint = document.elementFromPoint?.bind(document)
    // @ts-expect-error jsdom 没有实现这个 API，测试里按需打桩
    document.elementFromPoint = () => fakeBoxRow

    try {
      card.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, pointerId: 9, button: 0, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 60, pointerId: 9, bubbles: true }))

      // 三个收尾事件全都派发一遍（包括冒泡到 window 的），模拟"两套监听器都收到了
      // 事件"的情况——不应该 park 两次。
      dom.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 9, bubbles: true }))
      dom.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 9, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 60, pointerId: 9, bubbles: true }))
    } finally {
      if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
      else delete (document as any).elementFromPoint
      fakeBoxRow.remove()
    }

    await new Promise((r) => setTimeout(r, 0))

    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1) // 不是 2 或 3——只 park 了一次
  })
})

describe('拖拽悬停目标的 sticky 行为（真实鼠标最后一帧偏出盒子行时仍要 park）', () => {
  // 背景：盒子行又矮又挨在一起（.chap 之间没有间距）。真实鼠标松手前最后一次
  // pointermove，很容易落在刚刚悬停的那一行外面几像素——落到相邻的非盒子行上
  // （比如"+ 新盒子"），但仍然明显还在左栏（.rail）范围内。旧逻辑只要这一帧
  // elementFromPoint 没有命中 [data-box-id] 就立刻清空 targetBoxId/高亮，于是
  // pointerup 时读到的目标是 null，掉回"重排"分支——卡没有 park，即便几帧之前
  // 明明高亮显示过悬停在盒子上。
  //
  // jsdom 没有真实布局/elementFromPoint，这里跟 CardToBox.test.tsx／上面两个
  // WebKit 回归测试一样的手法：把 document.elementFromPoint 打桩成按顺序返回
  // 「命中盒子」→「命中盒子外、但仍在 .rail 内的一个元素」，直接验证状态机在
  // 这两帧之间的行为，而不是重新发明 jsdom 里没有的布局引擎。
  it('pointermove 命中盒子后，下一帧落在盒子外但仍在 .rail 内——目标和高亮保持不变，松手仍然 park', async () => {
    const box = useBookStore.getState().addBox('测试盒')!
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    })

    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))

    const dom = container.querySelector('.river') as HTMLElement
    const card = container.querySelector<HTMLElement>('.card[data-card-id="c0"]')!

    // 伪造左栏容器 + 盒子行 + 盒子行旁边一个非盒子的兄弟元素（模拟"+ 新盒子"
    // 那样的行），三者都挂在同一个 .rail 容器下，跟真实 DOM 结构一致。
    const fakeRail = document.createElement('nav')
    fakeRail.className = 'rail'
    const fakeBoxRow = document.createElement('div')
    fakeBoxRow.dataset.boxId = box.id
    const fakeAddRow = document.createElement('div')
    fakeAddRow.className = 'add'
    fakeRail.appendChild(fakeBoxRow)
    fakeRail.appendChild(fakeAddRow)
    document.body.appendChild(fakeRail)

    const originalElementFromPoint = document.elementFromPoint?.bind(document)
    let hoverOffRow = false
    // @ts-expect-error jsdom 没有实现这个 API，测试里按需打桩
    document.elementFromPoint = () => (hoverOffRow ? fakeAddRow : fakeBoxRow)

    try {
      card.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, pointerId: 11, button: 0, bubbles: true }))
      // 第一帧：命中盒子行，越过 DRAG_MOVE_THRESHOLD_PX，触发高亮。
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 60, pointerId: 11, bubbles: true }))
      expect(fakeBoxRow.classList.contains('drop-target')).toBe(true)

      // 第二帧（也是松手前最后一帧）：指针"偏"到了盒子行外面、落在同一个 .rail
      // 里的另一个元素上——这正是真实鼠标松手前最后一次 move 最容易出现的情况。
      hoverOffRow = true
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 62, pointerId: 11, bubbles: true }))

      // sticky：高亮和跟踪的目标都不应该被这一帧清掉。
      expect(fakeBoxRow.classList.contains('drop-target')).toBe(true)

      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 62, pointerId: 11, bubbles: true }))
    } finally {
      if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
      else delete (document as any).elementFromPoint
      fakeRail.remove()
    }

    await new Promise((r) => setTimeout(r, 0))

    // park 而不是重排：卡从正文移进了盒子。
    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.cardId).toBe('c0')
    expect((useBookStore.getState().activeBook()!.doc as any).content.length).toBe(1)
    expect((useBookStore.getState().activeBook()!.doc as any).content[0].attrs.cardId).toBe('c1')
  })

  it('松手前最后一帧真的离开了 .rail（落在正文/河流区域）——目标要被清掉，改走重排，不误 park', async () => {
    const box = useBookStore.getState().addBox('测试盒')!
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    })

    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))

    const dom = container.querySelector('.river') as HTMLElement
    const card = container.querySelector<HTMLElement>('.card[data-card-id="c0"]')!

    const fakeBoxRow = document.createElement('div')
    fakeBoxRow.dataset.boxId = box.id
    document.body.appendChild(fakeBoxRow)
    // 河流本体不在任何 .rail 容器里——elementFromPoint 直接打桩成 dom 自己，
    // closest('.rail') 找不到东西，模拟指针真的挪回正文的场景。

    const originalElementFromPoint = document.elementFromPoint?.bind(document)
    let overRiver = false
    // @ts-expect-error jsdom 没有实现这个 API，测试里按需打桩
    document.elementFromPoint = () => (overRiver ? dom : fakeBoxRow)

    try {
      card.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, pointerId: 13, button: 0, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 60, pointerId: 13, bubbles: true }))
      expect(fakeBoxRow.classList.contains('drop-target')).toBe(true)

      overRiver = true
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 90, pointerId: 13, bubbles: true }))
      // 真的离开了 .rail：目标应该被清掉，高亮消失。
      expect(fakeBoxRow.classList.contains('drop-target')).toBe(false)

      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 90, pointerId: 13, bubbles: true }))
    } finally {
      if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
      else delete (document as any).elementFromPoint
      fakeBoxRow.remove()
    }

    await new Promise((r) => setTimeout(r, 0))

    // 没有 park：盒子仍是空的。
    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(0)
  })
})

describe('findCardInDoc（拖到盒子/拖拽重排共用的定位逻辑）', () => {
  it('按 cardId 在 doc 顶层子节点里找到对应卡的 pos 与节点', () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'card', attrs: { cardId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
        ],
      },
    })
    const found = findCardInDoc(editor.state.doc, 'b')
    expect(found).not.toBeNull()
    expect(found!.node.attrs.cardId).toBe('b')
    expect(editor.state.doc.nodeAt(found!.pos)).toBe(found!.node)
    expect(findCardInDoc(editor.state.doc, 'nope')).toBeNull()
    editor.destroy()
  })
})
