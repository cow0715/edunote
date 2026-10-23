import 'server-only'
import { sql } from 'drizzle-orm'
import type { TeacherTransaction } from '@/lib/db/transaction'

export const DEFAULT_CATEGORIES = [
  {
    name: '독해 유형',
    tags: [
      '글의 목적 파악',
      '심경/분위기',
      '주장',
      '함의 추론',
      '요지',
      '주제',
      '제목',
      '도표',
      '내용 일치',
      '어법',
      '어휘',
      '빈칸',
      '무관한 문장',
      '순서',
      '삽입',
      '요약',
      '장문(1)',
      '장문(2)',
    ],
  },
  {
    name: '문법 유형',
    tags: [
      '수의 일치',
      '시제',
      '수동태',
      'to부정사',
      '동명사',
      '분사',
      '대명사',
      '형용사/부사',
      '관계사',
      '접속사/전치사',
      '병렬구조/비교',
      '특수구문',
      '가정법/조동사',
    ],
  },
  {
    name: '서술형 유형',
    tags: [
      '배열',
      '영작',
      '문장전환',
      '어법',
      '어휘',
      '빈칸',
      '지칭 내용',
      '세부 내용',
      '요약문',
      '중심 내용',
    ],
  },
]

/** Deletion (including FK cascades) and replacement must either all commit or all roll back. */
export async function resetConceptDefaults({ tx, teacherId }: TeacherTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'concept-defaults:' + teacherId},0))`)
  await tx.execute(sql`delete from public.concept_tag where teacher_id=${teacherId}::uuid`)
  await tx.execute(sql`delete from public.concept_category where teacher_id=${teacherId}::uuid`)
  for (const [sortOrder, category] of DEFAULT_CATEGORIES.entries()) {
    const created = (await tx.execute(sql`insert into public.concept_category(teacher_id,name,sort_order)
      values(${teacherId}::uuid,${category.name},${sortOrder}) returning id`)).rows[0]
    await tx.execute(sql`insert into public.concept_tag(teacher_id,concept_category_id,name,sort_order)
      values ${sql.join(category.tags.map((name, index) => sql`(${teacherId}::uuid,${created.id}::uuid,${name},${index})`),sql`, `)}`)
  }
  return { ok: true }
}
