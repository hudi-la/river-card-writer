# 写书 app 主页 UI 整理 — 设计

## 目标

把主页（书柜/`Bookshelf`）的排版对齐、弄整齐，并给两个内容区加上正式的**栏目标题**。参考读书 app 主页（`Library` 标题 → hint 副行 → 网格）的排版骨架，但用**浅色**（沿用 card-writer 已有的 `--paper/--ink/--muted` 变量），不用读书 app 的深色玻璃。

只做视觉/结构整理，**不碰任何书/盒子/卡片的数据与逻辑**（第一铁律：任何改动都不能弄丢用户写的书）。

## 参考骨架（读书 app）

```
.home-top   →  大标题（左） + 设置图标（右）
.home-hint  →  一行安静小字状态
.book-grid  →  网格
```

card-writer 浅色化后的目标结构：

```
.shelf
  .shelf-top        大标题 River（左） + UserCenter 头像（右）
  .shelf-hint-line  一行小字提示（muted）
  section「正在写的书」
    .shelf-section-title  正在写的书
    .shelf-grid           ＋新书 + 所有书卡
  section「通用盒子」
    .shelf-section-title  通用盒子  [ⓘ 悬停 tooltip：可在每本书中访问]
    .shelf-grid           ＋新盒子 + 所有盒子瓦片
```

## 具体决定

1. **大标题**：纯英文 **River**（对齐读书 app 纯英文 `Library` 的手感）。
2. **副标题**：标题下一行安静小字，如 `你的卡片河流 · 点一本书开始写`，色 `--muted`。
3. **头部对齐**：新增 `.shelf-top` flex 行，标题左、`UserCenter` 头像右。UserCenter 现在是浮右裸按钮 + 一堆内联样式；把它落位到 `.shelf-top` 右侧即可，**不改 UserCenter 内部逻辑**。
4. **两个栏目标题**：
   - `正在写的书`
   - `通用盒子` + 一个小 `info`（lucide `Info`）图标；图标 `title="可在每本书中访问"`，**鼠标悬停才显示**说明（发现性靠图标做钩子，页面平时保持干净）。
   - 样式 `.shelf-section-title`：~14px、字重 600、`--ink`；与网格间距统一。
5. **去掉 `.shelf-divider`**：分区改由栏目标题承担，删掉那条突兀的横线。
6. **不动的部分**：`.shelf` 容器（`max-width:980px`）、`.shelf-grid` 列宽（`minmax(150px)`）、书卡 `BookCard`、盒子瓦片 `UniversalBoxTile`、菜单、封面、emoji/颜色选择器 —— 全部保持原样。

## 改动范围

- `src/ui/Bookshelf.tsx`：`Bookshelf()` 内加 `.shelf-top` 头部、两个 `<section>` + 栏目标题；`UniversalBoxSection` 保持不变（只是被包进带标题的 section）。导入 `Info` 图标。
- `src/styles.css`：新增 `.shelf-top / .shelf-title / .shelf-hint-line / .shelf-section / .shelf-section-title` 几条浅色规则；删除/停用 `.shelf-divider`。
- `src/ui/UserCenter.tsx`：仅在需要时微调外层容器定位（去掉 `justifyContent:flex-end` 浮右，改由 `.shelf-top` 控制布局），逻辑零改动。

## 验证

- 书柜有书 + 有盒子时：两个栏目标题正确显示，River 标题 + 头像同一行对齐。
- 悬停「通用盒子」info 图标出现 tooltip「可在每本书中访问」。
- 空书柜：`shelf-hint`（"书柜还是空的…"）仍在。
- 现有测试 `Bookshelf.test.tsx` 全绿（若断言依赖旧结构则同步更新）。
- 手动跑 app 截图确认排版整齐、浅色一致。
```
