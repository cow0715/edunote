// ── 수능 유형 영역 매핑 ──────────────────────────────────────────────────
// 모의고사 형태로만 시험을 보는 반(고3 등)은 개념 카테고리가 독해/문법/서술형
// 3개뿐이라 레이더 축이 빈약하다. 이때 태그를 수능 영역 단위로 다시 묶는다.
//
// 매핑 기준은 카테고리가 아니라 **태그 이름**이다. 시드 데이터에서
// '어법'·'어휘'·'빈칸'이 독해 유형과 서술형 유형 양쪽에 중복 존재하고
// (createTagMatcher가 sort_order만 보므로 서술형 쪽이 먼저 잡힌다),
// 이름으로 묶으면 어느 카테고리에 매달려 있든 제자리를 찾는다.

/** 축 표시 순서 — 수능 시험지 문항 번호 순. 레이더는 축 순서가 모양을 지배하므로 고정한다. */
export const EXAM_DOMAIN_ORDER = [
  '대의파악',
  '세부정보',
  '어법·어휘',
  '빈칸추론',
  '글의 흐름',
  '장문',
  '문법',
] as const

const DOMAIN_BY_TAG: Record<string, string> = {
  // 대의파악 (18~24, 40) — 요약문 완성은 글 전체 요지를 압축하는 문제라 여기에 둔다
  '글의 목적 파악': '대의파악',
  '심경/분위기': '대의파악',
  주장: '대의파악',
  요지: '대의파악',
  주제: '대의파악',
  제목: '대의파악',
  요약: '대의파악',
  요약문: '대의파악',
  '중심 내용': '대의파악',

  // 세부정보 (25~28)
  도표: '세부정보',
  '내용 일치': '세부정보',
  '세부 내용': '세부정보',

  // 어법·어휘 (29~30)
  어법: '어법·어휘',
  어휘: '어법·어휘',
  영작: '어법·어휘',
  문장전환: '어법·어휘',

  // 빈칸추론 (21, 31~34)
  빈칸: '빈칸추론',
  '함의 추론': '빈칸추론',

  // 글의 흐름 (35~39) — 평가원 공식 명칭은 '간접쓰기'지만 학부모에게 전달되지 않아 바꿨다
  '무관한 문장': '글의 흐름',
  순서: '글의 흐름',
  삽입: '글의 흐름',
  배열: '글의 흐름',

  // 장문 (41~45)
  '장문(1)': '장문',
  '장문(2)': '장문',
  '지칭 내용': '장문',
}

/** 매핑에 없는 태그는 카테고리명으로 폴백 — 강사가 직접 만든 태그도 축을 잃지 않는다. */
const CATEGORY_ALIAS: Record<string, string> = {
  '문법 유형': '문법',
  '독해 유형': '독해',
  '서술형 유형': '서술형',
}

export function resolveExamDomain(tagName: string, categoryName: string | null): string | null {
  const mapped = DOMAIN_BY_TAG[tagName]
  if (mapped) return mapped
  if (!categoryName) return null
  return CATEGORY_ALIAS[categoryName] ?? categoryName
}

export function compareExamDomain(a: string, b: string): number {
  const order = EXAM_DOMAIN_ORDER as readonly string[]
  const ia = order.indexOf(a)
  const ib = order.indexOf(b)
  if (ia === -1 && ib === -1) return a.localeCompare(b)
  if (ia === -1) return 1
  if (ib === -1) return -1
  return ia - ib
}

/** 레이더 축 설명 — 학부모가 축 이름만 보고 무엇을 묻는 문항인지 알 수 있게 한다. */
const AXIS_DESCRIPTION: Record<string, string> = {
  대의파악: '글 전체가 말하려는 바를 잡아내는 문항 (목적·주제·제목·요지·요약)',
  세부정보: '지문에 적힌 사실을 정확히 확인하는 문항 (도표·내용 일치)',
  '어법·어휘': '문법적 정확성과 문맥에 맞는 단어를 고르는 문항',
  빈칸추론: '드러나지 않은 내용을 논리로 채워 넣는 문항 (빈칸·함의 추론)',
  '글의 흐름': '글이 자연스럽게 이어지는지 판단하는 문항 (순서·삽입·무관한 문장)',
  장문: '긴 지문 하나로 여러 문항을 연속해서 푸는 문항',
  문법: '문법 개념을 직접 묻는 문항 (관계사·시제·분사 등)',
  독해: '지문을 읽고 푸는 문항',
  서술형: '직접 문장을 써서 답하는 문항',
  '독해 유형': '지문을 읽고 푸는 문항',
  '문법 유형': '문법 개념을 직접 묻는 문항',
  '서술형 유형': '직접 문장을 써서 답하는 문항',
}

export function describeRadarAxis(name: string): string | null {
  return AXIS_DESCRIPTION[name] ?? null
}

const SUBJECTIVE_STYLES = new Set(['subjective', 'find_error'])

/**
 * 서술형 문항이 하나도 없으면 모의고사 형태로만 시험을 본다는 뜻 → 영역 단위로 펼친다.
 * 학년이 아니라 데이터로 판정하므로, 고3 내신처럼 서술형이 섞인 경우는 그대로 카테고리를 쓴다.
 */
export function shouldExpandToDomains(
  answers: { exam_question: { exam_type: string | null; question_style: string } | null }[],
): boolean {
  const reading = answers.filter((a) => a.exam_question?.exam_type === 'reading')
  if (reading.length === 0) return false
  return !reading.some((a) => SUBJECTIVE_STYLES.has(a.exam_question!.question_style))
}
