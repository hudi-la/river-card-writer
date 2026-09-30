/// <reference types="vite/client" />

// 提示词以 ?raw 形式内联进来：它是要反复迭代的产品内容，不是代码，应该能在
// git 里单独看见 diff，所以放成 .md 文件而不是写在 .ts 里的长字符串。
declare module '*.md?raw' {
  const content: string
  export default content
}
