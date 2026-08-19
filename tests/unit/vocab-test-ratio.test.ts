import { describe, expect, it } from 'vitest'
import {
  RATIO_SOURCES,
  DEFAULT_SOURCE_RATIO,
  SOURCE_RATIO_PRESETS,
  allocatePromptTargets,
  applySourceAvailability,
  clampPercent,
  rebalanceSourceRatio,
  VocabSourceRatio,
} from '@/lib/vocab-test-ratio'

function sum(ratio: VocabSourceRatio) {
  return RATIO_SOURCES.reduce((total, source) => total + ratio[source], 0)
}

describe('clampPercent', () => {
  it('0~100 범위로 자르고 반올림한다', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(33.6)).toBe(34)
    expect(clampPercent(NaN)).toBe(0)
  })
})

describe('rebalanceSourceRatio', () => {
  it('기본 비율과 프리셋의 합은 100이다', () => {
    expect(sum(DEFAULT_SOURCE_RATIO)).toBe(100)
    for (const preset of SOURCE_RATIO_PRESETS) {
      expect(sum(preset.ratio)).toBe(100)
    }
  })

  it('한 유형을 바꾸면 합계가 100으로 유지된다', () => {
    const next = rebalanceSourceRatio(DEFAULT_SOURCE_RATIO, 'example_meaning', 50)
    expect(next.example_meaning).toBe(50)
    expect(sum(next)).toBe(100)
  })

  it('나머지 유형은 기존 비중대로 나눠 갖는다', () => {
    const next = rebalanceSourceRatio({ word: 50, synonym: 30, antonym: 20, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 }, 'word', 0)
    expect(next.word).toBe(0)
    expect(next.synonym).toBe(60)
    expect(next.antonym).toBe(40)
    expect(next.derivative).toBe(0)
    expect(sum(next)).toBe(100)
  })

  it('나머지가 전부 0이면 균등 분배한다', () => {
    const next = rebalanceSourceRatio({ word: 100, synonym: 0, antonym: 0, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 }, 'word', 20)
    expect(next.word).toBe(20)
    expect(sum(next)).toBe(100)
  })

  it('100으로 올리면 나머지는 전부 0이 된다', () => {
    const next = rebalanceSourceRatio(DEFAULT_SOURCE_RATIO, 'antonym', 100)
    expect(next.antonym).toBe(100)
    expect(sum(next)).toBe(100)
    expect(next.word).toBe(0)
  })
})

describe('allocatePromptTargets', () => {
  it('배분 합계는 항상 요청한 문항 수와 같다', () => {
    for (const count of [1, 7, 30, 40, 50]) {
      const targets = allocatePromptTargets(count, DEFAULT_SOURCE_RATIO)
      expect(sum(targets)).toBe(count)
    }
  })

  it('비율 0인 유형에는 배분하지 않는다', () => {
    const targets = allocatePromptTargets(40, DEFAULT_SOURCE_RATIO)
    expect(targets.derivative).toBe(0)
  })

  it('비율대로 대략 배분한다', () => {
    const targets = allocatePromptTargets(40, DEFAULT_SOURCE_RATIO)
    expect(targets.word).toBe(16)
    expect(targets.synonym).toBe(8)
    expect(targets.antonym).toBe(8)
    expect(targets.example_meaning).toBe(8)
  })
})

describe('applySourceAvailability', () => {
  const ALL = { word: 40, synonym: 20, antonym: 20, derivative: 0, example_meaning: 20, example: 0, example_choice: 0 }

  it('후보가 없는 유형은 0으로 접고 몫을 나머지에 비중대로 나눈다 (예문 생성 전 = 예문 유형 후보 0)', () => {
    const next = applySourceAvailability(ALL, { word: 68, synonym: 60, antonym: 30, derivative: 10 })
    expect(next.example_meaning).toBe(0)
    expect(next.example).toBe(0)
    expect(next.example_choice).toBe(0)
    expect(sum(next)).toBe(100)
    // 40:20:20 비중 유지 → 50:25:25
    expect(next.word).toBe(50)
    expect(next.synonym).toBe(25)
    expect(next.antonym).toBe(25)
  })

  it('전 유형에 후보가 있으면 그대로 돌려준다', () => {
    const counts = { word: 1, synonym: 1, antonym: 1, derivative: 1, example_meaning: 1, example: 1, example_choice: 1 }
    expect(applySourceAvailability(ALL, counts)).toEqual(ALL)
  })

  it('없는 유형이 원래 0% 면 재분배 없이 그대로', () => {
    const next = applySourceAvailability(ALL, { word: 1, synonym: 1, antonym: 1, example_meaning: 1 })
    expect(next).toEqual(ALL)
  })

  it('남은 유형이 전부 0% 였으면 원본에 몰아준다', () => {
    const next = applySourceAvailability({ word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 100, example: 0, example_choice: 0 }, { word: 5 })
    expect(next.word).toBe(100)
    expect(sum(next)).toBe(100)
  })
})
