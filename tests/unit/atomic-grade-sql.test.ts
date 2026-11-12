import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = id(1), teacher = id(2), cls = id(3), week = id(4)
const student = id(5), otherStudent = id(6), score = id(7), otherScore = id(8)
const q1 = id(9), q2 = id(10), w1 = id(11), w2 = id(12)
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync('tests/fixtures/atomic-grade-schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261029114636_atomic_grade_saves.sql', 'utf8'))
  // Reapplying a manually executed migration must also be safe.
  await db.exec(readFileSync('supabase/migrations/20261029114636_atomic_grade_saves.sql', 'utf8'))
}, 30000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('reset role; alter table student_vocab_answer drop constraint if exists simulated_failure; truncate teacher,class,class_student,week,exam_question,week_score,student_answer,vocab_word,vocab_word_variant,vocab_test,vocab_test_item,student_vocab_answer cascade;')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user])
  await db.exec(`insert into teacher values('${teacher}','${user}','approved');
    insert into class values('${cls}','${teacher}');
    insert into class_student values('${cls}','${student}'),('${cls}','${otherStudent}');
    insert into week values('${week}','${cls}',2,2);
    insert into exam_question(id,week_id) values('${q1}','${week}'),('${q2}','${week}');
    insert into week_score(id,week_id,student_id,vocab_correct,reading_correct,memo) values
      ('${score}','${week}','${student}',2,1,'original'),('${otherScore}','${week}','${otherStudent}',null,null,'original');
    insert into student_answer(week_score_id,exam_question_id,student_answer_text,is_correct) values
      ('${score}','${q1}','old',true),('${score}','${q2}','old',false);
    insert into vocab_word values('${w1}','${week}',1,'alpha'),('${w2}','${week}',2,'beta');
    insert into student_vocab_answer(week_score_id,vocab_word_id,test_number,student_answer,is_correct) values
      ('${score}','${w1}',1,'a',true),('${score}','${w2}',2,'b',true);`)
})

async function revision(target = score) {
  const { rows } = await db.query<{ grade_revision: number }>('select grade_revision from week_score where id=$1', [target])
  return Number(rows[0].grade_revision)
}
async function readingRow(target = score, targetStudent = student) {
  return { score_id: target, student_id: targetStudent, expected_revision: await revision(target), present: true,
    reading_present: true, vocab_correct: 2, reading_correct: 0, homework_done: null, memo: 'new',
    answers: [{ exam_question_id: q1, student_answer: null, student_answer_text: 'new', ox_selection: null,
      is_correct: false, needs_review: false, teacher_confirmed: false }] }
}
function saveReading(rows: unknown[]) {
  return db.query<{ save_week_reading_grades: { student_id: string; score_id: string | null; revision: number | null }[] }>(
    'select save_week_reading_grades($1,$2::jsonb)', [week, JSON.stringify(rows)])
}
async function vocabArgs() {
  return [week, student, score, await revision(), null, '[]', JSON.stringify([
    { vocab_word_id: w1, test_number: 1, student_answer: 'wrong', is_correct: false },
    { vocab_word_id: w2, test_number: 2, student_answer: 'wrong', is_correct: false },
  ]), `${week}/${student}/new-photo`]
}
function saveVocab(args: unknown[]) {
  return db.query<{ result: { vocab_correct: number; vocab_total: number } }>('select save_week_vocab_grade($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) as result', args)
}
async function snapshot() {
  return (await db.query("select jsonb_build_object('scores',(select jsonb_agg(to_jsonb(s) order by id) from week_score s),'answers',(select jsonb_agg(to_jsonb(a) order by id) from student_answer a),'vocab',(select jsonb_agg(to_jsonb(a) order by id) from student_vocab_answer a)) as value")).rows
}

