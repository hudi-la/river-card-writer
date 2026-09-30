import { describe, it, expect } from 'vitest'
import { buildPrepRequest, PREP_SYSTEM } from './prompt'

describe('buildPrepRequest', () => {
  it('system 是提示词正文，user 只装中文', () => {
    const r = buildPrepRequest(['第一段', '第二段'])
    expect(r.system).toBe(PREP_SYSTEM)
    expect(r.user).toContain('第一段')
    expect(r.user).toContain('第二段')
  })

  it('提示词里必须有那六条真跑踩出来的约束', () => {
    // 每一条都是拿作者真文字跑出来、发现问题后加进去的。删掉任何一条都会回退。
    for (const must of [
      '不是翻译',   // ① 任务不是翻译
      '靶心',       // ② 靶心是质感点不是难词
      '文体',       // ③ 先判断文体
      '承重句',     // ④ 承重句要拆到词一级
      'loses',      // ⑤ 每个候选必须说缺点
      'verify_form',// ⑥ 裸词形
      'ridicule',   // ⑥ 的正反例
    ]) {
      expect(PREP_SYSTEM).toContain(must)
    }
  })
})
