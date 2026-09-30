import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { mergeImported, mergeUniversalCards } from './backup'
import type { PrepResult } from '../prep/types'
import { pushSnapshot, decideSnapshot } from './snapshots'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const OLD_BOOK_KEY = 'card-writer:book'
const LIBRARY_KEY = 'card-writer:library'
const NAV_KEY = 'card-writer:nav'

export type Box = { id: string; name: string; cards: any[]; emoji?: string; color?: string }

// 自定义封面（可选）：三色渐变 + 可调角度 + 可选纹理开关。缺失时封面回退到
// coverGradient(id) 那个自动哈希渐变——这是唯一的新增可选属性，绝不影响
// doc/boxes，也绝不会让没设置过封面的老书/新书表现有任何变化。
export type Cover = { colors: [string, string, string]; angle?: number; texture?: boolean }

// 宽松校验，永不抛出：只要求 colors 是三个字符串；angle/texture 存在时要求
// 类型对——不对的形状（脏数据、以后格式演化留下的旧样子）一律当"没有封面"处理，
// 而不是让渲染/store 逻辑炸掉。
export function isValidCover(raw: any): raw is Cover {
  if (!raw || typeof raw !== 'object') return false
  if (!Array.isArray(raw.colors) || raw.colors.length !== 3) return false
  if (!raw.colors.every((c: any) => typeof c === 'string')) return false
  if (raw.angle !== undefined && typeof raw.angle !== 'number') return false
  if (raw.texture !== undefined && typeof raw.texture !== 'boolean') return false
  return true
}
// updatedAt：本书内容最后一次改动的时间（ISO string），每次改标题/正文/盒子都要
// 重新盖章。sync 层拿它来判断"云端跟本地这本同 id 的书谁更新"——CRITICAL：
// 缺失时（老数据、还没被这次改动碰过）一律当成"比云端旧的都不算数"，交给 sync
// 那边的合并规则去处理（该规则选择在缺失/无法比较时优先本地，绝不因为不确定
// 就丢本地改动）。可选字段，而不是给个假的哨兵日期——不确定就是不确定，别装
// 出一个"很旧"的确定值来源，那样反而可能在别的比较逻辑里被误用。
// hints：备料提词，按 cardId 索引。刻意不放进 doc——正文 JSON 保持干净、导出成稿
// 天然不带它；而且提词可能比正文还长，塞进 doc 会让每次编辑的 diff 和同步负载都
// 被它主导。CRITICAL：模型的产出只进这里，绝不进 card 的 en 属性——en 只装作者
// 自己敲的字。
// aiPolicy：这份稿子允许 AI 做到哪一档。默认 strict（只给词）——安全的那一档是
// 默认值，放开要主动开口。目前只实现了 strict。
// 两个都是可选字段，老书读出来是 undefined、行为零变化，跟 cover/subtitle 同一个路子。
export type Book = { id: string; title: string; doc: any; boxes: Box[]; updatedAt?: string; cover?: Cover; subtitle?: string; author?: string; hints?: Record<string, PrepResult>; aiPolicy?: 'strict' | 'open' | 'auto' }
export type Library = { books: Book[]; activeBookId: string | null; universalBoxes: Box[] }

// 库级通用盒子：不属于任何一本书，跨所有书共享同一份实例。Phase 14 起支持
// 多个、可命名的通用盒子（library.universalBoxes: Box[]）。UNIVERSAL_BOX_ID
// 保留作为"默认那个通用盒子"的 id——老数据里唯一的那个通用盒子、以及全新库
// 里自动创建的第一个通用盒子，都用这个 id，这样旧的 UNIVERSAL_BOX_ID 引用
// （比如书内那个"通用盒子"入口）迁移后依然命中同一个盒子。
export const UNIVERSAL_BOX_ID = '__universal__'

function defaultUniversalBox(): Box {
  return { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }
}

function defaultUniversalBoxes(): Box[] {
  return [defaultUniversalBox()]
}

function isValidBox(b: any): b is Box {
  return !!b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.cards)
}

function isValidBoxArray(arr: any): arr is Box[] {
  return Array.isArray(arr) && arr.every(isValidBox)
}

