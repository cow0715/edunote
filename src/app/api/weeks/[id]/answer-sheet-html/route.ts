import { getAuth, getTeacherId, assertWeekOwner, err } from '@/lib/api'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuth()
  const { id: weekId } = await params
  if (!user) return err('인증 필요', 401)
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return err('강사 정보 없음', 404)
  if (!await assertWeekOwner(supabase, weekId, teacherId)) return err('접근 권한 없음', 403)

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

  // 객관식/서술형 분류 후 높이 배분
  type RowInfo = { qNum: number; group: Q[]; isShort: boolean }
  const rowInfos: RowInfo[] = []
  for (const [qNum, group] of grouped) {
    const s = group[0].question_style
    const isShort = s === 'objective' || s === 'ox' || s === 'multi_select'
    rowInfos.push({ qNum, group, isShort })
  }
  const shortCount = rowInfos.filter(r => r.isShort).length
  const tallCount = rowInfos.length - shortCount

  // A4(297mm) - 상하마진(20mm) - 제목+학교/이름(16mm) - 여유(6mm) = 255mm
  // 객관식: 고정 높이 / 서술형: 남은 공간 균등 분배, 단 상한값으로 캡
  const availMm = 255
  const shortPt = 28
  const tallMaxPt = 120
  const shortMm = shortPt / 2.835
  const remainingMm = Math.max(0, availMm - shortCount * shortMm)
  const tallPtRaw = tallCount > 0 ? Math.floor((remainingMm / tallCount) * 2.835) : 0
  const tallPt = Math.min(tallPtRaw, tallMaxPt)

  // 모든 행에 걸쳐 필요한 최대 컬럼 수 계산 (소문항 수 * 2)
  const maxSubs = Math.max(1, ...rowInfos.map(r => r.group.length))
  const answerColSpan = maxSubs * 2

  const trStyle = (h: number) => `style="height:${h}pt;mso-height-rule:exactly;"`
  const qnumAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:2pt;width:36pt;text-align:center;font-weight:bold;background:#fde3c4;vertical-align:middle;"`
  const subHdrAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:2pt;font-size:12px;width:22pt;text-align:center;font-weight:bold;background:#f5f5f5;vertical-align:middle;"`
  const subCellAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:2pt;font-size:12px;vertical-align:middle;"`
  const answerAttr = `border="1" bordercolor="#000000" style="border:1px solid #000;padding:2pt 4pt;font-size:13px;vertical-align:middle;"`

  // 테이블 행 생성
  const rows: string[] = []
  for (const { qNum, group, isShort } of rowInfos) {
    const first = group[0]
    const style = first.question_style
    const hasSub = group.length > 1 || first.sub_label !== null
    const tr = trStyle(isShort ? shortPt : tallPt)

    if ((style === 'objective' || style === 'multi_select') && !hasSub) {
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td><td ${answerAttr} colspan="${answerColSpan}"><span style="font-size:16px;">① &nbsp; ② &nbsp; ③ &nbsp; ④ &nbsp; ⑤</span></td></tr>`)
    } else if ((style === 'objective' || style === 'multi_select') && hasSub) {
      const cells = group.map((q) =>
        `<td ${subHdrAttr}>(${q.sub_label})</td><td ${subCellAttr}><span style="font-size:14px;">① ② ③ ④ ⑤</span></td>`
      ).join('')
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td>${cells}</tr>`)
    } else if (style === 'ox') {
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td><td ${answerAttr} colspan="${answerColSpan}">O &nbsp;/&nbsp; X &nbsp;&nbsp; 수정어: </td></tr>`)
    } else if (style === 'multi_select') {
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td><td ${answerAttr} colspan="${answerColSpan}">&nbsp;</td></tr>`)
    } else if ((style === 'find_error' || style === 'subjective') && hasSub) {
      const cells = group.map((q) =>
        `<td ${subHdrAttr}>(${q.sub_label})</td><td ${subCellAttr}>&nbsp;</td>`
      ).join('')
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td>${cells}</tr>`)
    } else {
      rows.push(`<tr ${tr}><td ${qnumAttr}>${qNum}</td><td ${answerAttr} colspan="${answerColSpan}">&nbsp;</td></tr>`)
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
<p style="text-align:center;font-size:18px;font-weight:bold;margin:4pt 0 2pt 0;">Week${weekNum} 진단평가 답안지</p>
<p style="text-align:right;font-size:12px;margin:0 0 4pt 0;">학교: ______________&nbsp;&nbsp;&nbsp;&nbsp;이름: ______________</p>
<table border="1" bordercolor="#000000" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;border:2px solid #000;">
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
