import { bankChoiceText } from './bank-numbered-text'
import { copyBlockHtml, copyBlockText } from './material-copy'
import { materialInlineHtml } from './material-inline'

type QuestionCopy = { source_document_id?: string | null; question_text: string; passage: string | null; choices: readonly string[]; answer: string | null; choice_rates?: readonly (number | null)[] | null }
type ExplanationCopy = { source_document_id?: string | null; explanation_intent?: string | null; explanation_translation?: string | null; explanation_solution?: string | null; explanation_vocabulary?: string | null }
const circled = ['①', '②', '③', '④', '⑤']
const labelHtml = (label: string) => `<p><strong>${materialInlineHtml([{ kind: 'text', text: `[${label}]` }])}</strong></p>`

// One source-independent path for textbooks, CSAT and mock exams, individual and bulk copy.
export function buildQuestionCopyText(q: QuestionCopy, label: string) {
  const mode = q.source_document_id ? 'stored' : 'prose'
  const blocks = [`[${label}]`, copyBlockText(q.question_text, mode), copyBlockText(q.passage ?? '', mode)].filter(Boolean)
  if (q.choices.length) blocks.push(q.choices.map((c) => copyBlockText(bankChoiceText(c))).join('\n'))
  if (q.answer) blocks.push(`정답: ${q.answer}`)
  const rates = q.choice_rates?.some((r) => r != null)
    ? q.choices.map((_, i) => q.choice_rates?.[i] != null ? `${circled[i]} ${q.choice_rates[i]}%` : '').filter(Boolean).join('   ') : ''
  if (rates) blocks.push(`선택률: ${rates}`)
  return blocks.join('\n\n')
}

export function buildQuestionCopyHtml(q: QuestionCopy, label: string) {
  const mode = q.source_document_id ? 'stored' : 'prose'
  return labelHtml(label) + copyBlockHtml(q.question_text, mode) + copyBlockHtml(q.passage ?? '', mode)
    + q.choices.map((c) => copyBlockHtml(bankChoiceText(c))).join('')
    + (q.answer ? copyBlockHtml(`정답: ${q.answer}`) : '')
}

function explanationBlocks(q: ExplanationCopy) {
  return [
    { label: '출제의도', value: q.explanation_intent, mode: 'prose' },
    { label: '해석', value: q.explanation_translation, mode: 'prose' },
    { label: '풀이', value: q.explanation_solution, mode: 'prose' },
    { label: 'Words and Phrases', value: q.explanation_vocabulary, mode: 'list' },
  ] as const
}

export function buildExplanationCopyText(q: ExplanationCopy, label: string) {
  const blocks = explanationBlocks(q).filter((b) => b.value).map((b) => `[${b.label}]\n${copyBlockText(b.value!, q.source_document_id ? 'stored' : b.mode)}`)
  return [`[${label} 해설]`, ...blocks].join('\n\n')
}

export function buildExplanationCopyHtml(q: ExplanationCopy, label: string) {
  return labelHtml(`${label} 해설`) + explanationBlocks(q).filter((b) => b.value)
    .map((b) => `<p><strong>[${b.label}]</strong></p>${copyBlockHtml(b.value!, q.source_document_id ? 'stored' : b.mode)}`).join('')
}
