import { getAuth, getTeacherId, err, ok } from '@/lib/api'

const DEFAULT_CATEGORIES = [
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

export async function POST() {
  const { supabase, user } = await getAuth()
  if (!user) return err('인증 필요', 401)

  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)

  // 기존 태그 → 카테고리 순으로 삭제
  await supabase.from('concept_tag').delete().eq('teacher_id', teacherId)
  await supabase.from('concept_category').delete().eq('teacher_id', teacherId)

  // 새 데이터 삽입
  for (let catIdx = 0; catIdx < DEFAULT_CATEGORIES.length; catIdx++) {
    const cat = DEFAULT_CATEGORIES[catIdx]

    const { data: newCat, error: catErr } = await supabase
      .from('concept_category')
      .insert({ teacher_id: teacherId, name: cat.name, sort_order: catIdx })
      .select('id')
      .single()

    if (catErr || !newCat) {
      return err(`카테고리 삽입 실패: ${catErr?.message}`, 500)
    }

    const tagRows = cat.tags.map((name, tagIdx) => ({
      teacher_id: teacherId,
      concept_category_id: newCat.id,
      name,
      sort_order: tagIdx,
    }))

    const { error: tagErr } = await supabase.from('concept_tag').insert(tagRows)
    if (tagErr) {
      return err(`태그 삽입 실패: ${tagErr.message}`, 500)
    }
  }

  return ok({ ok: true })
}
