import { describe, expect, it } from 'vitest'
import { chunkVocabExampleBatches, VOCAB_EXAMPLE_BATCH_SIZE } from '@/lib/vocab-examples'

describe('chunkVocabExampleBatches', () => {
  it('기본 배치 크기로 나누고 마지막 배치는 나머지를 담는다', () => {
    const items = Array.from({ length: 179 }, (_, i) => i)
    const batches = chunkVocabExampleBatches(items)
    expect(batches).toHaveLength(Math.ceil(179 / VOCAB_EXAMPLE_BATCH_SIZE))
    expect(batches.flat()).toEqual(items)
    expect(batches.every((b) => b.length <= VOCAB_EXAMPLE_BATCH_SIZE)).toBe(true)
  })

  it('빈 입력은 빈 배열, 배치 크기 이하는 한 배치', () => {
    expect(chunkVocabExampleBatches([])).toEqual([])
    expect(chunkVocabExampleBatches([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })

  it('0 이하 배치 크기는 거부한다', () => {
    expect(() => chunkVocabExampleBatches([1], 0)).toThrow()
  })
})
