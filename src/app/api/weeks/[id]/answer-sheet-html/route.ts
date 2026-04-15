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

  // 한 페이지에 맞게 행 높이 동적 조정 (문항 수가 많을수록 작게)
  const qCount = grouped.size
  const rowH = qCount <= 7 ? 52 : qCount <= 10 ? 40 : qCount <= 14 ? 30 : 24
  const tallH = qCount <= 7 ? 68 : qCount <= 10 ? 52 : qCount <= 14 ? 40 : 32

  const tdAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:6px 8px;font-size:13px;vertical-align:middle;"`
  const qnumAttr = `${tdAttr.replace('padding:6px 8px', 'padding:4px;width:48px;text-align:center;font-weight:bold;background:#fde3c4')}`
  const subHdrAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:4px;font-size:12px;width:28px;text-align:center;font-weight:bold;background:#f5f5f5;vertical-align:middle;"`
  const subCellAttr = (h: number) => `border="1" bordercolor="#000000" style="border:1px solid #000;padding:4px;font-size:12px;height:${h}px;vertical-align:middle;"`
  const answerAttr = (h: number) => `border="1" bordercolor="#000000" style="border:1px solid #000;padding:6px 8px;font-size:13px;height:${h}px;vertical-align:middle;"`

  // 테이블 행 생성
  const rows: string[] = []
  for (const [qNum, group] of grouped) {
    const first = group[0]
    const style = first.question_style
    const hasSub = group.length > 1 || first.sub_label !== null

    if (style === 'objective' && !hasSub) {
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td><td ${answerAttr(rowH)} colspan="6">① &nbsp; ② &nbsp; ③ &nbsp; ④ &nbsp; ⑤</td></tr>`)
    } else if (style === 'objective' && hasSub) {
      const cells = group.map((q) =>
        `<td ${subHdrAttr}>(${q.sub_label})</td><td ${subCellAttr(rowH)}>① ② ③ ④ ⑤</td>`
      ).join('')
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td>${cells}</tr>`)
    } else if (style === 'ox') {
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td><td ${answerAttr(rowH)} colspan="6">O &nbsp;/&nbsp; X &nbsp;&nbsp; 수정어: </td></tr>`)
    } else if (style === 'multi_select') {
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td><td ${answerAttr(rowH)} colspan="6">&nbsp;</td></tr>`)
    } else if ((style === 'find_error' || style === 'subjective') && hasSub) {
      const cells = group.map((q) =>
        `<td ${subHdrAttr}>(${q.sub_label})</td><td ${subCellAttr(rowH)}>&nbsp;</td>`
      ).join('')
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td>${cells}</tr>`)
    } else {
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td><td ${answerAttr(tallH)} colspan="6">&nbsp;</td></tr>`)
    }
  }

  const headerAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:6px 8px;font-size:14px;font-weight:bold;background:#fde3c4;text-align:center;"`
  const infoAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:6px 8px;font-size:12px;"`

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: '맑은 고딕', 'Malgun Gothic', sans-serif; margin: 12px; }
  p.guide { font-size: 11px; color: #666; margin: 0 0 8px 0; }
  table.sheet { border-collapse: collapse; width: 100%; border: 2px solid #000; }
</style>
</head>
<body>
<p class="guide">Ctrl+A → Ctrl+C 로 복사해서 한글에 붙여넣기</p>
<table class="sheet" border="1" bordercolor="#000000" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;border:2px solid #000;">
<tr>
  <td ${headerAttr} colspan="7">${title}</td>
</tr>
<tr>
  <td ${infoAttr} colspan="3">학급: ${className}</td>
  <td ${infoAttr} colspan="4">이름:</td>
</tr>
${rows.join('\n')}
</table>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
