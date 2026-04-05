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
  const body = new URLSearchParams({
    grdFlg: String(grade),
    examYear: String(examYear),
    examType: String(monthToExamType(examMonth)),
  })

  const res = await fetch(`${BASE}/main_examNm_ax.asp`, {
    method: 'POST',
    headers: HEADERS,
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null

  const html = await res.text()
  // 예: onclick="fncSelExamSeq(334,'1',0);">2024.11.14 수능
  const monthStr = String(examMonth).padStart(2, '0')
  const re = new RegExp(`fncSelExamSeq\\((\\d+),'\\d+',\\d+\\)[^>]*>\\s*${examYear}\\.${monthStr}\\.`)
  const m = html.match(re)
  return m ? parseInt(m[1]) : null
}

export type StatsRow = {
  question_number: number
  difficulty: string
  points: number
  correct_rate: number
  choice_rates: number[]
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

    if (cells.length >= 10 && /^\d+$/.test(cells[0])) {
      const pct = (s: string) => { const n = parseFloat(s.replace('%', '')); return isNaN(n) ? 0 : n }
      results.push({
        question_number: parseInt(cells[0]),
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

  const html = await res.text()
  const rows = parseStatsHtml(html)
  return rows.length > 0 ? rows : null
}
