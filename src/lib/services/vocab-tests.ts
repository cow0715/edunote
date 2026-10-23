import 'server-only'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { SaveError } from '@/lib/db/errors'
import { executeStatements, insertRows, updateRows } from '@/lib/db/statements'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { lockWeek } from './week-save'

type TestItem = { wordId: string; variantId: string | null; promptSource: string; promptText: string }
export async function replaceVocabTest(context: TeacherTransaction, weekId: string, title: string, items: TestItem[]) {
  await lockWeek(context, weekId)
  const { tx } = context
  const count = await tx.execute(sql`select count(*)::int as count from public.student_vocab_answer a
    join public.week_score s on s.id=a.week_score_id where s.week_id=${weekId}::uuid`)
  const graded = Number(count.rows[0].count)
  if (graded) throw new SaveError(`이미 채점된 단어 답안이 ${graded}개 있어 바꿀 수 없습니다. 바꾸려면 먼저 이 주차의 단어 채점을 지워야 합니다.`, 409)
  if (!items.length) throw new SaveError('시험 단어를 선택해주세요.')
  // Revalidate every FK after enrichment/network waits; ownership alone cannot
  // prevent linking a word from another week belonging to the same teacher.
  const valid = await tx.execute(sql`select count(*)::integer as count
    from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) i("wordId" uuid,"variantId" uuid)
    join public.vocab_word w on w.id=i."wordId" and w.week_id=${weekId}::uuid
    where i."variantId" is null or exists(select 1 from public.vocab_word_variant v
      where v.id=i."variantId" and v.vocab_word_id=w.id)`)
  if (Number(valid.rows[0].count) !== items.length) throw new SaveError('선택한 단어가 변경됐습니다. 다시 선택해주세요.', 409)
  const previous=(await tx.execute(sql`select i.vocab_word_id,i.vocab_word_variant_id,i.prompt_source,i.prompt_text
    from public.vocab_test_item i where i.vocab_test_id=(select id from public.vocab_test
      where week_id=${weekId}::uuid and is_active order by created_at desc limit 1) order by i.sort_order`)).rows
  const sameSelection=previous.length===items.length && previous.every((item,index)=>
    item.vocab_word_id===items[index].wordId && (item.vocab_word_variant_id??null)===(items[index].variantId??null)
    && (item.prompt_source??'word')===items[index].promptSource && (item.prompt_text??'')===items[index].promptText)
  const id = randomUUID()
  await executeStatements(tx, [
    // A manually entered numeric score may exist without answer rows. Clear it
    // when selection changes, while preserving it for an identical reprint.
    ...(!sameSelection ? [updateRows('week_score',{vocab_correct:null,vocab_retake_correct:null,vocab_photo_path:null},sql`week_id=${weekId}::uuid`)] : []),
    updateRows('vocab_test', { is_active: false }, sql`week_id=${weekId}::uuid`),
    ...insertRows('vocab_test', [{ id, week_id: weekId, title, is_active: true, item_count: items.length }]),
    ...insertRows('vocab_test_item', items.map((item, i) => ({ vocab_test_id: id,
      vocab_word_id: item.wordId, vocab_word_variant_id: item.variantId, test_number: i + 1,
      sort_order: i + 1, prompt_source: item.promptSource, prompt_text: item.promptText || null }))),
    updateRows('week', { vocab_total: items.length }, sql`id=${weekId}::uuid`, true),
  ])
  const result = await tx.execute(sql`select id,week_id,title,is_active,item_count,created_at from public.vocab_test where id=${id}::uuid`)
  if (!result.rows[0]) throw new SaveError('시험지 저장에 실패했습니다.', 409)
  return result.rows[0]
}