type BookState = {
  library: Library
  shell: 'shelf' | 'book' | 'universal'
  viewKind: 'doc' | 'box'
  activeBoxId: string | null
  carried: { boxId: string; cardId: string } | null
  activeBook: () => Book | undefined
  addBook: (title?: string) => Book
  openBook: (id: string) => void
  goToShelf: () => void
  openUniversalBox: () => void
  renameBook: (id: string, title: string) => void
  deleteBook: (id: string) => void
  // 设置/替换某本书的自定义封面（三色渐变+角度+纹理开关）。只碰 cover 字段，
  // 绝不touch doc/boxes——跟 renameBook 一样重新盖 updatedAt、走 persist，供
  // 快照/云同步捕捉到这次改动。
  setBookCover: (id: string, cover: Cover) => void
  // 封面"恢复默认"：清掉 cover 字段，回退到 coverGradient(id) 那个自动渐变。
  clearBookCover: (id: string) => void
  // 副标题 / 作者（排版视图 Hero 用；空字符串=清除）。跟 setBookCover 一样重新盖 updatedAt。
  setBookSubtitle: (id: string, subtitle: string) => void
  setBookAuthor: (id: string, author: string) => void
  // 供 sync 模块使用：整体替换 library 并落盘（首登下载/上传回填 uuid 时用），
  // 绕开各 action 自己的局部更新逻辑，最小侵入地把云同步挂进 store。
  setLibrary: (library: Library) => void
  // 备份导入：只增不减地把 books 并进当前 library 并持久化（合并逻辑见 backup.ts）。
  importBooks: (books: Book[]) => void
  // 通用盒子备份导入：按 cardId 去重地把 cards 并进"默认那个"通用盒子（id 为
  // UNIVERSAL_BOX_ID，找不到就并进第一个）并持久化（合并逻辑见 backup.ts 的
  // mergeUniversalCards）——只增不减，重复导入不产生重复卡。
  importUniversalCards: (cards: any[]) => void
  updateDoc: (doc: object) => void
  setAiPolicy: (policy: 'strict' | 'open' | 'auto') => void
  setCardHints: (cardId: string, result: PrepResult) => void
  openDoc: () => void
  addBox: (name: string) => Box | undefined
  // 重命名当前书里指定 id 的盒子；忽略空名（trim 后为空则 no-op，盒子名不变）。
  renameBox: (boxId: string, name: string) => void
  // 新增一个具名通用盒子（库级，跨所有书共享），返回新盒子。
  addUniversalBox: (name: string) => Box
  // 重命名指定 id 的通用盒子；id 不存在时 no-op。
  renameUniversalBox: (id: string, name: string) => void
  // 给指定 id 的通用盒子设一个 emoji（书柜瓦片的图标）；id 不存在时 no-op。
  setUniversalBoxEmoji: (id: string, emoji: string) => void
  // 给指定 id 的通用盒子设一个颜色（瓦片底色，空字符串=清除回默认）；id 不存在时 no-op。
  setUniversalBoxColor: (id: string, color: string) => void
  // 删除指定 id 的通用盒子；id 不存在时 no-op。允许删到只剩 0 个（跟 deleteBook 对
  // books 的语义一致，不强行兜底一个默认盒子）。
  deleteUniversalBox: (id: string) => void
  openBox: (id: string) => void
  parkCard: (boxId: string, cardJSON: any) => void
  takeCardFromBox: (boxId: string, cardId: string) => any | undefined
  getBox: (id: string | null) => Box | undefined
  // 拖拽重排（DATA-SAFETY：一律 take-then-insert，绝不新增/丢弃数组元素）——
  // targetIndex 跟 editorBridge.moveCardTo 同一套"splice"语义：先摘掉被挪的那个，
  // 再在剩下那串里数下标插回去（越界一律夹到 [0, 剩余长度] 之间，不抛、不丢）。
  // 只重排当前书 boxes 数组本身；通用盒子的顺序不受这个 action 影响。
  moveBox: (boxId: string, targetIndex: number) => void
  // 盒内卡片重排——boxId 可以是本书盒子也可以是通用盒子（跟 getBox 一样两边都认）。
  moveCardInBox: (boxId: string, cardId: string, targetIndex?: number) => void
  // 把一张卡从 fromBox 搬到 toBox（各自可以是本书盒子/通用盒子，任意组合）：
  // 移除 + 插入合并成一次 library 更新/一次 persist，不会有"已从源盒摘除、还没进
  // 目标盒"的中间态。fromBoxId===toBoxId 时安全地退化成盒内重排（不会先删后加导致
  // 瞬间重复）。目标盒子找不到、或源盒子里找不到这张卡时，安全放弃、原样不动
  // （卡片留在源盒子，绝不凭空消失）。targetIndex 省略时追加到目标盒末尾。
  moveCardToBox: (fromBoxId: string, cardId: string, toBoxId: string, targetIndex?: number) => void
  // 卡片弹窗编辑（打开一张盒子卡片、展开成可编辑大窗，仿 Google Keep 展开笔记）落盘用：
  // boxId 可以是本书盒子也可以是通用盒子（跟 getBox/moveCardInBox 一样两边都认）。按
  // cardId 原地替换这张卡的内容，但强制沿用原 cardId（哪怕传入的 cardJSON.attrs.cardId
  // 是别的值/缺失——编辑器可能吐出一个跟原卡不一致的 attrs，这里统一收口，绝不会让
  // 一次内容编辑意外顶替/新增了 cardId），不新增、不删除任何卡片，盒子卡片总数守恒。
  // 盒子不存在、或盒子里找不到这个 cardId 时安全 no-op（原样不动，绝不凭空插入一张卡）。
  updateBoxCard: (boxId: string, cardId: string, cardJSON: any) => void
  carry: (boxId: string, cardId: string) => void
  cancelCarry: () => void
  dropCarried: () => void
  __resetForTest: () => void
}

