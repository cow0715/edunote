/**
 * 저장된 is_correct 를 실제 채점 함수로 재계산해 비교한다 (읽기 전용 — 고치지 않고 보고만 한다).
 * 채점 로직을 고친 뒤, 그 전에 저장된 결과가 틀어져 있는지 확인하는 용도.
 * 서술형과 find_error 의 AI 판정은 재현할 수 없어 건너뛴다.
 *
 * 실행: npx tsx scripts/audit-answers.ts
 *
 * 접속 정보를 .env.local 에서만 읽으므로 **항상 개발 DB** 를 본다. 인자로는 전환되지 않는다.
 * 운영 DB 를 감사하려면 .env.local 의 URL/SERVICE_ROLE_KEY 를 운영 것으로 임시 교체해야 한다.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { gradeMultiSelect } from '../src/lib/grade-utils'
import { gradeOX, parseOXStudentInput } from '../src/lib/ox-grading'
import { gradeFindErrorRow } from '../src/lib/find-error-grading'
import { gradeObjective } from '../src/lib/objective-grading'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

type Q = {
  id: string; week_id: string; question_number: number; sub_label: string | null
  question_style: string; correct_answer: number | null; correct_answer_text: string | null
  extra_correct_answers: number[] | null; all_correct: boolean | null; is_void: boolean | null
}
type A = {
  id: string; exam_question_id: string; is_correct: boolean
  student_answer: number | null; student_answer_text: string | null
}

async function pageAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
const questions = await pageAll<Q>('exam_question',
  'id,week_id,question_number,sub_label,question_style,correct_answer,correct_answer_text,extra_correct_answers,all_correct,is_void')
const answers = await pageAll<A>('student_answer',
  'id,exam_question_id,is_correct,student_answer,student_answer_text')

const qById = new Map(questions.map((q) => [q.id, q]))
// find_error 는 같은 문항 번호의 정답키 전체를 넘겨야 순서 무관 비교가 된다
const feKeys = new Map<string, (string | null)[]>()
for (const q of questions) {
  if (q.question_style !== 'find_error') continue
  const k = `${q.week_id}|${q.question_number}`
  feKeys.set(k, [...(feKeys.get(k) ?? []), q.correct_answer_text])
}

const stat: Record<string, { total: number; checked: number; mismatch: number; skipped: number }> = {}
const samples: Record<string, string[]> = {}

for (const a of answers) {
  const q = qById.get(a.exam_question_id)
  if (!q) continue
  const s = (stat[q.question_style] ??= { total: 0, checked: 0, mismatch: 0, skipped: 0 })
  s.total++

  let expected: boolean | undefined
  if (q.question_style === 'objective') {
    expected = gradeObjective(q, a.student_answer)
  } else if (q.question_style === 'multi_select') {
    expected = q.correct_answer_text ? gradeMultiSelect(q.correct_answer_text, a.student_answer_text ?? '') : undefined
  } else if (q.question_style === 'ox') {
    if (!q.correct_answer_text) expected = undefined
    else {
      const { oxSelection, correction } = parseOXStudentInput(a.student_answer_text)
      expected = gradeOX(q.correct_answer_text, oxSelection, correction ?? '')
    }
  } else if (q.question_style === 'find_error') {
    const v = gradeFindErrorRow(feKeys.get(`${q.week_id}|${q.question_number}`) ?? [], a.student_answer_text)
    expected = v === 'ai' ? undefined : v === 'correct'   // ai 판정은 재현 불가
  } else {
    expected = undefined                                   // subjective = AI 채점
  }

  if (expected === undefined) { s.skipped++; continue }
  s.checked++
  if (expected !== a.is_correct) {
    s.mismatch++
    const arr = (samples[q.question_style] ??= [])
    if (arr.length < 6) {
      arr.push(`Q${q.question_number}${q.sub_label ?? ''} void=${!!q.is_void} all=${!!q.all_correct} ` +
        `저장=${a.is_correct} 재계산=${expected} 학생=${JSON.stringify(a.student_answer ?? a.student_answer_text)} 정답=${JSON.stringify(q.correct_answer_text ?? q.correct_answer)}`)
    }
  }
}

console.log('문항', questions.length, '/ 답안', answers.length)
console.table(stat)
for (const [k, v] of Object.entries(samples)) { console.log(`\n[${k}] 불일치 표본`); v.forEach((x) => console.log('  ', x)) }
}

main().catch((e) => { console.error(e); process.exit(1) })
