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

  // A4(297mm) - 상하마진(20mm) - 제목+이름(25mm) - 테이블마진(5mm) = 247mm 사용 가능
  const qCount = grouped.size
  const availPx = 247 * 3.78 // mm → px
  const rowH = Math.floor(availPx / qCount)
  const tallH = rowH

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
      rows.push(`<tr><td ${qnumAttr}>${qNum}</td><td ${answerAttr(rowH)} colspan="6"><span style="font-size:18px;">① &nbsp; ② &nbsp; ③ &nbsp; ④ &nbsp; ⑤</span></td></tr>`)
    } else if (style === 'objective' && hasSub) {
      const cells = group.map((q) =>
        `<td ${subHdrAttr}>(${q.sub_label})</td><td ${subCellAttr(rowH)}><span style="font-size:16px;">① ② ③ ④ ⑤</span></td>`
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

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${title}</title>
<!--[if gte mso 9]><xml>
<w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument>
</xml><![endif]-->
<style>
  @page Section1 { size: 210mm 297mm; margin: 10mm 10mm 10mm 10mm; }
  div.Section1 { page: Section1; }
  body { font-family: '맑은 고딕', 'Malgun Gothic', sans-serif; }
  table { border-collapse: collapse; }
</style>
</head>
<body>
<div class="Section1">
<p style="text-align:center;font-size:22px;font-weight:bold;margin:24px 0 6px 0;">Week${weekNum} 진단평가 답안지</p>
<p style="text-align:right;font-size:14px;margin:0 0 16px 0;">학교: ______________&nbsp;&nbsp;&nbsp;&nbsp;이름: ______________</p>
<table border="1" bordercolor="#000000" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;border:2px solid #000;margin:8px 0;">
${rows.join('\n')}
</table>
</div>
</body>
</html>`

  const filename = `${title}.doc`
  const encoded = encodeURIComponent(filename)
  return new Response(html, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="answer-sheet.doc"; filename*=UTF-8''${encoded}`,
    },
  })
}
