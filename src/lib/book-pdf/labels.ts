type QuestionSource = { question_number: number; source_label?: string | null; exam_bank?: { title: string; exam_year: number | null; exam_month: number | null; grade: number | null; source: string; material_kind?: string } }

export function questionSourceLabel(q: QuestionSource) {
  if (q.source_label) return [q.exam_bank?.title, q.source_label].filter(Boolean).join(' · ')
  if (!q.exam_bank) return `${q.question_number}번`
  if (q.exam_bank.material_kind === 'textbook') return `${q.exam_bank.title} · ${q.question_number}번`
  return `${q.exam_bank.exam_year}년 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
}
