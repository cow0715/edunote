import 'server-only'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { SaveError, databaseErrorCode } from '@/lib/db/errors'
import { parseInput } from '@/lib/db/input'
import { executeStatements, insertRows, updateRows, type RecordValues } from '@/lib/db/statements'
import type { TeacherTransaction } from '@/lib/db/transaction'
import { lockWeek } from './week-save'

export type ExampleInput = {
  id: string; english_word: string; example_sentence: string | null; example_translation: string | null
  example_distractor: string | null; example_source: string | null
}
export type VariantInput = {
  variant: RecordValues & { id: string; vocab_word_id: string; word: string; relation_type: string }
  source: { id: string; english_word: string; correct_answer: string | null }
}
const exampleSchema = z.array(z.object({ id:z.string().uuid(), sentence:z.string().trim().min(1),
  translation:z.string().trim().min(1), distractor:z.string().nullable() })).max(100)
const patchSchema = z.array(z.object({ id:z.string().uuid(), part_of_speech:z.string().nullable(),
  meaning:z.string().nullable(), usage_note:z.string().nullable(), excluded_meanings:z.array(z.string()),
  needs_review:z.boolean(), confidence:z.number().min(0).max(1).nullable() })).max(50)
const stale = () => new SaveError('단어가 변경됐습니다. 새로고침 후 다시 보강해 주세요.',409)

/** Receives only server-generated results after AI has finished; no model/network call here. */
export async function saveExampleBatch(context:TeacherTransaction, weekId:string, expected:ExampleInput[], input:unknown) {
  const results=parseInput(exampleSchema,input)
  if (!results.length) return 0
  if (new Set(results.map(r=>r.id)).size!==results.length) throw new SaveError('중복된 예문 결과입니다.')
  await lockWeek(context,weekId)
  const snapshots=new Map(expected.map(row=>[row.id,row]))
  for(const result of results) {
    const before=snapshots.get(result.id)
    if(!before || before.example_sentence!==null) throw new SaveError('요청하지 않은 예문 결과입니다.')
    const row=(await context.tx.execute(sql`select id from public.vocab_word w
      where w.id=${result.id}::uuid and w.week_id=${weekId}::uuid and w.example_sentence is null
        and to_jsonb(w) @> ${JSON.stringify(before)}::jsonb`)).rows[0]
    if(!row) throw stale()
  }
  await executeStatements(context.tx,results.map(result=>updateRows('vocab_word',{
    example_sentence:result.sentence,example_translation:result.translation,example_distractor:result.distractor,example_source:'teacher_ai',
  },sql`id=${result.id}::uuid and week_id=${weekId}::uuid and example_sentence is null`,true)))
  await context.tx.execute(sql`update public.week set vocab_examples_generated_at=now() where id=${weekId}::uuid`)
  return results.length
}

/** Variant meanings and the shared dictionary entries commit or roll back together. */
export async function saveVariantBatch(context:TeacherTransaction, weekId:string, expected:VariantInput[], input:unknown, generatedIds:string[]) {
  const patches=parseInput(patchSchema,input)
  if(!patches.length) return
  if(new Set(patches.map(r=>r.id)).size!==patches.length) throw new SaveError('중복된 파생어 결과입니다.')
  await lockWeek(context,weekId)
  const snapshots=new Map(expected.map(row=>[row.variant.id,row]))
  for(const patch of patches) {
    const before=snapshots.get(patch.id)
    if(!before || (before.variant.meaning && before.variant.needs_review!==true)) throw new SaveError('요청하지 않은 파생어 결과입니다.')
    const current=(await context.tx.execute(sql`select v.id from public.vocab_word_variant v join public.vocab_word w on w.id=v.vocab_word_id
      where v.id=${patch.id}::uuid and w.week_id=${weekId}::uuid
        and to_jsonb(v) @> ${JSON.stringify(before.variant)}::jsonb
        and to_jsonb(w) @> ${JSON.stringify(before.source)}::jsonb`)).rows[0]
    if(!current) throw stale()
  }
  await executeStatements(context.tx,patches.map(({id,...values})=>updateRows('vocab_word_variant',values,sql`id=${id}::uuid`,true)))
  const generated=new Set(generatedIds)
  const cacheRows=patches.filter(patch=>generated.has(patch.id) && patch.meaning).map(patch=>{
    const original=snapshots.get(patch.id)!.variant
    return { word_key:original.word.trim().toLowerCase(),word:original.word,part_of_speech:patch.part_of_speech,
      relation_type:original.relation_type,meaning:patch.meaning,usage_note:patch.usage_note,
      excluded_meanings:patch.excluded_meanings,confidence:patch.confidence }
  })
  const deduped=[...new Map(cacheRows.map(row=>[`${row.word_key}::${row.part_of_speech??''}`,row])).values()]
  if(deduped.length) {
    // Both cache index layouts exist in deployed environments. A failed conflict-target
    // lookup must be rolled back to a savepoint before using the legacy target.
    await context.tx.execute(sql`savepoint vocab_cache_layout`)
    try {
      await executeStatements(context.tx,insertRows('vocab_variant_cache',deduped,['word_key','part_of_speech_key']))
    } catch(error) {
      if(databaseErrorCode(error)!=='42P10') throw error
      await context.tx.execute(sql`rollback to savepoint vocab_cache_layout`)
      await executeStatements(context.tx,insertRows('vocab_variant_cache',deduped,['word_key','part_of_speech_key','relation_type']))
    }
    await context.tx.execute(sql`release savepoint vocab_cache_layout`)
  }
}
