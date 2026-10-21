import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'
import type { ReviewDraft } from './review-workflow'

type Cached = { savedAt: number; entries: { draft: ReviewDraft; source: string }[] }
// Session storage is scoped to this browser tab. No server writes or cross-tab drafts.
const cache = new Map<string, Cached>()
const PREFIX = 'edunote:review-drafts:'
function read(weekId: string): Cached | undefined {
  if (cache.has(weekId)) return cache.get(weekId)
  try {
    const raw = typeof window === 'undefined' ? null : sessionStorage.getItem(PREFIX + weekId)
    const saved = raw ? JSON.parse(raw) : null
    if (saved && typeof saved.savedAt === 'number' && Array.isArray(saved.entries) && saved.entries.every((entry: { draft?: ReviewDraft; source?: string }) => entry.draft && typeof entry.draft.student_id === 'string' && typeof entry.draft.exam_question_id === 'string' && typeof entry.draft.is_correct === 'boolean' && typeof entry.source === 'string')) return saved as Cached
  } catch { /* Restricted storage or invalid data: keep the in-memory copy. */ }
}
function persist(weekId: string) {
  try {
    if (typeof window === 'undefined') return
    const entry = cache.get(weekId)
    if (entry) sessionStorage.setItem(PREFIX + weekId, JSON.stringify(entry))
    else sessionStorage.removeItem(PREFIX + weekId)
  } catch { /* beforeunload and the in-memory copy still protect this session. */ }
}
const TTL = 60 * 60 * 1000
function source(draft: ReviewDraft, questions: ExamQuestion[], rows: GradeRow[]): string | null {
  const question = questions.find(q => q.id === draft.exam_question_id)
  const row = rows.find(r => r.student_id === draft.student_id)
  const answer = row?.answers.find(a => a.exam_question_id === draft.exam_question_id)
  if (!question || question.is_void || question.all_correct || !row?.present || !row.reading_present || !answer) return null
  return JSON.stringify([question.question_style, question.question_stem, question.question_text, question.passage, question.choices, question.correct_answer, question.correct_answer_text, question.extra_correct_answers, question.grading_criteria, answer])
}
export function cacheReviewDrafts(weekId: string, drafts: Map<string, ReviewDraft>, questions: ExamQuestion[], rows: GradeRow[]) {
  if (!drafts.size) { cache.delete(weekId); persist(weekId); return }
  const existing = read(weekId)
  const entries = [...drafts.values()].flatMap(draft => {
    const snapshot = source(draft, questions, rows)
    return snapshot === null ? [] : [{ draft: { ...draft }, source: existing?.entries.find(entry => entry.draft.student_id === draft.student_id && entry.draft.exam_question_id === draft.exam_question_id)?.source ?? snapshot }]
  })
  cache.delete(weekId)
  if (entries.length) cache.set(weekId, { savedAt: Date.now(), entries })
  persist(weekId)
  while (cache.size > 20) { const oldest = cache.keys().next().value!; cache.delete(oldest); persist(oldest) }
}
export function restoreReviewDrafts(weekId: string, questions: ExamQuestion[], rows: GradeRow[]) {
  const saved = read(weekId)
  if (!saved || Date.now() - saved.savedAt > TTL) return new Map<string, ReviewDraft>()
  return new Map(saved.entries.filter(entry => entry.source === source(entry.draft, questions, rows))
    .map(({ draft }) => [`${draft.student_id}_${draft.exam_question_id}`, { ...draft }]))
}
export function removeCachedReviewDrafts(weekId: string, saved: ReviewDraft[]) {
  const entry = read(weekId)
  if (!entry) return
  entry.entries = entry.entries.filter(({ draft }) => !saved.some(item => item.student_id === draft.student_id && item.exam_question_id === draft.exam_question_id))
  if (entry.entries.length) cache.set(weekId, entry)
  else cache.delete(weekId)
  persist(weekId)
}
export function clearReviewDraftCache() {
  cache.clear()
  try {
    if (typeof window === 'undefined') return
    Object.keys(sessionStorage).filter(key => key.startsWith(PREFIX)).forEach(key => sessionStorage.removeItem(key))
  } catch { /* Storage may be disabled. */ }
}
