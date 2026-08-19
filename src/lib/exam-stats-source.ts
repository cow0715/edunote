/**
 * 외부 공개 통계 사이트에서 기출 영어 문항별 통계(정답·난이도·배점·정답률·선지별 선택률)를 가져온다.
 *
 * 실제 호스트/엔드포인트는 환경변수로 주입한다 (미설정 시 기능 비활성 → null 반환).
 *   EXAM_STATS_BASE_URL   예: https://example.com/stats
 *   EXAM_STATS_LIST_PATH  시험 목록(시퀀스 조회) 경로, BASE_URL 기준 상대경로
 *   EXAM_STATS_RATE_PATH  문항별 통계 경로, BASE_URL 기준 상대경로
 *   EXAM_STATS_REFERER    (선택) Referer 헤더
 * 응답은 EUC-KR HTML 이라 ArrayBuffer 로 받아 수동 디코딩한다.
 */

function getConfig(): { base: string; listPath: string; ratePath: string; headers: Record<string, string> } | null {
  const base = process.env.EXAM_STATS_BASE_URL?.replace(/\/$/, '')
  const listPath = process.env.EXAM_STATS_LIST_PATH
  const ratePath = process.env.EXAM_STATS_RATE_PATH
  if (!base || !listPath || !ratePath) return null
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  }
  if (process.env.EXAM_STATS_REFERER) headers['Referer'] = process.env.EXAM_STATS_REFERER
  return { base, listPath, ratePath, headers }
}

/** 월 → 시험 구분 (1:수능, 2:평가원, 3:교육청) */
function monthToExamType(month: number): number {
  if (month === 11) return 1
  if (month === 6 || month === 9) return 2
  return 3
}

async function fetchExamSeq(
  cfg: NonNullable<ReturnType<typeof getConfig>>,
  grade: number,
  examYear: number,
  examMonth: number,
): Promise<number | null> {
  // DB 와 통계 사이트 모두 시행년도 기준으로 조회한다.
  const body = new URLSearchParams({
    grdFlg: String(grade),
    examYear: String(examYear),
    examType: String(monthToExamType(examMonth)),
  })

  const res = await fetch(`${cfg.base}/${cfg.listPath}`, {
    method: 'POST',
    headers: cfg.headers,
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  const buf = await res.arrayBuffer()
  const html = new TextDecoder('euc-kr').decode(buf)
  const examType = monthToExamType(examMonth)
  // 수능(11월)은 코로나 연도 등 실제 시행일이 12월일 수 있어 월 대신 "수능" 키워드로 매칭
  if (examType === 1) {
    const re = new RegExp(`fncSelExamSeq\((\d+),'\d+',\d+\)[^>]*>\s*${examYear}\.[^<]*수능`)
    const m = html.match(re)
    return m ? parseInt(m[1]) : null
  }
  // 4월 학력평가가 5월로 연기되는 해가 있어 4↔5 상호 fallback
  const monthsToTry = examMonth === 4 ? [4, 5] : examMonth === 5 ? [5, 4] : [examMonth]
  for (const month of monthsToTry) {
    const monthStr = String(month).padStart(2, '0')
    const re = new RegExp(`fncSelExamSeq\((\d+),'\d+',\d+\)[^>]*>\s*${examYear}\.${monthStr}`)
    const m = html.match(re)
    if (m) return parseInt(m[1])
  }
  return null
}

export type StatsRow = {
  question_number: number
  answer: string
  difficulty: string
  points: number
  correct_rate: number
  choice_rates: number[]
}

// 숫자 "1"~"5" → 원문자 "①"~"⑤"
function toCircledNumber(s: string): string {
  const map: Record<string, string> = { '1': '①', '2': '②', '3': '③', '4': '④', '5': '⑤' }
  return map[s.trim()] ?? s.trim()
}

function parseStatsHtml(html: string): StatsRow[] {
  const results: StatsRow[] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch

  while ((trMatch = trRe.exec(html)) !== null) {
    const cells: string[] = []
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let tdMatch
    while ((tdMatch = tdRe.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim())
    }

    // 컬럼 순서: [0]번호 [1]정답 [2]난이도 [3]배점 [4]정답률 [5~9]선지별선택률
    if (cells.length >= 10 && /^\d+$/.test(cells[0])) {
      const pct = (s: string) => { const n = parseFloat(s.replace('%', '')); return isNaN(n) ? 0 : n }
      results.push({
        question_number: parseInt(cells[0]),
        answer: toCircledNumber(cells[1]),
        difficulty: cells[2] || '',
        points: parseInt(cells[3]) || 2,
        correct_rate: pct(cells[4]),
        choice_rates: [pct(cells[5]), pct(cells[6]), pct(cells[7]), pct(cells[8]), pct(cells[9])],
      })
    }
  }

  return results
}

/** 외부 통계 연동이 설정돼 있는지 (UI 안내용) */
export function isExamStatsConfigured(): boolean {
  return getConfig() !== null
}

/**
 * 영어 문항별 통계 가져오기
 * @returns StatsRow[] | null (null = 미설정, 데이터 없음 또는 오류)
 */
export async function fetchExamStats(
  grade: number,
  examYear: number,
  examMonth: number,
  formType: '홀수형' | '짝수형' = '홀수형'
): Promise<StatsRow[] | null> {
  const cfg = getConfig()
  if (!cfg) return null

  const examSeq = await fetchExamSeq(cfg, grade, examYear, examMonth)
  if (!examSeq) return null

  const selExamType = formType === '짝수형' ? 2 : 1
  const body = new URLSearchParams({
    examSeq: String(examSeq),
    tabNo: '3', // 영어
    selExamType: String(selExamType),
  })

  const res = await fetch(`${cfg.base}/${cfg.ratePath}`, {
    method: 'POST',
    headers: cfg.headers,
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  // EUC-KR 인코딩 → ArrayBuffer 로 받아서 수동 디코딩
  const buf = await res.arrayBuffer()
  const html = new TextDecoder('euc-kr').decode(buf)
  const rows = parseStatsHtml(html)
  return rows.length > 0 ? rows : null
}