function freshBook(title?: string): Book {
  return { id: nanoid(), title: title ?? '未命名', doc: structuredClone(EMPTY_DOC), boxes: [], updatedAt: new Date().toISOString() }
}

// 空库时的默认起始书：不是空白"未命名"，而是一本讲"怎么用"的教程（河流/卡片/盒子…）。
export const STARTER_TITLE = '新手教程'
// STARTER_DOC 内容以用户在 app 里编辑并导出的版本为准——勿手改 doc，改了就跟
// isPristineStarter 的精确比较对不上，"没动过的教程不污染账号"那条就会失效。
export const STARTER_DOC = {
  "type": "doc",
  "content": [
    {
      "type": "card",
      "attrs": {
        "cardId": "wlVBv3GWXxMVOJlC-NSDf",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "chapter",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🌊 河流卡片写作系统"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "fejfsR_FBHF9vKesDc2MB",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "河流——你的正文，像水一样流动、能随时调整；卡片——把想法切成一张张，方便重新谋篇布局、也能先搁一边。让「流动地写」和「可摆布的结构」并存。"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "OlPvpZRqR083qZilAqsZl",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🌊 河流：让正文流起来"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "xTahkwB0fXmbY0VwenLVe",
        "color": "#6bb0ad",
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "别把正文当成一次写死的石头，把它当水。句子、段落随时能重排、增删、搬动；写到哪、卡在哪都能回头调。先让它流，再来收拾——写作的顺序不必等于思考的顺序。"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "2kNOXfqRqmR5vFNtdTAOO",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🃏 卡片：切块，好摆布"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "AACh-Tk4TvCSWf_LTPmxR",
        "color": "#d8b46a",
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "每一段自成一张卡片。把长文切成卡片，你就能像摊开牌一样重排布局（谋篇）；某张暂时不要，先拖到盒子暂存，不用删掉。结构因此可以反复试。"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "jW5HekeYD77_b9HQ893Yd",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🗂 盒子：这本书的临时抽屉"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "n0NyjXLV4W46mg8UzcDGm",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "把一张卡拖进「盒子」，它就从正文里挪出来、存进这本书的抽屉；想用了再拖回去。用来搁置某段、腾挪结构，而不是删除——盒子只属于当前这本书。"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "Wb1PahRqW_J5ZF8JoFnmF",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🌐 通用盒子：还不知道归哪篇的想法"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "LXAYHFJ580uITyhbEvpIC",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "通用盒子跨所有书共享。它不是放「反复要用的素材」，而是接住那些随笔、灵光、随手记——你还没想好该归到哪篇文章的想法。先扔进来；将来哪篇用得上，再从这儿拖过去。"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "Z9DhZlwHmsl7QXk7TRiud",
        "color": null,
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "🔤 文字样式"
            }
          ]
        }
      ]
    },
    {
      "type": "card",
      "attrs": {
        "cardId": "9kpjckTJdrMk1D6ZUo1cR",
        "color": "#a98cc4",
        "note": ""
      },
      "content": [
        {
          "type": "paragraph",
          "attrs": {
            "style": "chapter",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "章（H1）"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "h1",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "节（H2）"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "h2",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "二级（H3）"
            }
          ]
        },
        {
          "type": "paragraph",
          "attrs": {
            "style": "body",
            "note": "",
            "collapsed": false
          },
          "content": [
            {
              "type": "text",
              "text": "上面依次是 章 / 大标题 / 小标题，这一行是正文。选中任意一段，在工具栏切换它的样式；章、大、小标题都会自动进右侧大纲。"
            }
          ]
        }
      ]
    }
  ]
}

