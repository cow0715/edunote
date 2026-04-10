import { getAuth, err } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)

  // 주차 정보
  const { data: week } = await supabase
    .from('week')
    .select('week_number, class_id, class(name)')
    .eq('id', weekId)
    .single()

  // 문항 조회
  const { data: questions } = await supabase
    .from('exam_question')
    .select('question_number, sub_label, question_style, correct_answer_text')
    .eq('week_id', weekId)
    .eq('exam_type', 'reading')
    .order('question_number')
    .order('sub_label', { nullsFirst: true })

  if (!questions || questions.length === 0) {
    return new Response('<html><body><p>문항이 없습니다. 해설지를 먼저 업로드해주세요.</p></body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const className = (week?.class as unknown as { name: string } | null)?.name ?? ''
  const weekNum = week?.week_number ?? ''
  const title = `${className} ${weekNum}주차 답안지`

  // 문항번호별로 그룹
  type Q = typeof questions[number]
  const grouped = new Map<number, Q[]>()
  for (const q of questions) {
    const arr = grouped.get(q.question_number) ?? []
    arr.push(q)
    grouped.set(q.question_number, arr)
  }

  // 테이블 행 생성
  const rows: string[] = []
  for (const [qNum, group] of grouped) {
    const first = group[0]
    const style = first.question_style
    const hasSub = group.length > 1 || first.sub_label !== null

    if (style === 'objective' && !hasSub) {
      // 객관식 단일
      rows.push(`<tr>
        <td class="qnum">${qNum}번</td>
        <td class="answer">① &nbsp; ② &nbsp; ③ &nbsp; ④ &nbsp; ⑤</td>
      </tr>`)
    } else if (style === 'objective' && hasSub) {
      // 객관식 소문항 (a,b,c 각각 ①~⑤)
      const cells = group.map((q) =>
        `<td class="sub-header">(${q.sub_label})</td><td class="sub-answer">① ② ③ ④ ⑤</td>`
      ).join('')
      rows.push(`<tr>
        <td class="qnum" rowspan="1">${qNum}번</td>
        ${cells}
      </tr>`)
    } else if (style === 'ox') {
      rows.push(`<tr>
        <td class="qnum">${qNum}번</td>
        <td class="answer">O &nbsp;/&nbsp; X &nbsp;&nbsp; 수정어: </td>
      </tr>`)
    } else if (style === 'multi_select') {
      rows.push(`<tr>
        <td class="qnum">${qNum}번</td>
        <td class="answer">&nbsp;</td>
      </tr>`)
    } else if ((style === 'find_error' || style === 'subjective') && hasSub) {
      // 소문항이 있는 서술형/오류교정 → 기호별 칸
      const cells = group.map((q) =>
        `<td class="sub-header">(${q.sub_label})</td><td class="sub-blank">&nbsp;</td>`
      ).join('')
      rows.push(`<tr>
        <td class="qnum">${qNum}번</td>
        ${cells}
      </tr>`)
    } else {
      // 서술형 단일 (넓은 빈칸)
      rows.push(`<tr>
        <td class="qnum">${qNum}번</td>
        <td class="answer tall">&nbsp;</td>
      </tr>`)
    }
  }

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { font-family: '맑은 고딕', 'Malgun Gothic', sans-serif; margin: 20px; }
  h2 { font-size: 16px; margin-bottom: 4px; }
  p.info { font-size: 12px; color: #666; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; }
  td { border: 1px solid #000; padding: 6px 8px; font-size: 13px; vertical-align: middle; }
  .qnum { width: 50px; text-align: center; font-weight: bold; background: #f9f9f9; }
  .answer { min-width: 200px; height: 32px; }
  .answer.tall { height: 48px; }
  .sub-header { width: 32px; text-align: center; font-weight: bold; background: #f9f9f9; }
  .sub-answer { min-width: 80px; height: 32px; font-size: 11px; }
  .sub-blank { min-width: 60px; height: 32px; }
  .name-row td { height: 28px; }
  @media print { body { margin: 10px; } }
</style>
</head>
<body>
<h2>${title}</h2>
<p class="info">이름: ________________ &nbsp;&nbsp; Ctrl+A → Ctrl+C 로 한글에 붙여넣기</p>
<table>
${rows.join('\n')}
</table>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
