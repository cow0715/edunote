import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('preserves populated legacy records and photo links when the migration is applied and reapplied', async () => {
  const db = new PGlite()
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  try {
    await db.exec(readFileSync('tests/fixtures/atomic-grade-schema.sql', 'utf8'))
    await db.exec(`insert into teacher values('${id(1)}','${id(2)}','approved');
      insert into class values('${id(3)}','${id(1)}');
      insert into class_student values('${id(3)}','${id(4)}');
      insert into week values('${id(5)}','${id(3)}',1,1);
      insert into week_score(id,week_id,student_id,vocab_correct,reading_correct,memo,exam_photo_path,vocab_photo_path)
        values('${id(6)}','${id(5)}','${id(4)}',1,1,'기존 메모','old/reading.jpg','old/vocab.jpg');
      insert into exam_question(id,week_id) values('${id(7)}','${id(5)}');
      insert into student_answer(week_score_id,exam_question_id,is_correct,teacher_confirmed,ai_feedback)
        values('${id(6)}','${id(7)}',true,true,'기존 피드백');
      insert into vocab_word values('${id(8)}','${id(5)}',1,'alpha');
      insert into student_vocab_answer(week_score_id,vocab_word_id,is_correct,teacher_locked)
        values('${id(6)}','${id(8)}',true,true);`)
    const snapshot = async () => (await db.query(`select jsonb_build_object(
      'scores',(select jsonb_agg(to_jsonb(s)-'grade_revision') from week_score s),
      'answers',(select jsonb_agg(to_jsonb(a)) from student_answer a),
      'vocab',(select jsonb_agg(to_jsonb(a)) from student_vocab_answer a),
      'weeks',(select jsonb_agg(to_jsonb(w)) from week w)) as value`)).rows
    const before = await snapshot()
    const migration = readFileSync('supabase/migrations/20261029114636_atomic_grade_saves.sql', 'utf8')
    await db.exec(migration)
    expect(await snapshot()).toEqual(before)
    expect((await db.query('select grade_revision from week_score')).rows).toEqual([{ grade_revision: 0 }])
    await db.exec(migration)
    expect(await snapshot()).toEqual(before)
    // Existing direct teacher-confirmation writes and the new recalc work under the authenticated role.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(2)])
    await db.exec('set role authenticated')
    await db.query('update student_answer set is_correct=false where week_score_id=$1', [id(6)])
    await db.query('select recalculate_reading_scores($1::uuid[])', [[id(6)]])
    expect((await db.query('select reading_correct,memo,exam_photo_path,vocab_photo_path from week_score')).rows)
      .toEqual([{ reading_correct: '0', memo: '기존 메모', exam_photo_path: 'old/reading.jpg', vocab_photo_path: 'old/vocab.jpg' }])
  } finally {
    await db.close()
  }
}, 30000)
