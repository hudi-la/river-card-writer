import { describe, it, expect } from 'vitest'
import { buildPrepRequest, buildTranslateRequest, buildWordRequest, PREP_SYSTEM, PREP_TRANSLATE } from './prompt'

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


describe('buildTranslateRequest —— 翻译用自己的小提示词', () => {
  it('不带备料那套提示词', () => {
    const r = buildTranslateRequest(['第一段'])
    expect(r.system).toBe(PREP_TRANSLATE)
    expect(r.system).not.toContain('靶心')
    expect(r.system.length).toBeLessThan(PREP_SYSTEM.length / 5)
  })

  it('段落按数组送过去，段数一眼可数', () => {
    expect(JSON.parse(buildTranslateRequest(['第一段', '第二段']).user)).toEqual(['第一段', '第二段'])
  })

  it('提示词要求一段对一段', () => {
    expect(PREP_TRANSLATE).toContain('一段对一段')
  })
})

describe('术语表进提示词', () => {
  it('没有已定译法时不加那一段', () => {
    expect(buildPrepRequest(['第一段']).system).not.toContain('已经定下来的译法')
  })

  it('有的话列进去，并要求排第一', () => {
    const r = buildPrepRequest(['第一段'], { 关系策略: 'relational strategy' })
    expect(r.system).toContain('已经定下来的译法')
    expect(r.system).toContain('「关系策略」→ relational strategy')
  })

  it('空的中文或英文不进表', () => {
    const r = buildPrepRequest(['x'], { 关系策略: '', '': 'x' })
    expect(r.system).not.toContain('已经定下来的译法')
  })
})

describe('加词：跟备料是两份提示词', () => {
  it('加词的提示词小一个数量级——它不该做挑靶心、判文体那些事', () => {
    const w = buildWordRequest(['第一段'], '编入')
    const p = buildPrepRequest(['第一段'])
    expect(w.system.length).toBeLessThan(p.system.length / 2)
  })

  it('加词的提示词里没有备料那套（靶心、文体、承重句、优先级）', () => {
    const w = buildWordRequest(['第一段'], '编入').system
    for (const absent of ['靶心', '承重句', 'priority', 'genre']) {
      expect(w).not.toContain(absent)
    }
  })

  it('但该守的规矩一条没少', () => {
    const w = buildWordRequest(['第一段'], '编入').system
    for (const must of ['短处', 'verify_form', '不要给整句英文', 'ridicule']) {
      expect(w).toContain(must)
    }
  })

  it('user 里带整段中文当语境，并点明是哪个词', () => {
    const r = buildWordRequest(['第一段', '第二段'], '编入')
    expect(r.user).toContain('第一段')
    expect(r.user).toContain('第二段')
    expect(r.user).toContain('「编入」')
  })

  it('已定译法照样带上——术语一致跟哪个功能无关', () => {
    const r = buildWordRequest(['x'], '编入', { 关系策略: 'relational strategy' })
    expect(r.system).toContain('「关系策略」→ relational strategy')
  })
})
