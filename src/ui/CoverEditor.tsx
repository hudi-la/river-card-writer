import { useState } from 'react'
import { useBookStore, type Book, type Cover } from '../state/bookStore'
import { Modal } from './Modal'

// 标准 HSL -> hex 转换：presets 和随机封面都要喂给原生 <input type=color>（只吃
// #rrggbb），统一走这一个转换，不各自造轮子。
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100
  const lNorm = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sNorm * Math.min(lNorm, 1 - lNorm)
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

// 一组"三色渐变+纹理"审美的预设——低饱和、柔色三元组，呼应书柜自动封面
// （coverGradient）同一种手感，只是每个预设固定住一组好看的颜色+角度，不需要
// 用户自己调也能一键拿到耐看的结果。纯色值，不含任何具象插画/emoji。
export const COVER_PRESETS: { name: string; cover: Cover }[] = [
  { name: '晨雾', cover: { colors: ['#eee2d3', '#c9b8a8', '#8fa6a3'], angle: 135, texture: true } },
  { name: '暮色', cover: { colors: ['#4a3b5c', '#8c5b7a', '#d98b7a'], angle: 160, texture: true } },
  { name: '深海', cover: { colors: ['#1b3a4b', '#3d6e78', '#a7c4bc'], angle: 120, texture: true } },
  { name: '陶土', cover: { colors: ['#d8b46a', '#c97b56', '#7a4b3a'], angle: 145, texture: true } },
  { name: '薄荷', cover: { colors: ['#dff1ea', '#8fc0b0', '#4a7c74'], angle: 110, texture: true } },
  { name: '紫罗兰', cover: { colors: ['#a98cc4', '#7fa3c4', '#c9b8e0'], angle: 150, texture: true } },
]

// 洗牌：跟 coverGradient(id) 同一套哈希公式，只是把哈希换成 Math.random()——
// 保证随机出来的三色永远落在同一个柔和、低饱和的色相/明度范围内，不会开出
// 刺眼的撞色，"玩一玩"但不出戏。
export function randomCover(): Cover {
  const hue1 = Math.floor(Math.random() * 360)
  const hue2 = (hue1 + 40 + Math.floor(Math.random() * 60)) % 360
  const hue3 = (hue1 + 160 + Math.floor(Math.random() * 60)) % 360
  return {
    colors: [hslToHex(hue1, 38, 78), hslToHex(hue2, 32, 70), hslToHex(hue3, 30, 82)],
    angle: Math.floor(Math.random() * 360),
    texture: true,
  }
}

export function coverToCss(cover: Cover): string {
  const [c1, c2, c3] = cover.colors
  const angle = cover.angle ?? 135
  return `linear-gradient(${angle}deg, ${c1}, ${c2}, ${c3})`
}

export function CoverEditorModal({ book, open, onClose }: { book: Book; open: boolean; onClose: () => void }) {
  const setBookCover = useBookStore((s) => s.setBookCover)
  const clearBookCover = useBookStore((s) => s.clearBookCover)
  // 草稿状态：打开时以"这本书当前的封面"为起点，没有的话拿第一个预设当起点，
  // 方便一开门就有个好看的预览可以直接改，而不是空白。取消/关闭不落盘，只有
  // 点"保存"才会调用 setBookCover。
  const [draft, setDraft] = useState<Cover>(() => book.cover ?? COVER_PRESETS[0].cover)

  // open 从 false→true 时重新以当前 book.cover 为起点——避免上次编辑另一本书
  // （或这本书上次取消编辑）时留下的草稿串场。
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(book.cover ?? COVER_PRESETS[0].cover)
  }

  const setColor = (i: 0 | 1 | 2, value: string) => {
    const colors = [...draft.colors] as [string, string, string]
    colors[i] = value
    setDraft({ ...draft, colors })
  }

  const handleSave = () => {
    setBookCover(book.id, draft)
    onClose()
  }

  const handleReset = () => {
    clearBookCover(book.id)
    onClose()
  }

  return (
    <Modal open={open} title={`封面 · ${book.title}`} onClose={onClose}>
      <div className="cover-editor">
        <div className="cover-editor-preview" style={{ backgroundImage: coverToCss(draft) }} data-texture={draft.texture !== false} />

        <div className="cover-editor-row">
          <span className="cover-editor-label">三个颜色</span>
          <div className="cover-editor-swatches">
            {draft.colors.map((c, i) => (
              <input
                key={i}
                type="color"
                aria-label={`封面颜色 ${i + 1}`}
                value={c}
                onChange={(e) => setColor(i as 0 | 1 | 2, e.target.value)}
              />
            ))}
          </div>
        </div>

        <div className="cover-editor-row">
          <span className="cover-editor-label">角度</span>
          <input
            type="range"
            min={0}
            max={360}
            value={draft.angle ?? 135}
            aria-label="渐变角度"
            onChange={(e) => setDraft({ ...draft, angle: Number(e.target.value) })}
          />
          <span className="cover-editor-angle-value">{draft.angle ?? 135}°</span>
        </div>

        <div className="cover-editor-row">
          <label className="cover-editor-texture-toggle">
            <input
              type="checkbox"
              checked={draft.texture !== false}
              onChange={(e) => setDraft({ ...draft, texture: e.target.checked })}
            />
            纹理
          </label>
          <button type="button" className="cover-editor-shuffle" onClick={() => setDraft(randomCover())}>
            🎲 随机
          </button>
        </div>

        <div className="cover-editor-row cover-editor-presets">
          {COVER_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="cover-editor-preset"
              title={p.name}
              style={{ backgroundImage: coverToCss(p.cover) }}
              onClick={() => setDraft(p.cover)}
            >
              <span className="cover-editor-preset-name">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="cover-editor-actions">
          <button type="button" className="cover-editor-restore" onClick={handleReset}>
            恢复默认
          </button>
          <button type="button" className="cover-editor-save" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}
