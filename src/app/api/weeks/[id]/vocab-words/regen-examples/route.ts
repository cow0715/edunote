import { getAuth, getTeacherId, assertWeekOwner, err, ok } from '@/lib/api'
import { generateVocabExamples } from '@/lib/anthropic'
import { chunkVocabExampleBatches } from '@/lib/vocab-examples'

// 배치 병렬 호출이라 보통 1분 안에 끝나지만, LLM 지연·재시도를 감안해 다른 LLM 라우트와 같은 상한을 둔다
export const maxDuration = 300

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

  // ⚠️ 반드시 example_sentence 가 null 인 단어만 채운다.
  // 예문 유형(빈칸/선택) 시험지는 원문 예문과 시험지 문장을 비교해 정답을 역산하므로,
  // 이미 예문이 있는 단어를 덮어쓰면 채점된 시험지의 정답이 어긋난다.
  // "덮어쓰기" 옵션을 추가하려면 countGradedVocabAnswers 로 채점 여부를 먼저 확인할 것.
  const { data: missing, error } = await supabase
    .from('vocab_word')
    .select('id, english_word')
    .eq('week_id', weekId)
    .is('example_sentence', null)

  if (error) return err(error.message, 500)
  if (!missing?.length) return ok({ generated: 0 })

  // 배치마다 생성 → 즉시 저장. 한 배치가 실패해도 나머지는 남고, 다시 누르면 빈 단어만 이어서 채운다.
  const batches = chunkVocabExampleBatches(missing)
  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const examples = await generateVocabExamples(batch)
      const updates = await Promise.all(
        examples.map((u) =>
          supabase
            .from('vocab_word')
            .update({ example_sentence: u.sentence, example_translation: u.translation, example_source: 'teacher_ai' })
            .eq('id', u.id)
        )
      )
      return { generated: examples.length, saved: updates.filter((r) => !r.error).length }
    })
  )

  let generated = 0
  let saved = 0
  let failedBatches = 0
  for (const result of results) {
    if (result.status === 'fulfilled') {
      generated += result.value.generated
      saved += result.value.saved
    } else {
      failedBatches += 1
      console.error('[regen-examples] 배치 실패', result.reason)
    }
  }

  if (saved > 0) {
    await supabase
      .from('week')
      .update({ vocab_examples_generated_at: new Date().toISOString() })
      .eq('id', weekId)
  }

  if (saved === 0 && failedBatches > 0) return err('예문 생성에 실패했습니다. 다시 시도해주세요.', 502)
  return ok({ generated, saved, missing: missing.length, failedBatches })
}
