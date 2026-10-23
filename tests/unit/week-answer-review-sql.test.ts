import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const teacher = '00000000-0000-4000-8000-000000000001'
const user = '00000000-0000-4000-8000-000000000002'
const week = '00000000-0000-4000-8000-000000000003'
const cls = '00000000-0000-4000-8000-000000000004'
const row = (n = 1, correct = 4) => ({ question_number: n, sub_label: null, question_style: 'objective', correct_answer: correct,
  correct_answer_text: null, question_text: '원문 문제', evidence_verified: true, reviewed: true, answer_origin: 'source' })

describe('reviewed answer confirmation on real PostgreSQL (PGlite)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table teacher(id uuid primary key,auth_id uuid,approval_status text);
      create table class(id uuid primary key,teacher_id uuid references teacher);
      create table week(id uuid primary key,class_id uuid references class,reading_total int default 0,answer_sheet_path text);
      create table pdf_import_job(id uuid primary key,result jsonb,status text);
      create table concept_tag(id uuid primary key,teacher_id uuid);
      create table exam_question(id uuid primary key default gen_random_uuid(),week_id uuid references week,exam_type text,
        question_number int not null,sub_label text,question_style text,correct_answer int,correct_answer_text text,
        grading_criteria text,explanation text,question_text text,question_stem text,passage text,choices jsonb,
        source_section text,source_question_number int,display_order int,passage_group text,shared_passage text,
        needs_source_image boolean,source_image_reason text,source_page int,source_bbox jsonb);
      create table exam_question_tag(exam_question_id uuid,concept_tag_id uuid);
      create table student_answer(id uuid primary key default gen_random_uuid(),exam_question_id uuid references exam_question,student_answer int,is_correct boolean);
      create table week_score(week_id uuid,reading_correct int);
      insert into teacher values('${teacher}','${user}','approved');
      insert into class values('${cls}','${teacher}');
      insert into week(id,class_id) values('${week}','${cls}');`)
    await db.exec(readFileSync('supabase/migrations/20261023150000_week_answer_review.sql', 'utf8'))
  }, 60000)
  afterAll(async () => db.close())
  beforeEach(async () => {
    await db.exec('truncate week_answer_draft,student_answer,exam_question,exam_question_tag,week_score; update week set reading_total=0;')
  })
  async function draft(answers = [row()], base: unknown[] = []) {
    return (await db.query<{ id: string }>('insert into week_answer_draft(teacher_id,week_id,sources,answers,base_questions) values($1,$2,$3,$4,$5) returning id',
      [teacher, week, '[]', JSON.stringify(answers), JSON.stringify(base)])).rows[0].id
  }
  const confirm = (id: string, answers = [row()], owner = teacher) => db.query('select confirm_week_answer_draft($1,$2,$3,$4)', [id, owner, user, JSON.stringify(answers)])
  const questions = async () => (await db.query<{ id: string; correct_answer: number; question_text: string }>('select * from exam_question order by id')).rows

  it('leaves uploads as drafts, then inserts reviewed keys atomically and idempotently', async () => {
    const id = await draft()
    expect(await questions()).toEqual([])
    await confirm(id)
    await confirm(id)
    expect(await questions()).toHaveLength(1)
    expect((await questions())[0]).toMatchObject({ correct_answer: 4, question_text: '원문 문제' })
    expect((await db.query('select status from week_answer_draft')).rows[0]).toEqual({ status: 'confirmed' })
  })
  it('rolls back earlier inserts and confirmation if a later answer is empty', async () => {
    const rows = [row(), row(2, 0)]
    const id = await draft(rows)
    await expect(confirm(id, rows)).rejects.toThrow('정답이 비어')
    expect(await questions()).toEqual([])
    expect((await db.query('select status from week_answer_draft')).rows[0]).toEqual({ status: 'review' })
    expect((await db.query('select reading_total from week')).rows[0]).toEqual({ reading_total: 0 })
  })
  it('blocks unreviewed or unsupported source answers and forged identities', async () => {
    const id = await draft([{ ...row(), evidence_verified: false }])
    await expect(confirm(id)).rejects.toThrow('원문 근거')
    await expect(confirm(id, [{ ...row(), reviewed: false } as unknown as ReturnType<typeof row>])).rejects.toThrow('검토 정보')
    await expect(confirm(id, [row(2)])).rejects.toThrow('검토 정보')
    await expect(confirm(id, [row()], '00000000-0000-4000-8000-000000000099')).rejects.toThrow('접근 권한')
    expect(await questions()).toEqual([])
  })
  async function existing() {
    const q = (await db.query<{ id: string }>(`insert into exam_question(week_id,exam_type,question_number,sub_label,question_style,correct_answer) values($1,'reading',1,null,'objective',3) returning id`, [week])).rows[0]
    await db.query('insert into student_answer(exam_question_id,student_answer,is_correct) values($1,4,false)', [q.id])
    await db.query('insert into week_score values($1,0)', [week])
    return (await db.query(`select id,question_number,sub_label,question_style,correct_answer,correct_answer_text,source_section,source_question_number from exam_question order by id`)).rows
  }
  it('preserves original IDs, keys, student work and score rows even after confirming a reparse', async () => {
    const base = await existing()
    const id = await draft([row()], base)
    const before = { q: await questions(), a: (await db.query('select * from student_answer')).rows, s: (await db.query('select * from week_score')).rows }
    await expect(confirm(id)).rejects.toThrow('기존 정답')
    await confirm(id, [{ ...row(1, 3), answer_origin: 'existing' }])
    expect({ q: await questions(), a: (await db.query('select * from student_answer')).rows, s: (await db.query('select * from week_score')).rows }).toEqual(before)
  })
  it('rejects a stale draft when an answer key changes while being reviewed', async () => {
    const base = await existing()
    const id = await draft([row()], base)
    await db.exec('update exam_question set correct_answer=2')
    await expect(confirm(id)).rejects.toThrow('검토 중 기존 정답')
    expect((await questions())[0].correct_answer).toBe(2)
  })
})
