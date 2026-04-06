const BASE = 'https://www.megastudy.net/Entinfo/correctRate'
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Referer': 'https://www.megastudy.net/Entinfo/correctRate/main.asp',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

/** 월 → megastudy examType (1:수능, 2:교육청, 3:평가원) */
function monthToExamType(month: number): number {
  if (month === 11) return 1
  if (month === 6 || month === 9) return 3
  return 2
}

async function fetchExamSeq(grade: number, examYear: number, examMonth: number): Promise<number | null> {
  // DB는 학년도 기준, 메가스터디는 시행연도 기준 → 항상 -1
  // 예: 2026학년도 수능/6월/9월 = 2025년 시행 → megastudy examYear=2025
  const megastudyYear = examYear - 1

  const body = new URLSearchParams({
    grdFlg: String(grade),
    examYear: String(megastudyYear),
    examType: String(monthToExamType(examMonth)),
  })

  const res = await fetch(`${BASE}/main_examNm_ax.asp`, {
    method: 'POST',
    headers: HEADERS,
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  const buf = await res.arrayBuffer()
  const html = new TextDecoder('euc-kr').decode(buf)
  // 예: onclick="fncSelExamSeq(334,'1',0);">2024.11.14 수능
  const monthStr = String(examMonth).padStart(2, '0')
  const re = new RegExp(`fncSelExamSeq\\((\\d+),'\\d+',\\d+\\)[^>]*>\\s*${megastudyYear}\\.${monthStr}\\.`)
  const m = html.match(re)
  return m ? parseInt(m[1]) : null
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

/**
 * 메가스터디 영어 문항별 통계 가져오기
 * @returns StatsRow[] | null (null = 데이터 없음 또는 오류)
 */
export async function getMegastudyStats(
  grade: number,
  examYear: number,
  examMonth: number,
  formType: '홀수형' | '짝수형' = '홀수형'
): Promise<StatsRow[] | null> {
  const examSeq = await fetchExamSeq(grade, examYear, examMonth)
  if (!examSeq) return null

  const selExamType = formType === '짝수형' ? 2 : 1
  const body = new URLSearchParams({
    examSeq: String(examSeq),
    tabNo: '3', // 영어
    selExamType: String(selExamType),
  })

  const res = await fetch(`${BASE}/main_rate_ax.asp`, {
    method: 'POST',
    headers: HEADERS,
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  // 메가스터디는 EUC-KR 인코딩 → ArrayBuffer로 받아서 수동 디코딩
  const buf = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') ?? ''
  console.log('[megastudy] content-type:', contentType)
  console.log('[megastudy] first 20 bytes (hex):', Array.from(new Uint8Array(buf).slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '))
  const html = new TextDecoder('euc-kr').decode(buf)
  console.log('[megastudy] decoded sample (100 chars):', html.slice(0, 100))
  const rows = parseStatsHtml(html)
  return rows.length > 0 ? rows : null
}
