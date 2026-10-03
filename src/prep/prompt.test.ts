import { describe, it, expect } from 'vitest'
import { buildPrepRequest, PREP_SYSTEM, PREP_AUTO } from './prompt'

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


describe('档位决定提示词', () => {
  it('strict 档只有主提示词，完全没提 translation', () => {
    const r = buildPrepRequest(['第一段'], 'strict')
    expect(r.system).toBe(PREP_SYSTEM)
    // 注意：主提示词里本来就有 flat_translation（笼统译法），所以只能断言
    // 顶层那个 translation 字段的说明不在
    expect(r.system).not.toContain('额外要整句译文')
  })

  it('auto 档在主提示词之后追加，前缀一字不改——这样缓存照样命中', () => {
    const r = buildPrepRequest(['第一段'], 'auto')
    expect(r.system.startsWith(PREP_SYSTEM)).toBe(true)
    expect(r.system).toBe(PREP_SYSTEM + PREP_AUTO)
    expect(r.system).toContain('额外要整句译文')
  })

  it('不传档位时默认最严', () => {
    expect(buildPrepRequest(['x']).system).toBe(PREP_SYSTEM)
  })

  it('auto 那段必须说清译文只是参考、且段数要对应', () => {
    expect(PREP_AUTO).toContain('参考')
    expect(PREP_AUTO).toContain('段数')
    // 条目字段里仍然不许出现整句——这条不能因为开了 auto 就松掉
    expect(PREP_AUTO).toContain('仍然不许出现整句英文')
  })
})

describe('术语表进提示词', () => {
  it('没有已定译法时不加那一段', () => {
    expect(buildPrepRequest(['第一段'], 'strict').system).not.toContain('已经定下来的译法')
  })

  it('有的话列进去，并要求排第一', () => {
    const r = buildPrepRequest(['第一段'], 'strict', undefined, { 关系策略: 'relational strategy' })
    expect(r.system).toContain('已经定下来的译法')
    expect(r.system).toContain('「关系策略」→ relational strategy')
  })

  it('术语表排在 focus 之前——它整篇共用，放前面缓存前缀才留得住', () => {
    const r = buildPrepRequest(['第一段'], 'strict', '堵', { 关系策略: 'relational strategy' })
    expect(r.system.indexOf('已经定下来的译法')).toBeLessThan(r.system.indexOf('只为作者指定的那个词'))
  })

  it('空的中文或英文不进表', () => {
    const r = buildPrepRequest(['x'], 'strict', undefined, { 关系策略: '', '': 'x' })
    expect(r.system).not.toContain('已经定下来的译法')
  })
})

describe('划词备料', () => {
  it('给了 focus 就加上"只做这一条"那段，并带上那个词', () => {
    const r = buildPrepRequest(['第一段'], 'strict', '一爪子按下')
    expect(r.system).toContain('只为作者指定的那个词')
    expect(r.system).toContain('一爪子按下')
  })

  it('没给 focus 就不加', () => {
    expect(buildPrepRequest(['第一段']).system).not.toContain('只为作者指定的那个词')
  })

  it('空白的 focus 不算', () => {
    expect(buildPrepRequest(['第一段'], 'strict', '   ').system).not.toContain('只为作者指定的那个词')
  })
})