describe('actual PostgreSQL grade transactions, without external data', () => {
  async function editVocab(answers: unknown[], regrade = false, expectedRevision?: number, test: string | null = null) {
    return db.query('select save_vocab_answer_edits($1,$2,$3::jsonb,$4,$5)',
      [score, expectedRevision ?? await revision(), JSON.stringify(answers), regrade, test])
  }
  async function answerId(word = w1) {
    return (await db.query<{ id: string }>('select id from student_vocab_answer where week_score_id=$1 and vocab_word_id=$2', [score, word])).rows[0].id
  }
  it('rolls back edited vocab answers and total when a later write fails', async () => {
    await db.exec("alter table student_vocab_answer add constraint simulated_failure check(student_answer<>'reject')")
    const before = await snapshot()
    await expect(editVocab([{ id: await answerId(), student_answer: 'changed', is_correct: false },
      { id: await answerId(w2), student_answer: 'reject', is_correct: false }])).rejects.toThrow('simulated_failure')
    expect(await snapshot()).toEqual(before)
  })
  it('preserves teacher locks against both stale and fresh AI regrade requests', async () => {
    const oldRevision = await revision(), aid = await answerId()
    await db.query('update student_vocab_answer set teacher_locked=true where id=$1', [aid])
    const before = await snapshot(), edits = [{ id: aid, student_answer: 'AI old', is_correct: false }]
    await expect(editVocab(edits, true, oldRevision)).rejects.toThrow('답안이 변경')
    await expect(editVocab(edits, true)).rejects.toThrow('교사 확정')
    expect(await snapshot()).toEqual(before)
  })
  it('counts only active vocab test answers and supports authenticated manual confirmation', async () => {
    const test = id(100), aid = await answerId()
    await db.query('insert into vocab_test(id,week_id,is_active) values($1,$2,true)', [test, week])
    await db.query('insert into vocab_test_item values($1,$2,1,null)', [test, w1])
    await db.exec('set role authenticated')
    try {
      await editVocab([{ id: aid, student_answer: 'wrong', is_correct: false, teacher_locked: true }], false, undefined, test)
    } finally { await db.exec('reset role') }
    expect((await db.query('select vocab_correct from week_score where id=$1', [score])).rows).toEqual([{ vocab_correct: 0 }])
  })
  it('rejects an edited-vocab commit when its active test changed during grading', async () => {
    const aid = await answerId(), rev = await revision()
    await db.query('insert into vocab_test(id,week_id,is_active) values($1,$2,true)', [id(100), week])
    const before = await snapshot()
    await expect(editVocab([{ id: aid, student_answer: 'old test', is_correct: false }], true, rev)).rejects.toThrow('시험지가 변경')
    expect(await snapshot()).toEqual(before)
  })
  it('does not update answers or totals when reading the edited vocab state is denied', async () => {
    const aid = await answerId(), rev = await revision(), before = await snapshot()
    await db.exec('revoke select on student_vocab_answer from authenticated; set role authenticated')
    try {
      await expect(editVocab([{ id: aid, student_answer: 'changed', is_correct: false }], false, rev)).rejects.toThrow('permission denied')
    } finally { await db.exec('reset role; grant select on student_vocab_answer to authenticated') }
    expect(await snapshot()).toEqual(before)
  })
  it('commits a reading photo receipt with its answers and retains the old photo on rollback', async () => {
    await db.query("update week_score set exam_photo_path='old-photo' where id=$1", [score])
    const row = { ...await readingRow(), exam_photo_path: `${week}/${student}/new-photo` }
    const invalid = await readingRow(otherScore, otherStudent)
    invalid.answers[0].exam_question_id = id(999)
    await expect(saveReading([row, invalid])).rejects.toThrow('문항이 변경')
    expect((await db.query('select exam_photo_path from week_score where id=$1', [score])).rows).toEqual([{ exam_photo_path: 'old-photo' }])
    await saveReading([row])
    expect((await db.query('select exam_photo_path from week_score where id=$1', [score])).rows).toEqual([{ exam_photo_path: row.exam_photo_path }])
  })
  it('preserves fractional homework values in both metadata and full grade saves', async () => {
    await db.query('select save_week_grade_metadata($1,$2,$3,$4,$5)', [week, student, score, await revision(), { homework_done: 1.5 }])
    expect(Number((await db.query<{ homework_done: string }>('select homework_done from week_score where id=$1', [score])).rows[0].homework_done)).toBe(1.5)
    await saveReading([{ ...await readingRow(), homework_done: 2.5 }])
    expect(Number((await db.query<{ homework_done: string }>('select homework_done from week_score where id=$1', [score])).rows[0].homework_done)).toBe(2.5)
  })
  it('supports reading → vocab → refreshed reading regrade, rejecting the stale intermediate screen', async () => {
    await saveReading([await readingRow()])
    const stale = await readingRow()
    const readingAnswers = (await db.query('select * from student_answer order by id')).rows
    await saveVocab(await vocabArgs())
    expect((await db.query('select * from student_answer order by id')).rows).toEqual(readingAnswers)
    const afterVocab = await snapshot()
    await expect(saveReading([stale])).rejects.toThrow('답안이 변경')
    expect(await snapshot()).toEqual(afterVocab)
    const fresh = { ...await readingRow(), vocab_correct: 0 }
    fresh.answers[0].is_correct = true
    await saveReading([fresh])
    expect((await db.query('select vocab_correct,reading_correct,vocab_photo_path from week_score where id=$1', [score])).rows)
      .toEqual([{ vocab_correct: 0, reading_correct: '1', vocab_photo_path: `${week}/${student}/new-photo` }])
  })
  it('returns versions and keeps a repeated identical reading save at the same version', async () => {
    await saveReading([await readingRow()])
    const row = await readingRow(), current = await revision()
    const result = await saveReading([row])
    expect(result.rows[0].save_week_reading_grades).toEqual([{ student_id: student, score_id: score, revision: current }])
    expect(await revision()).toBe(current)
  })
  it('adopts only a newly created photo-only parent for an initially unsaved student', async () => {
    await db.query('delete from week_score where id=$1', [otherScore])
    await db.query('insert into week_score(id,week_id,student_id,exam_photo_path) values($1,$2,$3,$4)',
      [otherScore, week, otherStudent, `${week}/${otherStudent}`])
    const row = { ...await readingRow(), student_id: otherStudent, score_id: id(888), expected_revision: null }
    const result = await saveReading([row])
    expect(result.rows[0].save_week_reading_grades).toEqual([
      expect.objectContaining({ student_id: otherStudent, score_id: otherScore }),
    ])
    expect((await db.query('select week_score_id from student_answer where week_score_id=$1', [otherScore])).rows).toHaveLength(1)
  })
  it('does not adopt a photo-linked parent that already contains saved metadata', async () => {
    await db.query("update week_score set exam_photo_path='photo' where id=$1", [otherScore])
    const row = { ...await readingRow(), student_id: otherStudent, score_id: id(888), expected_revision: null }
    const before = await snapshot()
    await expect(saveReading([row])).rejects.toThrow('다른 저장')
    expect(await snapshot()).toEqual(before)
  })
  it('guards metadata saves, preserves omitted fields, and returns versions without no-op bumps', async () => {
    await db.query('update week_score set homework_done=3 where id=$1', [score])
    const stale = await readingRow()
    const args = [week, student, score, await revision(), JSON.stringify({ memo: 'metadata changed' })]
    const result = await db.query<{ saved: { revision: number }[] }>(
      'select save_week_grade_metadata($1,$2,$3,$4,$5::jsonb) as saved', args)
    const current = result.rows[0].saved[0].revision
    expect((await db.query('select homework_done,memo from week_score where id=$1', [score])).rows)
      .toEqual([{ homework_done: '3', memo: 'metadata changed' }])
    await expect(saveReading([stale])).rejects.toThrow('답안이 변경')
    await expect(db.query('select save_week_grade_metadata($1,$2,$3,$4,$5::jsonb)', args)).rejects.toThrow('답안이 변경')
    args[3] = current
    await db.query('select save_week_grade_metadata($1,$2,$3,$4,$5::jsonb)', args)
    expect(await revision()).toBe(current)
  })
  it('rejects an old screen version even when the score was deleted and recreated', async () => {
    const row = await readingRow()
    await db.query('delete from week_score where id=$1', [score])
    await db.query('insert into week_score(id,week_id,student_id,grade_revision) values($1,$2,$3,$4)',
      [id(777), week, student, row.expected_revision])
    await expect(saveReading([row])).rejects.toThrow('답안이 변경')
  })
  it('preserves historical reading answers and both photo links when saving non-participation', async () => {
    await db.query("update week_score set exam_photo_path='old/reading',vocab_photo_path='old/vocab' where id=$1", [score])
    const answers = (await db.query('select * from student_answer order by id')).rows
    const row = { ...await readingRow(), reading_present: false, answers: [] }
    await saveReading([row])
    expect((await db.query('select * from student_answer order by id')).rows).toEqual(answers)
    expect((await db.query('select reading_correct,exam_photo_path,vocab_photo_path from week_score where id=$1', [score])).rows)
      .toEqual([{ reading_correct: null, exam_photo_path: 'old/reading', vocab_photo_path: 'old/vocab' }])
  })
  it('does not invalidate an in-flight grade for unchanged answers, score recalculation or photo linkage', async () => {
    const pending = await readingRow()
    await db.query('update student_answer set student_answer_text=student_answer_text where week_score_id=$1', [score])
    await db.query('update student_vocab_answer set is_correct=is_correct where week_score_id=$1', [score])
    await db.query("update week_score set exam_photo_path='photo' where id=$1", [score])
    await db.query('select recalculate_reading_scores($1::uuid[])', [[score]])
    expect(await revision()).toBe(pending.expected_revision)
    await saveReading([pending])
  })
  it('rolls back the first student and score when a later student has an invalid question', async () => {
    const before = await snapshot()
    const first = await readingRow(), second = await readingRow(otherScore, otherStudent)
    second.answers[0].exam_question_id = id(999)
    await expect(saveReading([first, second])).rejects.toThrow('시험 문항이 변경')
    expect(await snapshot()).toEqual(before)
  })
  it('rejects a delayed AI result after a newer draft, preserving the newer answer and verdict', async () => {
    const old = await readingRow()
    const newer = { ...old, answers: [{ ...old.answers[0], student_answer_text: 'newer answer' }] }
    await saveReading([newer])
    old.answers[0].is_correct = true
    await expect(saveReading([old])).rejects.toThrow('답안이 변경')
    const { rows } = await db.query('select student_answer_text,is_correct from student_answer where week_score_id=$1 and exam_question_id=$2', [score, q1])
    expect(rows[0]).toEqual({ student_answer_text: 'newer answer', is_correct: false })
  })
  it('detects edits even if the answer text changes away and then back', async () => {
    const old = await readingRow()
    await db.query("update student_answer set student_answer_text='temporary' where week_score_id=$1", [score])
    await db.query("update student_answer set student_answer_text='old' where week_score_id=$1", [score])
    await expect(saveReading([old])).rejects.toThrow('답안이 변경')
  })
  it('teacher confirmation invalidates a pending AI result', async () => {
    const old = await readingRow()
    await db.query('update student_answer set teacher_confirmed=true where week_score_id=$1', [score])
    await expect(saveReading([old])).rejects.toThrow('답안이 변경')
    expect((await db.query<{ confirmed: boolean }>('select bool_and(teacher_confirmed) as confirmed from student_answer where week_score_id=$1', [score])).rows[0].confirmed).toBe(true)
  })
  it('rejects incomplete vocab regrading without mixing it with old answers or totals', async () => {
    const before = await snapshot(), args = await vocabArgs()
    args[6] = JSON.stringify([{ vocab_word_id: w1, test_number: 1, student_answer: 'wrong', is_correct: false }])
    await expect(saveVocab(args)).rejects.toThrow('일부 문항')
    expect(await snapshot()).toEqual(before)
  })
  it('rolls back vocab answers, totals and photo linkage if an answer write fails', async () => {
    await db.exec("alter table student_vocab_answer add constraint simulated_failure check(student_answer<>'reject')")
    const before = await snapshot(), args = await vocabArgs()
    args[6] = JSON.stringify([{ vocab_word_id: w1, test_number: 1, student_answer: 'changed', is_correct: false },
      { vocab_word_id: w2, test_number: 2, student_answer: 'reject', is_correct: false }])
    await expect(saveVocab(args)).rejects.toThrow('simulated_failure')
    expect(await snapshot()).toEqual(before)
  })
  it('derives vocab score from committed answers while preserving teacher-locked answers', async () => {
    await db.query('update student_vocab_answer set teacher_locked=true where vocab_word_id=$1', [w2])
    const { rows } = await saveVocab(await vocabArgs())
    expect(rows[0].result).toEqual({ vocab_correct: 1, vocab_total: 2 })
    const actual = await db.query<{ correct: number }>('select count(*)::int as correct from student_vocab_answer where week_score_id=$1 and is_correct', [score])
    expect(actual.rows[0].correct).toBe(1)
    expect((await db.query<{ student_answer: string }>('select student_answer from student_vocab_answer where vocab_word_id=$1', [w2])).rows[0].student_answer).toBe('b')
  })
  it('rejects an old vocab result after another save changes the student', async () => {
    const args = await vocabArgs()
    await saveReading([await readingRow()])
    const before = await snapshot()
    await expect(saveVocab(args)).rejects.toThrow('답안이 변경')
    expect(await snapshot()).toEqual(before)
  })
  it('rejects changed active tests and duplicate OCR mappings', async () => {
    const args = await vocabArgs()
    args[6] = JSON.stringify([{ vocab_word_id: w1, test_number: 1 }, { vocab_word_id: w1, test_number: 1 }])
    await expect(saveVocab(args)).rejects.toThrow('문항 연결')
    await db.query('insert into vocab_test(id,week_id,is_active) values($1,$2,true)', [id(100), week])
    await expect(saveVocab(await vocabArgs())).rejects.toThrow('시험지가 변경')
  })
  it('enforces ownership within the RPC, not just in the HTTP handler', async () => {
    const row = await readingRow(), before = await snapshot()
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(999)])
    await expect(saveReading([row])).rejects.toThrow('권한')
    expect(await snapshot()).toEqual(before)
  })
  it('does not clear scores when answer reads are denied', async () => {
    const before = await snapshot()
    await db.exec('revoke select on student_answer from authenticated; set role authenticated;')
    try {
      await expect(db.query('select recalculate_reading_scores($1::uuid[])', [[score]])).rejects.toThrow('permission denied')
    } finally { await db.exec('reset role; grant select on student_answer to authenticated;') }
    expect(await snapshot()).toEqual(before)
  })
  it('recalculates and commits reading totals together with answer changes', async () => {
    const row = await readingRow()
    row.answers[0].is_correct = true
    await saveReading([row])
    expect((await db.query<{ reading_correct: string }>('select reading_correct from week_score where id=$1', [score])).rows[0].reading_correct).toBe('1')
  })
  it('runs successfully with authenticated invoker privileges rather than a privileged function', async () => {
    const row = await readingRow()
    await db.exec('set role authenticated;')
    try { await saveReading([row]) } finally { await db.exec('reset role;') }
    expect((await db.query<{ memo: string }>('select memo from week_score where id=$1', [score])).rows[0].memo).toBe('new')
  })
  it('supports the complete active test and rejects a changed item mapping', async () => {
    const test = id(100)
    await db.query('insert into vocab_test(id,week_id,is_active) values($1,$2,true)', [test, week])
    await db.exec(`insert into vocab_test_item values('${test}','${w1}',1,null),('${test}','${w2}',2,null)`)
    const args = await vocabArgs()
    args[4] = test
    expect((await saveVocab(args)).rows[0].result).toEqual({ vocab_correct: 0, vocab_total: 2 })
    const changed = await vocabArgs()
    changed[4] = test
    await db.query('update vocab_test_item set test_number=99 where vocab_word_id=$1', [w2])
    const before = await snapshot()
    await expect(saveVocab(changed)).rejects.toThrow('시험 문항이 변경')
    expect(await snapshot()).toEqual(before)
  })
  it('creates a complete legacy word list and its answers in the same transaction', async () => {
    await db.exec('delete from vocab_word;')
    const args = await vocabArgs()
    args[5] = JSON.stringify([{ number: 1, english_word: 'alpha' }, { number: 2, english_word: 'beta' }])
    args[6] = JSON.stringify([{ test_number: 1, student_answer: 'a', is_correct: true }, { test_number: 2, student_answer: 'wrong', is_correct: false }])
    expect((await saveVocab(args)).rows[0].result).toEqual({ vocab_correct: 1, vocab_total: 2 })
    expect((await db.query<{ count: number }>('select count(*)::int as count from vocab_word')).rows[0].count).toBe(2)
  })
  it('retains the existing absence-save behavior without revision triggers breaking cascading deletes', async () => {
    const row = { ...await readingRow(), present: false, answers: [] }
    await saveReading([row])
    expect((await db.query<{ count: number }>('select count(*)::int as count from week_score where id=$1', [score])).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>('select count(*)::int as count from student_answer where week_score_id=$1', [score])).rows[0].count).toBe(0)
  })
})
