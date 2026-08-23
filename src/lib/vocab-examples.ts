// ── 예문 생성 배치 분할 ───────────────────────────────────────────────────────
// 예문 생성은 단어 수에 비례해 출력 토큰이 늘어난다 (단어당 영문 예문 + 한글 번역 ≈ 50~60 토큰).
// 한 번에 다 보내면 120단어 근처부터 max_tokens 에 잘려 JSON 이 깨지고, 전부-아니면-없음이라
// 타임아웃 시 0개 저장된다. 그래서 배치로 나눠 병렬 호출하고 배치마다 즉시 저장한다.
export const VOCAB_EXAMPLE_BATCH_SIZE = 40

export function chunkVocabExampleBatches<T>(items: T[], size: number = VOCAB_EXAMPLE_BATCH_SIZE): T[][] {
  if (size <= 0) throw new Error('batch size must be positive')
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}