function starterBook(): Book {
  return { id: nanoid(), title: STARTER_TITLE, doc: structuredClone(STARTER_DOC), boxes: [], updatedAt: new Date().toISOString() }
}
// 是不是"一本从没被动过的默认教程书"——sync 用它来判断该不该把这本剔掉，
// 避免每次在新设备/无痕里登录都把这本空教程又传进你的账号。用户一旦改了标题/
// 正文/盒子/封面，JSON 就跟 STARTER_DOC 不一致了，立刻当成真书正常同步、绝不丢。
export function isPristineStarter(b: Book): boolean {
  return (
    b.title === STARTER_TITLE &&
    (!b.boxes || b.boxes.length === 0) &&
    !b.cover &&
    JSON.stringify(b.doc) === JSON.stringify(STARTER_DOC)
  )
}

// 把一章的段落文本拼成一张"章标题卡"：card > paragraph(style:'chapter', text: chapter.title)。
function chapterTitleCard(title: string) {
  return {
    type: 'card',
    content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: title }] }],
  }
}

export function normalizeBook(raw: any): Book {
  const boxes: Box[] = Array.isArray(raw.boxes) ? raw.boxes : []
  // 老数据没有 updatedAt 字段——留空（undefined），不编造一个哨兵日期。sync 合并
  // 逻辑里"缺失就当不确定、优先本地"的规则已经保证这不会导致丢书/丢改动。
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
  // 老数据/别处传入的形状都没有 cover——缺失或形状不对时一律 undefined，渲染层
  // 自然回退到 coverGradient(id)。这一处校验统一收口，normalizeBook 之外没有
  // 别的地方需要再检查一遍 cover 的合法性。
  const cover = isValidCover(raw.cover) ? raw.cover : undefined
  if (raw.doc) {
    return { id: raw.id, title: raw.title, doc: raw.doc, boxes, updatedAt, cover }
  }
  // 旧格式迁移：每章 → [章标题卡, ...该章的卡]，顺次拼进一个大 doc。
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : []
  const content: any[] = []
  for (const ch of chapters) {
    // 空文本节点会让 ProseMirror 在加载时抛错（"Empty text nodes are not
    // allowed"），进而拖垮整本书的迁移。标题为空/纯空白/缺失时跳过标题卡，
    // 该章的卡片正文照常拼入。
    const title = typeof ch.title === 'string' ? ch.title.trim() : ''
    if (title) content.push(chapterTitleCard(title))
    const chapterCards = Array.isArray(ch.doc?.content) ? ch.doc.content : []
    content.push(...chapterCards)
  }
  const doc = content.length > 0 ? { type: 'doc', content } : structuredClone(EMPTY_DOC)
  return { id: raw.id, title: raw.title, doc, boxes, updatedAt, cover }
}

export function normalizeLibrary(raw: any): Library {
  const books: Book[] = Array.isArray(raw?.books) ? raw.books.map(normalizeBook) : []
  const activeBookId = typeof raw?.activeBookId === 'string' ? raw.activeBookId : null
  // 迁移优先级（一律不丢老盒子/老卡）：
  //   1. 已有合法 universalBoxes 数组 → 原样保留（不重建实例、不动里面的 box/cards）。
  //   2. 老格式的单个 universalBox → 包成单元素数组，原盒子/卡片实例原样保留。
  //   3. 都没有 → 一个全新的默认通用盒子。
  let universalBoxes: Box[]
  if (isValidBoxArray(raw?.universalBoxes)) {
    universalBoxes = raw.universalBoxes
  } else if (isValidBox(raw?.universalBox)) {
    universalBoxes = [raw.universalBox]
  } else {
    universalBoxes = defaultUniversalBoxes()
  }
  return { books, activeBookId, universalBoxes }
}

function loadOldSingleBookAsLibrary(): Library | undefined {
  try {
    const raw = localStorage.getItem(OLD_BOOK_KEY)
    if (!raw) return undefined
    const b = JSON.parse(raw)
    const looksLikeBook = b && (b.doc || (Array.isArray(b.chapters) && b.chapters.length > 0 && b.chapters[0]?.id))
    if (!looksLikeBook) return undefined
    return { books: [normalizeBook(b)], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
  } catch {
    return undefined
  }
}

export function load(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.books)) return normalizeLibrary(parsed)
    }
  } catch {}

  const migrated = loadOldSingleBookAsLibrary()
  if (migrated) return migrated

  return { books: [starterBook()], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
}

