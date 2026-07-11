import { Mark } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    emphasis: {
      toggleEmphasis: () => ReturnType
    }
    refer: {
      toggleRefer: () => ReturnType
    }
    strike: {
      toggleStrike: () => ReturnType
    }
  }
}

// 强调：视觉上加粗，语义上跟标准 <strong> 区分开（加 .em class），方便以后单独定制样式。
export const Emphasis = Mark.create({
  name: 'emphasis',
  parseHTML() {
    return [{ tag: 'strong.em' }]
  },
  renderHTML() {
    return ['strong', { class: 'em' }, 0]
  },
  addCommands() {
    return {
      toggleEmphasis:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },
})

// 引述/指涉：标记「这段文字在指别处」的行内片段，渲染成带 class 的 <em>。
export const Refer = Mark.create({
  name: 'refer',
  parseHTML() {
    return [{ tag: 'em.refer' }]
  },
  renderHTML() {
    return ['em', { class: 'refer' }, 0]
  },
  addCommands() {
    return {
      toggleRefer:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },
})

// 删除线：中划掉选中文字（不是真的删除内容——纯视觉标记，跟 emphasis/refer
// 同类的行内 mark，渲染成 <s class="strike">，浏览器对 <s> 天然是
// text-decoration:line-through，styles.css 里再显式补一条兜底。
export const Strike = Mark.create({
  name: 'strike',
  parseHTML() {
    return [{ tag: 's.strike' }]
  },
  renderHTML() {
    return ['s', { class: 'strike' }, 0]
  },
  addCommands() {
    return {
      toggleStrike:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    }
  },
})
