import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('creates a single recoverable job for 15 students and restricts access to the service role', async () => {
  const db = new PGlite()
  try {
    await db.exec(readFileSync('tests/fixtures/atomic-grade-schema.sql', 'utf8'))
    await db.exec('create table student(id uuid primary key);')
    const migration = readFileSync('supabase/migrations/20261112000001_exam_photo_jobs.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    await db.exec(readFileSync('supabase/migrations/20261112000002_exam_photo_job_review.sql', 'utf8'))

    const ids = Array.from({ length: 19 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
    const [teacher, classId, week, unrelated, ...students] = ids
    await db.query('insert into teacher (id, auth_id) values ($1, $1)', [teacher])
    await db.query('insert into class values ($1, $2)', [classId, teacher])
    await db.query('insert into week (id, class_id) values ($1, $2)', [week, classId])
    await db.query('insert into student select unnest($1::uuid[])', [[...students, unrelated]])
    await db.query('insert into class_student select $1::uuid, unnest($2::uuid[])', [classId, students])

    const start = (roster: string[]) => db.query<{ id: string }>(
      'select start_exam_photo_job($1, $2, $3::uuid[]) as id', [week, teacher, roster],
    )
    await db.exec('set role authenticated')
    await expect(start(students)).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; alter role service_role bypassrls; grant select on week, class, class_student to service_role; set role service_role;')
    await expect(start([unrelated])).rejects.toMatchObject({ code: '22023' })
    const { rows: [{ id }] } = await start(students)
    await expect(start(students)).rejects.toMatchObject({ code: '23505' })
    const path = `${week}/${students[0]}/${id}`
    await db.query('update exam_photo_job_item set photo_path = $1, ocr_results = $2 where job_id = $3 and student_id = $4',
      [path, JSON.stringify([{ question_number: 1, student_answer: 2 }]), id, students[0]])
    const recovered = await db.query('select photo_path, ocr_results from exam_photo_job_item where job_id = $1', [id])
    expect(recovered.rows).toHaveLength(15)
    expect(recovered.rows).toContainEqual({ photo_path: path, ocr_results: [{ question_number: 1, student_answer: 2 }] })

    const initial = { student_id: students[0], exam_photo_path: path, answers: [{ student_answer_text: 'first' }] }
    const saveInitial = () => db.query('select save_initial_exam_photo_grades($1, $2, $3, $4)', [id, week, teacher, JSON.stringify([initial])])
    await saveInitial()
    await db.query('update exam_photo_job_item set grade_draft = $1, grade_draft_revision = 2 where job_id = $2 and student_id = $3 and grade_draft_revision = 1',
      [JSON.stringify({ ...initial, answers: [{ student_answer_text: 'edited', teacher_confirmed: true }] }), id, students[0]])
    await expect(saveInitial()).rejects.toMatchObject({ code: '40001' })
    const restored = await db.query('select grade_draft, grade_draft_revision from exam_photo_job_item where job_id = $1 and student_id = $2', [id, students[0]])
    expect(restored.rows[0]).toEqual({ grade_draft: { ...initial, answers: [{ student_answer_text: 'edited', teacher_confirmed: true }] }, grade_draft_revision: 2 })

    await db.exec('reset role')
    await db.exec(readFileSync('supabase/migrations/20261029114636_atomic_grade_saves.sql', 'utf8'))
    await db.exec(readFileSync('supabase/migrations/20261113000001_finalize_exam_photo_job.sql', 'utf8'))
    await db.query("insert into exam_question (id, week_id) values ($1, $2)", [unrelated, week])
    await db.query(`update exam_photo_job_item set
      photo_path = $1 || '/' || student_id || '/' || $2,
      grade_draft = coalesce(grade_draft, '{}'::jsonb) where job_id = $2::uuid`, [week, id])
    const rows = students.map((studentId) => ({
      student_id: studentId, score_id: studentId, expected_revision: null,
      present: true, reading_present: true, exam_photo_path: `${week}/${studentId}/${id}`,
      answers: [{ exam_question_id: unrelated, student_answer: 1, is_correct: true }],
    }))
    const commit = (submitted = rows) => db.query<{ result: { versions: unknown[]; replayed: boolean } }>(
      'select finalize_exam_photo_job($1, $2, $3) as result', [week, id, JSON.stringify(submitted)],
    )
    await db.exec("set role authenticated")
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [unrelated])
    await expect(commit()).rejects.toMatchObject({ code: '42501' })
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [teacher])
    await expect(commit([{ ...rows[0], exam_photo_path: 'wrong-path' }])).rejects.toMatchObject({ code: '22023' })
    const writeVersions = () => db.query(
      'select id, xmin::text from week_score union all select id, xmin::text from student_answer order by id, xmin',
    )
    const first = (await commit()).rows[0].result
    expect(first.replayed).toBe(false)
    expect(first.versions).toHaveLength(15)
    const afterCommit = await writeVersions()
    expect(afterCommit.rows).toHaveLength(30)
    const replay = (await commit([...rows].reverse())).rows[0].result
    expect(replay.replayed).toBe(true)
    expect(replay.versions).toEqual(expect.arrayContaining(first.versions))
    expect(await writeVersions()).toEqual(afterCommit)
    await db.exec('reset role')
    expect((await db.query('select closed_at is not null as closed from exam_photo_job where id = $1', [id])).rows)
      .toEqual([{ closed: true }])
  } finally {
    await db.close()
  }
}, 30_000)