// 自动本地快照的最后一道保险（snapshots.ts）挂在这里：每次真正落盘之后，顺手判断
// 要不要滚动快照一份（含"掉书前强制快照上一次"的 shrink-guard）。这两个模块级变量
// 记录"上一次持久化的 library"和"上一次落快照的时间"，供 decideSnapshot 做决策；
// __resetForTest 会把它们清零，避免测试之间互相污染。
let prevPersistedLibrary: Library | null = null
let lastSnapshotTs: number | null = null

function persist(library: Library) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
  } catch (e) {
    console.warn('persist failed', e)
  }

  // 快照这一步绝不能抛出、也绝不能影响到上面这次真正的落盘——已经在 try 之外
  // 执行过了。这里再包一层 try/catch，任何差错都吞掉。
  try {
    const now = Date.now()
    const target = decideSnapshot(prevPersistedLibrary, library, now, lastSnapshotTs)
    if (target) {
      pushSnapshot(target, now)
      lastSnapshotTs = now
    }
  } catch (e) {
    console.warn('snapshot failed', e)
  } finally {
    prevPersistedLibrary = library
  }
}

// 刷新恢复：把"当前在哪"（书柜 / 哪本书 / 正文还是盒子）存进 sessionStorage——
// 刷新不再回书柜；新开标签页仍从书柜开始，也不会跨标签页互相抢位置。书本身在
// library 里已持久化，这里只存位置。恢复时逐项校验（书还在吗、盒子还在吗），
// 对不上就安全回书柜，绝不因为一条脏位置记录把 app 卡在打不开的页面上。
type NavState = { shell: BookState['shell']; viewKind: BookState['viewKind']; activeBoxId: string | null }

function loadNav(library: Library): NavState {
  const fallback: NavState = { shell: 'shelf', viewKind: 'doc', activeBoxId: null }
  try {
    const raw = sessionStorage.getItem(NAV_KEY)
    if (!raw) return fallback
    const nav = JSON.parse(raw)
    // 只恢复"在某本书里"这一种位置；'universal' 早已改成悬浮 Modal、'shelf' 本来就是默认
    if (nav?.shell !== 'book') return fallback
    const book = library.books.find((b) => b.id === library.activeBookId)
    if (!book) return fallback
    if (nav.viewKind === 'box' && typeof nav.activeBoxId === 'string') {
      const boxOk =
        book.boxes.some((x) => x.id === nav.activeBoxId) || library.universalBoxes.some((x) => x.id === nav.activeBoxId)
      if (boxOk) return { shell: 'book', viewKind: 'box', activeBoxId: nav.activeBoxId }
    }
    return { shell: 'book', viewKind: 'doc', activeBoxId: null }
  } catch {
    return fallback
  }
}

export const useBookStore = create<BookState>((set, get) => {
  // load() 内部做了不少形状迁移（老单本书→library、补 universalBoxes、chapters→doc
  // 等）。这些迁移只发生在内存里——如果迁移后的新形状一直没被写回
  // localStorage（用户这次打开只是看看、什么都没改就关掉了），下次真正需要读它的
  // 地方（比如 sync、比如浏览器崩溃恢复）读到的还是老形状。这里在启动时比较"读到
  // 的原始字符串"跟"迁移后的样子"，不一致就立刻 persist 一次，让 localStorage
  // 永远反映当前形状，不留旧样子在那"潜伏"。
  let rawStoredBeforeMigration: string | null = null
  try {
    rawStoredBeforeMigration = localStorage.getItem(LIBRARY_KEY)
  } catch {
    rawStoredBeforeMigration = null
  }
  const initialLibrary = load()
  try {
    if (rawStoredBeforeMigration !== JSON.stringify(initialLibrary)) {
      persist(initialLibrary)
    }
  } catch {
    // 迁移落盘失败不影响启动——内存里已经是最新形状，之后任何一次改动触发的
    // persist() 都会把它写下去。
  }

  function withActiveBook<T>(mutate: (book: Book) => { book: Book; result: T }): T | undefined {
    const book = get().activeBook()
    if (!book) return undefined
    const { book: mutated, result } = mutate(book)
    // 每次通过这条路径改书（正文/盒子/卡片……）都重新盖 updatedAt 时间戳，供 sync
    // 层的"同 id 书谁更新"判断使用——统一在这一个地方盖章，而不是让每个 action
    // 各自记得盖一遍、容易漏掉。
    const updated = { ...mutated, updatedAt: new Date().toISOString() }
    const library = { ...get().library, books: get().library.books.map((b) => (b.id === book.id ? updated : b)) }
    persist(library)
    set({ library })
    return result
  }

  const initialNav = loadNav(initialLibrary)

  return {
    library: initialLibrary,
    shell: initialNav.shell,
    viewKind: initialNav.viewKind,
    activeBoxId: initialNav.activeBoxId,
    carried: null,

    activeBook: () => get().library.books.find((b) => b.id === get().library.activeBookId),

    addBook: (title) => {
      const book = freshBook(title)
      const library = { ...get().library, books: [...get().library.books, book] }
      persist(library)
      set({ library })
      return book
    },
    openBook: (id) => set({ library: { ...get().library, activeBookId: id }, shell: 'book', viewKind: 'doc', activeBoxId: null, carried: null }),
    goToShelf: () => set({ shell: 'shelf' }),
    openUniversalBox: () => set({ shell: 'universal' }),
    renameBook: (id, title) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => (b.id === id ? { ...b, title, updatedAt: new Date().toISOString() } : b)),
      }
      persist(library)
      set({ library })
    },
    deleteBook: (id) => {
      const cur = get().library
      const books = cur.books.filter((b) => b.id !== id)
      const wasActive = cur.activeBookId === id
      const library = { ...cur, books, activeBookId: wasActive ? null : cur.activeBookId }
      persist(library)
      set(wasActive ? { library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null } : { library })
    },
    setBookCover: (id, cover) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => (b.id === id ? { ...b, cover, updatedAt: new Date().toISOString() } : b)),
      }
      persist(library)
      set({ library })
    },
    setBookSubtitle: (id, subtitle) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => (b.id === id ? { ...b, subtitle: subtitle || undefined, updatedAt: new Date().toISOString() } : b)),
      }
      persist(library)
      set({ library })
    },
    setBookAuthor: (id, author) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => (b.id === id ? { ...b, author: author || undefined, updatedAt: new Date().toISOString() } : b)),
      }
      persist(library)
      set({ library })
    },
    clearBookCover: (id) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => {
          if (b.id !== id) return b
          const { cover, ...rest } = b
          return { ...rest, updatedAt: new Date().toISOString() }
        }),
      }
      persist(library)
      set({ library })
    },

    // sync/import 传入的 library 可能是旧算法拼出来的、不知道 universalBoxes 这个字段
    // （比如 cw_books 首登下载/上传回填）。缺失/不合法时兜底沿用当前内存里的
    // universalBoxes，而不是丢掉它——通用盒子是本地专属字段，cw_books 同步暂不覆盖它
    // （cw_universal 同步走的是 setLibrary 之外的合并路径，见 sync.ts）。
    setLibrary: (library) => {
      const incoming = (library as any).universalBoxes
      const merged = { ...library, universalBoxes: isValidBoxArray(incoming) ? incoming : get().library.universalBoxes }
      persist(merged)
      set({ library: merged })
    },
    importBooks: (books) => {
      const merged = mergeImported(get().library, books)
      const library = { ...merged, universalBoxes: get().library.universalBoxes }
      persist(library)
      set({ library })
    },
    importUniversalCards: (cards) => {
      const cur = get().library
      if (cur.universalBoxes.length === 0) return
      const targetIdx = Math.max(0, cur.universalBoxes.findIndex((b) => b.id === UNIVERSAL_BOX_ID))
      const universalBoxes = cur.universalBoxes.map((b, i) =>
        i === targetIdx ? { ...b, cards: mergeUniversalCards(b.cards, cards) } : b
      )
      const library = { ...cur, universalBoxes }
      persist(library)
      set({ library })
    },
    updateDoc: (doc) => {
      withActiveBook((book) => ({ book: { ...book, doc }, result: undefined }))
    },
    setAiPolicy: (aiPolicy) => {
      withActiveBook((book) => ({ book: { ...book, aiPolicy }, result: undefined }))
    },
    setCardHints: (cardId, result) => {
      withActiveBook((book) => ({
        book: { ...book, hints: { ...(book.hints ?? {}), [cardId]: result } },
        result: undefined,
      }))
    },
    openDoc: () => set({ viewKind: 'doc' }),
    addBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      return withActiveBook((book) => ({ book: { ...book, boxes: [...book.boxes, box] }, result: box }))
    },
    renameBox: (boxId, name) => {
      const trimmed = name.trim()
      if (!trimmed) return
      withActiveBook((book) => ({
        book: { ...book, boxes: book.boxes.map((b) => (b.id === boxId ? { ...b, name: trimmed } : b)) },
        result: undefined,
      }))
    },
    addUniversalBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      const library = { ...get().library, universalBoxes: [...get().library.universalBoxes, box] }
      persist(library)
      set({ library })
      return box
    },
    renameUniversalBox: (id, name) => {
      const library = { ...get().library, universalBoxes: get().library.universalBoxes.map((b) => (b.id === id ? { ...b, name } : b)) }
      persist(library)
      set({ library })
    },
    setUniversalBoxEmoji: (id, emoji) => {
      const library = { ...get().library, universalBoxes: get().library.universalBoxes.map((b) => (b.id === id ? { ...b, emoji } : b)) }
      persist(library)
      set({ library })
    },
    setUniversalBoxColor: (id, color) => {
      const library = {
        ...get().library,
        universalBoxes: get().library.universalBoxes.map((b) => (b.id === id ? { ...b, color: color || undefined } : b)),
      }
      persist(library)
      set({ library })
    },
    deleteUniversalBox: (id) => {
      const library = { ...get().library, universalBoxes: get().library.universalBoxes.filter((b) => b.id !== id) }
      persist(library)
      set({ library })
    },
    openBox: (id) => set({ viewKind: 'box', activeBoxId: id }),
    parkCard: (boxId, cardJSON) => {
      const cur = get().library
      const uniIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
      if (uniIdx !== -1) {
        const universalBoxes = cur.universalBoxes.map((b, i) => (i === uniIdx ? { ...b, cards: [...b.cards, cardJSON] } : b))
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
        return
      }
      withActiveBook((book) => ({
        book: { ...book, boxes: book.boxes.map((b) => (b.id === boxId ? { ...b, cards: [...b.cards, cardJSON] } : b)) },
        result: undefined,
      }))
    },
    takeCardFromBox: (boxId, cardId) => {
      const cur = get().library
      const uniIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
      if (uniIdx !== -1) {
        const box = cur.universalBoxes[uniIdx]
        const card = box.cards.find((c) => c?.attrs?.cardId === cardId)
        if (!card) return undefined
        const universalBoxes = cur.universalBoxes.map((b, i) => (i === uniIdx ? { ...b, cards: b.cards.filter((c) => c !== card) } : b))
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
        return card
      }
      const book = get().activeBook()
      if (!book) return undefined
      const box = book.boxes.find((b) => b.id === boxId)
      const card = box?.cards.find((c) => c?.attrs?.cardId === cardId)
      if (!box || !card) return undefined
      return withActiveBook((b) => ({
        book: { ...b, boxes: b.boxes.map((x) => (x.id === boxId ? { ...x, cards: x.cards.filter((c) => c !== card) } : x)) },
        result: card,
      }))
    },
    getBox: (id) => {
      if (!id) return undefined
      const uni = get().library.universalBoxes.find((b) => b.id === id)
      if (uni) return uni
      return get().activeBook()?.boxes.find((b) => b.id === id)
    },
    moveBox: (boxId, targetIndex) => {
      withActiveBook((book) => {
        const idx = book.boxes.findIndex((b) => b.id === boxId)
        if (idx === -1) return { book, result: undefined } // 不存在的 boxId：安全 no-op
        const boxes = [...book.boxes]
        const [item] = boxes.splice(idx, 1)
        const clamped = Math.max(0, Math.min(targetIndex, boxes.length))
        boxes.splice(clamped, 0, item)
        return { book: { ...book, boxes }, result: undefined }
      })
    },
    moveCardInBox: (boxId, cardId, targetIndex) => {
      // 盒内重排复用 moveCardToBox 的"同盒"分支——同一份 take-then-insert 逻辑，
      // 不重复实现一遍守恒判断。
      get().moveCardToBox(boxId, cardId, boxId, targetIndex)
    },
    moveCardToBox: (fromBoxId, cardId, toBoxId, targetIndex) => {
      const cur = get().library
      const book = cur.books.find((b) => b.id === cur.activeBookId)

      const findLoc = (boxId: string): { kind: 'universal' | 'book'; idx: number } | null => {
        const uIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
        if (uIdx !== -1) return { kind: 'universal', idx: uIdx }
        if (book) {
          const bIdx = book.boxes.findIndex((b) => b.id === boxId)
          if (bIdx !== -1) return { kind: 'book', idx: bIdx }
        }
        return null
      }

      const fromLoc = findLoc(fromBoxId)
      if (!fromLoc) return // 源盒子不存在：安全 no-op
      const fromBoxCards = (fromLoc.kind === 'universal' ? cur.universalBoxes[fromLoc.idx] : book!.boxes[fromLoc.idx]).cards
      const card = fromBoxCards.find((c) => c?.attrs?.cardId === cardId)
      if (!card) return // 源盒子里没有这张卡：安全 no-op，不凭空造一张出来

      const withoutCard = fromBoxCards.filter((c) => c !== card)
      const sameBox = fromBoxId === toBoxId
      const toLoc = sameBox ? fromLoc : findLoc(toBoxId)
      if (!toLoc) return // 目标盒子不存在：安全放弃，卡片原样留在源盒子，不丢

      // 同盒时"移除后剩下的那串"就是 withoutCard 本身；跨盒时目标盒子的现有卡片
      // 从未包含这张卡，直接用它的完整 cards 数组当插入基准。
      const baseToCards = sameBox ? withoutCard : (toLoc.kind === 'universal' ? cur.universalBoxes[toLoc.idx] : book!.boxes[toLoc.idx]).cards
      const clamped = targetIndex === undefined ? baseToCards.length : Math.max(0, Math.min(targetIndex, baseToCards.length))
      const newToCards = [...baseToCards.slice(0, clamped), card, ...baseToCards.slice(clamped)]

      let universalBoxes = cur.universalBoxes
      let bookBoxes = book?.boxes

      if (!sameBox) {
        if (fromLoc.kind === 'universal') universalBoxes = universalBoxes.map((b, i) => (i === fromLoc.idx ? { ...b, cards: withoutCard } : b))
        else bookBoxes = bookBoxes!.map((b, i) => (i === fromLoc.idx ? { ...b, cards: withoutCard } : b))
      }
      if (toLoc.kind === 'universal') universalBoxes = universalBoxes.map((b, i) => (i === toLoc.idx ? { ...b, cards: newToCards } : b))
      else bookBoxes = bookBoxes!.map((b, i) => (i === toLoc.idx ? { ...b, cards: newToCards } : b))

      const touchesBook = fromLoc.kind === 'book' || toLoc.kind === 'book'
      if (touchesBook && book) {
        const updatedBook = { ...book, boxes: bookBoxes!, updatedAt: new Date().toISOString() }
        const library = { ...cur, universalBoxes, books: cur.books.map((b) => (b.id === book.id ? updatedBook : b)) }
        persist(library)
        set({ library })
      } else {
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
      }
    },
    updateBoxCard: (boxId, cardId, cardJSON) => {
      const cur = get().library
      const uniIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
      if (uniIdx !== -1) {
        const box = cur.universalBoxes[uniIdx]
        const idx = box.cards.findIndex((c) => c?.attrs?.cardId === cardId)
        if (idx === -1) return // 通用盒子里没有这张卡：安全 no-op
        const updatedCard = { ...cardJSON, attrs: { ...cardJSON.attrs, cardId } }
        const universalBoxes = cur.universalBoxes.map((b, i) =>
          i === uniIdx ? { ...b, cards: b.cards.map((c, j) => (j === idx ? updatedCard : c)) } : b
        )
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
        return
      }
      const book = get().activeBook()
      const box = book?.boxes.find((b) => b.id === boxId)
      const idx = box?.cards.findIndex((c) => c?.attrs?.cardId === cardId) ?? -1
      if (!box || idx === -1) return // 盒子不存在，或盒子里没有这张卡：安全 no-op
      const updatedCard = { ...cardJSON, attrs: { ...cardJSON.attrs, cardId } }
      withActiveBook((b) => ({
        book: {
          ...b,
          boxes: b.boxes.map((x) => (x.id === boxId ? { ...x, cards: x.cards.map((c, j) => (j === idx ? updatedCard : c)) } : x)),
        },
        result: undefined,
      }))
    },
    carry: (boxId, cardId) => {
      // Non-destructive: the card stays in the box until the moment of drop.
      // Just replacing the reference here is safe — nothing was ever removed.
      set({ carried: { boxId, cardId } })
      get().openDoc()
    },
    cancelCarry: () => {
      // Card was never removed from the box, so there's nothing to put back.
      set({ carried: null })
    },
    dropCarried: () => set({ carried: null }),
    __resetForTest: () => {
      const book = freshBook()
      const library: Library = { books: [book], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
      // 测试之间互相隔离：不让上一个测试遗留的"上一次 library / 上一次快照时间"
      // 污染这一个测试的 shrink-guard / 节流判断。
      prevPersistedLibrary = null
      lastSnapshotTs = null
      persist(library)
      set({ library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null })
    },
  }
})

// 位置一变就写一份（一条极小的 JSON，不需要节流）；loadNav 启动时读回来。
useBookStore.subscribe((s) => {
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify({ shell: s.shell, viewKind: s.viewKind, activeBoxId: s.activeBoxId }))
  } catch {
    // sessionStorage 不可用（隐私模式等）就静默放弃——只是刷新回书柜，不影响写作
  }
})
