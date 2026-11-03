'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck2, Camera, CheckCircle2, ChevronLeft, ChevronRight, Images, ListChecks, LoaderCircle, Table2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ParentReportLink } from './parent-report-link'
import { Button } from '@/components/ui/button'
import { AnswerWorkspace } from './answer-workspace'
import { useGradeData, useSaveGrade, useSaveGradeDraft, useSaveWeekScore, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'
import { formatOXStudentInput, oxNotation } from '@/lib/ox-grading'
import { cn } from '@/lib/utils'
import { VocabSheetContent, VocabAnswerRow } from './vocab-sheet-content'
import { ExamSheetContent } from './exam-sheet-content'
import { gradeDraftSource, sameDraftField, draftFieldChangedOnServer, readGradeDraftCache, writeGradeDraftCache } from '@/lib/grade-draft-cache'
import { UnsavedChangesGuard } from './unsaved-changes-guard'
import { AttendanceStatus } from './attendance-status'
import { GradeEditIcon } from './grade-edit-icon'
import { HomeworkInlineInput } from './homework-inline-input'
import { useAttendance } from '@/hooks/use-attendance'
import { GradeScoreValue } from './grade-score-value'
import { buildReviewQueue } from '@/lib/review-workflow'
import { MobileGradeCards } from './mobile-grade-cards'
import { SubjectiveReviewPanel } from './subjective-review-panel'
import { VocabBatchGradeDialog } from './vocab-batch-grade-dialog'
import { ExamBatchGradeDialog } from './exam-batch-grade-dialog'
import type { ExamOcrResult } from './exam-photo-button'
import { mergeGradeDrafts } from '@/lib/grade-draft-merge'
import { createGradeSaveQueue } from '@/lib/atomic-grade'

// 빈 배열 상수 — 매 렌더마다 새 참조 생성 방지 (useEffect 의존성 안정화)
const EMPTY_VOCAB: VocabAnswerRow[] = []
// Freeze input values without severing the save queue's acknowledged-version chain.
function snapshotGradeRows(rows: GradeRow[]): GradeRow[] {
  return rows.map(row => ({ ...structuredClone(row), grade_version: row.grade_version }))
}

// ── 메인 컴포넌트 ──────────────────────────────────────
interface Props {
  classId?: string
  attendanceDate?: string | null
  weekId: string
  vocabTotal: number
  readingTotal: number
  homeworkTotal: number
  onOpenAttendance?: () => void
  active?: boolean
  onSaved?: () => void
  answerRequest?: { studentId: string; type: 'exam' | 'vocab' } | null
}

export function GradeGrid({ classId, attendanceDate, weekId, vocabTotal, readingTotal, homeworkTotal, onSaved, answerRequest, active = true, onOpenAttendance }: Props) {
  const { data, isLoading, isError, refetch } = useGradeData(weekId)
  const attendanceQuery = useAttendance(classId ?? '', attendanceDate ?? '')
  const [invalidHomework,setInvalidHomework]=useState<Set<string>>(new Set())
  const [savingEntries,setSavingEntries]=useState(false)
  const [entryError,setEntryError]=useState<string|null>(null)

  const [rows, setRows] = useState<GradeRow[]>([])
  const rowsRef = useRef<GradeRow[]>([])
  const [handledAnswerRequest, setHandledAnswerRequest] = useState<typeof answerRequest>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sheetView, setSheetView] = useState<{ type: 'vocab' | 'exam'; studentId: string } | null>(null)
  const [saveQueue] = useState(createGradeSaveQueue)
  const syncVersions = useCallback(() => {
    setRows((prev) => prev.map((row) => ({ ...row, grade_version: saveQueue.resolve(row.grade_version) })))
  }, [saveQueue])
  const saveGrade = useSaveGrade(weekId, saveQueue, syncVersions)
  const saveWithoutAI = useSaveGrade(weekId, saveQueue, syncVersions, true)
  const saveDraft = useSaveGradeDraft(weekId, saveQueue, syncVersions)
  const saveWeekScore = useSaveWeekScore(weekId, saveQueue, syncVersions)
  const [gradeConfirmOpen, setGradeConfirmOpen] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const reviewPanelRef = useRef<HTMLDivElement | null>(null)
  const revealReview = useCallback((node: HTMLDivElement | null) => {
    reviewPanelRef.current = node
    node?.scrollIntoView?.({ block: 'start' })
  }, [])
  const [batchOpen, setBatchOpen] = useState(false)
  const [examBatchOpen, setExamBatchOpen] = useState(false)
  const [localExamPhotoPaths, setLocalExamPhotoPaths] = useState<Map<string, string>>(new Map())
  const queryClient = useQueryClient()
  const [dirtyFields, setDirtyFields] = useState<Record<string, number>>({})
  const dirtyRef = useRef<Record<string, number>>({})
  const editVersion = useRef(0)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftSaved, setDraftSaved] = useState(false)
  const [recovery, setRecovery] = useState(() => readGradeDraftCache(weekId))
  const [cacheFailed, setCacheFailed] = useState(false)
  const [pendingDrafts, setPendingDrafts] = useState(0)
  const pendingDraftsRef = useRef(0)
  const inFlight = useRef(new Set<string>())
  const [failedStudents, setFailedStudents] = useState<Set<string>>(new Set())
  const [serverRevision, setServerRevision] = useState(0)

  const markChanged = useCallback((studentId: string, field: string) => {
    dirtyRef.current = { ...dirtyRef.current, [`${studentId}:${field}`]: ++editVersion.current }
    setDirtyFields(dirtyRef.current)
    setDraftSaved(false)
  }, [])
  const acknowledge = useCallback((snapshot: Record<string, number>) => {
    const next = { ...dirtyRef.current }
    for (const [key, version] of Object.entries(snapshot)) if (next[key] === version) delete next[key]
    dirtyRef.current = next
    setDirtyFields(next)
  }, [])
  const capture = useCallback((studentIds: string[], fields?: string[]) => Object.fromEntries(
    Object.entries(dirtyRef.current).filter(([key]) => studentIds.some(id => key.startsWith(`${id}:`)) && (!fields || fields.some(field => key.endsWith(`:${field}`))))
  ), [])
  const persistDraft = useCallback((snapshotRows: GradeRow[]) => {
    const draftRows = snapshotRows.filter(row => Object.keys(capture([row.student_id], ['answers', 'reading_present', 'reading_correct'])).length > 0)
    const snapshot = capture(draftRows.map(row => row.student_id), ['answers', 'reading_present', 'reading_correct'])
    if (recovery || !Object.keys(snapshot).length) return
    const requestKey = JSON.stringify(snapshot)
    if (inFlight.current.has(requestKey)) return
    inFlight.current.add(requestKey)
    pendingDraftsRef.current += 1
    setPendingDrafts(pendingDraftsRef.current)
    // mutateAsync attaches handlers to every queued request; mutate callbacks only track the latest call.
    return saveDraft.mutateAsync(snapshotGradeRows(draftRows)).then(async () => {
      acknowledge(snapshot)
      setDraftSaved(true)
      setDraftError(null)
      setFailedStudents(previous => new Set([...previous].filter(id => !draftRows.some(row => row.student_id === id))))
      await queryClient.refetchQueries({ queryKey: ['grade', weekId] })
      return true
    }).catch(error => {
      setDraftError(error instanceof Error ? error.message : '답안 임시 저장에 실패했습니다')
      setFailedStudents(previous => new Set([...previous, ...draftRows.map(row => row.student_id)]))
      return false
    }).finally(() => {
      inFlight.current.delete(requestKey)
      pendingDraftsRef.current -= 1
      setPendingDrafts(pendingDraftsRef.current)
    })
  }, [capture, acknowledge, saveDraft, recovery, queryClient, weekId])
  function saveMetadata(row: GradeRow) {
    const snapshot = capture([row.student_id], ['memo'])
    saveWeekScore.mutate({ student_id: row.student_id, grade_version: row.grade_version, memo: row.memo }, {
      onSuccess: () => acknowledge(snapshot),
    })
  }
  const hasUnsavedChanges = Object.keys(dirtyFields).length > 0
  const saving = saveGrade.isPending || recovery !== null


  const [syncedData, setSyncedData] = useState<unknown>(null)
  const [syncedWeek, setSyncedWeek] = useState<string | null>(null)
  const [syncedRevision, setSyncedRevision] = useState(-1)
  const [baseline, setBaseline] = useState<GradeRow[]>([])
  if (data && (syncedData !== data || syncedWeek !== weekId || syncedRevision !== serverRevision)) {
    const { classStudents, weekScores, questions } = data

    type SavedAnswer = {
      exam_question_id: string
      student_answer: number | null
      student_answer_text: string | null
      ox_selection: string | null
      is_correct: boolean
      needs_review: boolean
      teacher_confirmed: boolean
      ai_feedback: string | null
    }
    type SavedVocabAnswer = {
      vocab_word_id: string
      test_number: number | null
      test_word: string | null
      test_source: string | null
      student_answer: string | null
      is_correct: boolean
      vocab_word: { number: number; english_word: string } | null
    }
    type ScoreRecord = {
      grade_revision: number
      student_id: string
      id: string
      vocab_correct: number | null
      reading_correct: number | null
      homework_done: number | null
      memo: string | null
      vocab_photo_path: string | null
      exam_photo_path: string | null
      student_answer: SavedAnswer[]
      student_vocab_answer: SavedVocabAnswer[]
    }

    const scoreMap = new Map<string, ScoreRecord>(
      weekScores?.map((s: ScoreRecord) => [s.student_id, s])
    )
    const previous = syncedWeek === weekId ? rows : []
    const incoming = ((): GradeRow[] => {
      return (classStudents ?? []).map((cs: { student_id: string; student: { name: string } }) => {
        const score = scoreMap.get(cs.student_id)
        // Attendance never controls inclusion or participation in a recorded exam.
        const serverRow: GradeRow = {
          grade_version: data.grade_versions?.find((version: {student_id: string}) => version.student_id === cs.student_id) ?? {score_id:null,revision:null},
          stored_exam_photo_path: score?.exam_photo_path ?? null,
          student_id: cs.student_id,
          student_name: cs.student?.name ?? '',
          present: true,
          vocab_correct: score?.vocab_correct ?? null,
          reading_present: score?.reading_correct != null,
          reading_correct: score?.reading_correct ?? null,
          homework_done: score?.homework_done ?? null,
          memo: score?.memo ?? '',
          answers: (questions ?? []).filter((q: ExamQuestion) => !q.is_void).map((q: ExamQuestion) => {
            const saved = score?.student_answer?.find((a) => a.exam_question_id === q.id)
            let answerText = ''
            if (q.question_style === 'ox' && saved) {
              answerText = formatOXStudentInput(
                saved.ox_selection, saved.student_answer_text, oxNotation(q.correct_answer_text),
              )
            } else {
              answerText = saved?.student_answer_text ?? ''
            }
            return {
              exam_question_id: q.id,
              student_answer: saved?.student_answer ?? null,
              student_answer_text: answerText,
              is_correct: saved?.is_correct,
              needs_review: saved?.needs_review,
              teacher_confirmed: saved?.teacher_confirmed,
              ai_feedback: saved?.ai_feedback ?? '',
            }
          }),
        }
        return serverRow
      })
    })()
    const resolved = previous.map((row) => ({ ...row, grade_version: saveQueue.resolve(row.grade_version) }))
    setRows(mergeGradeDrafts(resolved, incoming, syncedWeek === weekId ? baseline : []))
    setBaseline(incoming)
    setSyncedData(data)
    setSyncedWeek(weekId)
    setSyncedRevision(serverRevision)
  }

  useEffect(() => {
    if (!data || recovery) return
    const fields = Object.keys(dirtyFields)
    const cachedRows = rows.filter(row => fields.some(field => field.startsWith(`${row.student_id}:`)))
    const stored = writeGradeDraftCache(weekId, fields.length ? { savedAt: Date.now(), source: gradeDraftSource(data, cachedRows.map(row => row.student_id)), questions: JSON.stringify(data.questions ?? []), rows: cachedRows, fields } : null)
    // A storage failure must be visible; state and navigation guards still retain this tab's edits.
    // External browser-storage writes can fail after render (quota/private mode).
    if (!stored && fields.length) setCacheFailed(true)
  }, [data, recovery, rows, dirtyFields, weekId])

  const recoveryReady = !!data && rows.length > 0
  const recoveryQuestionsMatch = recovery?.questions === JSON.stringify(data?.questions ?? [])
  const recoveryChangedFields = recovery?.fields.filter(key => {
    const cached = recovery.rows.find(row => key.startsWith(`${row.student_id}:`))
    const current = rows.find(row => row.student_id === cached?.student_id)
    return !cached || !current || !sameDraftField(cached, current, key.slice(cached.student_id.length + 1))
  }) ?? []
  const recoveryHasConflict = !!recovery && recoveryChangedFields.length > 0 && (
    !recoveryQuestionsMatch || recoveryChangedFields.some(key => {
      const cached = recovery.rows.find(row => key.startsWith(`${row.student_id}:`))
      return !cached || draftFieldChangedOnServer(recovery, gradeDraftSource(data ?? {}, recovery.rows.map(row => row.student_id)), cached.student_id, key.slice(cached.student_id.length + 1))
    })
  )
  const applyRecoveredInputs = useCallback((keepInput: boolean) => {
    if (!recovery) return
    if (keepInput) {
      const next = rows.map(row => {
        const cached = recovery.rows.find(item => item.student_id === row.student_id)
        if (!cached) return row
        const restored = { ...row }
        for (const field of ['answers', 'reading_present', 'reading_correct', 'vocab_correct', 'homework_done', 'memo'] as const) {
          if (!recovery.fields.includes(`${row.student_id}:${field}`) || sameDraftField(cached,row,field)) continue
          Object.assign(restored, { [field]: cached[field] })
          dirtyRef.current[`${row.student_id}:${field}`] = ++editVersion.current
        }
        return restored
      })
      setDirtyFields({ ...dirtyRef.current }); rowsRef.current = next; setRows(next)
    }
    setRecovery(null)
  }, [recovery, rows])
  useEffect(() => {
    if (!recovery || !recoveryReady || recoveryHasConflict) return
    // Hydrate external crash-recovery data only after server rows are available.
    // The callback also restores per-field revisions, so stale acknowledgements cannot clear it.
    applyRecoveredInputs(true)
  }, [recovery, recoveryReady, recoveryHasConflict, applyRecoveredInputs])

  // 단어 답안 맵 (data 변경 시에만 재계산)
  const vocabAnswerMap = useMemo(() => {
    const m = new Map<string, VocabAnswerRow[]>()
    if (!data?.weekScores) return m
    for (const score of data.weekScores) {
      const answers: VocabAnswerRow[] = (
        (score.student_vocab_answer ?? []) as {
          id: string
          test_number: number | null
          test_word: string | null
          test_source: string | null
          test_prompt?: string | null
          test_answer?: string | null
          student_answer: string | null
          is_correct: boolean
          teacher_locked: boolean
          vocab_word: { number: number; english_word: string } | null
        }[]
      )
        .filter((a) => a.vocab_word)
        .map((a) => ({
          id: a.id,
          number: a.test_number ?? a.vocab_word!.number,
          source_number: a.vocab_word!.number,
          english_word: a.vocab_word!.english_word,
          test_word: a.test_word ?? a.vocab_word!.english_word,
          test_source: a.test_source ?? null,
          test_prompt: a.test_prompt ?? null,
          test_answer: a.test_answer ?? null,
          student_answer: a.student_answer,
          is_correct: a.is_correct,
          teacher_locked: a.teacher_locked ?? false,
        }))
        .sort((a, b) => a.number - b.number)
      m.set(score.student_id, answers)
    }
    return m
  }, [data])

  const weekScoreIdMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const score of data?.weekScores ?? []) m.set(score.student_id, score.id)
    return m
  }, [data?.weekScores])

  const vocabPhotoPathMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const score of data?.weekScores ?? []) {
      if (score.vocab_photo_path) m.set(score.student_id, score.vocab_photo_path)
    }
    return m
  }, [data?.weekScores])

  const examPhotoPathMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const score of data?.weekScores ?? []) {
      if (score.exam_photo_path) m.set(score.student_id, score.exam_photo_path)
    }
    for (const [studentId, path] of localExamPhotoPaths) m.set(studentId, path)
    return m
  }, [data?.weekScores, localExamPhotoPaths])

  const updateRow = useCallback((studentId: string, key: keyof GradeRow, value: unknown) => {
    markChanged(studentId, key)
    setRows((prev) => prev.map((r) => (r.student_id === studentId ? { ...r, [key]: value } : r)))
  }, [markChanged])

  async function saveHomework(studentId: string, value: number | null) {
    const row = rowsRef.current.find(item => item.student_id === studentId)
    if (!row) throw new Error('학생 자료를 찾을 수 없습니다')
    if (row.homework_done === value && !dirtyRef.current[`${studentId}:homework_done`]) return
    updateRow(studentId, 'homework_done', value)
    const snapshot = capture([studentId], ['homework_done'])
    await saveWeekScore.mutateAsync({ student_id: studentId, grade_version: row.grade_version, homework_done: value })
    acknowledge(snapshot)
  }

  const updateAnswer = useCallback((studentId: string, questionId: string, value: number | null) => {
    markChanged(studentId, 'answers')
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return { ...r, answers: r.answers.map((a) => a.exam_question_id === questionId ? { ...a, student_answer: value, teacher_confirmed: false } : a) }
      })
    )
  }, [markChanged])

  const updateAnswerText = useCallback((studentId: string, questionId: string, text: string) => {
    markChanged(studentId, 'answers')
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return {
          ...r, answers: r.answers.map((a) =>
            a.exam_question_id === questionId
              ? { ...a, student_answer_text: text, teacher_confirmed: false, is_correct: undefined, needs_review: undefined, ai_feedback: '' }
              : a
          ),
        }
      })
    )
  }, [markChanged])

  useEffect(() => { rowsRef.current = rows }, [rows])

  /** 일괄 판독 결과를 해당 학생 행에 채우고 임시저장. 반영된 문항 수를 돌려준다. */
  const applyExamOcr = useCallback((studentId: string, results: ExamOcrResult[], photoPath: string) => {
    const questionByKey = new Map<string, ExamQuestion>(
      (data?.questions ?? []).map((q: ExamQuestion) => [`${q.question_number}__${q.sub_label ?? ''}`, q] as const),
    )
    let applied = 0
    const merged = rowsRef.current.map((r) => {
      if (r.student_id !== studentId) return r
      const answers = r.answers.map((a) => ({ ...a }))
      const byQid = new Map(answers.map((a) => [a.exam_question_id, a]))
      for (const res of results) {
        const q = questionByKey.get(`${res.question_number}__${res.sub_label ?? ''}`)
        const a = q ? byQid.get(q.id) : undefined
        if (!a) continue
        if (res.student_answer !== undefined) {
          a.student_answer = res.student_answer
          applied += 1
        } else if (res.student_answer_text !== undefined) {
          a.student_answer_text = res.student_answer_text
          a.teacher_confirmed = false
          applied += 1
        }
      }
      return { ...r, answers, reading_present: true, exam_photo_path: photoPath }
    })
    markChanged(studentId, 'answers')
    markChanged(studentId, 'reading_present')
    rowsRef.current = merged
    setRows(merged)
    setLocalExamPhotoPaths((prev) => {
      const next = new Map(prev)
      next.set(studentId, photoPath)
      return next
    })
    const target = merged.find((r) => r.student_id === studentId)
    if (target) persistDraft([target])
    return applied
  }, [data?.questions, persistDraft, markChanged, weekId])

  const navigationLock = useRef(false)
  const [navigationSaving, setNavigationSaving] = useState(false)
  const weekWrites = useIsMutating({ predicate: mutation => mutation.options.scope?.id === `week-score:${weekId}` })
  const workspaceBusy = navigationSaving || pendingDrafts > 0 || weekWrites > 0

  // Resolve the student by ID only after query-derived rows are ready.
  if (answerRequest && answerRequest !== handledAnswerRequest && !isLoading && !workspaceBusy && rows.length) {
    setHandledAnswerRequest(answerRequest)
    const studentIndex = rows.findIndex(row => row.student_id === answerRequest.studentId)
    if (studentIndex >= 0) {
      setShowReviewPanel(false)
      setSheetView({ type: answerRequest.type, studentId: answerRequest.studentId })
    }
  }

  const shareTokens = new Map<string, string>((data?.classStudents ?? []).filter((cs: { student?: { share_token?: string | null } }) => cs.student?.share_token).map((cs: { student_id: string; student: { share_token: string } }) => [cs.student_id, cs.student.share_token]))
  const attendanceStatuses = new Map<string, string>((attendanceQuery.data ?? data?.attendance ?? []).map((record: { student_id: string; status: string }) => [record.student_id, record.status]))
  const sheetIndex = sheetView ? rows.findIndex(row => row.student_id === sheetView.studentId) : -1
  const sheetRow = rows[sheetIndex] ?? null

  const changeSheet = useCallback(async (next: typeof sheetView) => {
    if (saveGrade.isPending || pendingDraftsRef.current > 0 || weekWrites > 0 || navigationLock.current) return
    const current = sheetView ? rowsRef.current.find(row => row.student_id === sheetView.studentId) : null
    if (current && sheetView?.type === 'exam' && Object.keys(capture([current.student_id], ['answers', 'reading_present', 'reading_correct'])).length) {
      navigationLock.current = true
      setNavigationSaving(true)
      try {
        if (await persistDraft([current]) !== true) return
        setSheetView(next)
      } finally {
        navigationLock.current = false
        setNavigationSaving(false)
      }
      return
    }
    setSheetView(next)
  }, [sheetView, capture, persistDraft, saveGrade.isPending, weekWrites])

  const navigateSheet = useCallback((delta: number) => {
    if (!sheetView) return
    const next = sheetIndex + delta
    if (next >= 0 && next < rows.length) changeSheet({ ...sheetView, studentId: rows[next].student_id })
  }, [sheetView, sheetIndex, rows, changeSheet])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!sheetView || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        navigateSheet(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sheetView, navigateSheet])

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  if (isError && !data) return <div role="alert" className="rounded-[20px] bg-card p-6 text-sm"><p>채점 데이터를 불러오지 못했습니다.</p><Button variant="outline" className="mt-3" onClick={() => void refetch()}>다시 시도</Button></div>

  const entryDirtyCount=new Set([...Object.keys(dirtyFields).filter(key=>key.endsWith(':homework_done')).map(key=>key.slice(0,-14))]).size
  const entryBusy=saving || savingEntries
  const setHomeworkInvalid=(id:string,invalid:boolean)=>setInvalidHomework(previous=>{const next=new Set(previous);if(invalid)next.add(id);else next.delete(id);return next})
  async function saveEntries(){
    if(entryBusy || pendingDrafts > 0 || invalidHomework.size || (!hasUnsavedChanges))return
    setSavingEntries(true);setEntryError(null)
    const failures:string[]=[]
    try{
      for(const row of rowsRef.current.filter(row=>dirtyRef.current[`${row.student_id}:homework_done`])){
        try{await saveHomework(row.student_id,row.homework_done)}catch{failures.push(`${row.student_name} 숙제`)}
      }
      for(const row of rowsRef.current.filter(row=>dirtyRef.current[`${row.student_id}:memo`])){
        const snapshot=capture([row.student_id],['memo'])
        try{await saveWeekScore.mutateAsync({student_id:row.student_id,grade_version:row.grade_version,memo:row.memo});acknowledge(snapshot)}catch{failures.push(`${row.student_name} 메모`)}
      }
      const answerRows=rowsRef.current.filter(row=>Object.keys(capture([row.student_id],['answers','reading_present','reading_correct'])).length)
      if(answerRows.length && await persistDraft(answerRows)===false)failures.push('답안')
      const residual=Object.keys(dirtyRef.current).some(key=>!['homework_done','memo','answers','reading_present','reading_correct'].some(field=>key.endsWith(`:${field}`)))
      if(residual && failures.length===0){
        const snapshot=capture(rowsRef.current.map(row=>row.student_id))
        try{await saveWithoutAI.mutateAsync(snapshotGradeRows(rowsRef.current));acknowledge(snapshot)}catch{failures.push('성적')}
      }
      if(!failures.length)setDraftSaved(true)
      if(failures.length)setEntryError(`${failures.join(', ')} 저장 실패 · 입력은 유지됩니다. 저장을 다시 눌러 주세요.`)
    }finally{setSavingEntries(false)}
  }
  const questions: ExamQuestion[] = data?.questions ?? []
  const students = data?.classStudents ?? []

  if (students.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">수강 학생이 없어요. 먼저 학생을 배정해주세요.</p>
  }

  const activeQuestions = questions.filter((q) => !q.is_void)
  const effectiveReadingTotal = activeQuestions.length > 0 ? activeQuestions.length : readingTotal
  const hasSubjective = activeQuestions.some((q) => q.question_style === 'subjective' || q.question_style === 'find_error')

  // 저장 중 표시할 진행 요약 — AI 채점은 몇십 초 걸릴 수 있어 무엇을 처리 중인지 알려준다
  const savingSummary = (() => {
    const present = rows.filter(row=>row.reading_present)
    if (!hasSubjective) return `학생 ${present.length}명`
    const subjectiveCount = present.reduce((n, r) => n + r.answers.filter((a) => {
      const q = questions.find((x) => x.id === a.exam_question_id)
      return (q?.question_style === 'subjective' || q?.question_style === 'find_error') && !!a.student_answer_text?.trim()
    }).length, 0)
    return `학생 ${present.length}명 · 서술형 ${subjectiveCount}건`
  })()
  const showVocab = vocabTotal > 0
  const showExam = readingTotal > 0 || questions.length > 0

  const attendanceCounts = { present: 0, late: 0, absent: 0, missing: 0 }
  for (const row of rows) {
    const status = attendanceStatuses.get(row.student_id)
    if (status === 'present' || status === 'late' || status === 'absent') attendanceCounts[status] += 1
    else attendanceCounts.missing += 1
  }
  const reviewCount = buildReviewQueue(questions, rows).length

  return (
    <div className="space-y-3">
      <UnsavedChangesGuard preserveTabNavigation dirty={hasUnsavedChanges || recovery !== null || invalidHomework.size > 0} busy={savingEntries || saving || pendingDrafts > 0 || saveWeekScore.isPending} />
      <Dialog open={recoveryReady && recoveryHasConflict}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" showCloseButton={false} onEscapeKeyDown={event=>event.preventDefault()} onInteractOutside={event=>event.preventDefault()}>
          <DialogHeader><DialogTitle>다른 수정 내용이 있습니다</DialogTitle><DialogDescription>{recoveryQuestionsMatch ? '입력 중이던 내용과 서버의 최신 답안이 다릅니다. 사용할 내용을 확인해 주세요.' : '문항이 변경됐습니다. 이전 입력을 확인한 뒤 최신 문항으로 계속해 주세요.'}</DialogDescription></DialogHeader>
          {recovery?.rows.map(cached => <div key={cached.student_id} className="space-y-2 border-t border-border pt-3"><p className="text-sm font-semibold">{cached.student_name}</p><div className="grid gap-3 sm:grid-cols-2">{[{label:'서버의 최신 답안',row:rows.find(row=>row.student_id===cached.student_id)},{label:'입력 중이던 답안',row:cached}].map(({label,row})=><div key={label} className="rounded-xl bg-muted p-3"><p className="mb-2 text-xs text-muted-foreground">{label}</p>{row?.answers.map((answer,index)=><p key={answer.exam_question_id} className="whitespace-pre-wrap break-words text-sm">{index+1}. {answer.student_answer_text || answer.student_answer || '—'}</p>)}{row?.memo && <p className="mt-2 text-sm">메모: {row.memo}</p>}</div>)}</div></div>)}
          <DialogFooter><Button variant="outline" onClick={()=>applyRecoveredInputs(false)}>최신 자료 사용</Button><Button disabled={!recoveryQuestionsMatch} onClick={()=>applyRecoveredInputs(true)}>입력한 내용 유지</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {cacheFailed && <p role="alert" className="text-xs text-[var(--share-red)]">브라우저 보관에 실패했습니다. 답안은 현재 화면에 유지되지만 저장이 끝나기 전에 새로고침하지 마세요.</p>}
      {failedStudents.size > 0 && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--share-red-bg)] p-3 text-sm text-[var(--share-red)]"><span>임시 저장 실패 · {rows.filter(row => failedStudents.has(row.student_id)).map(row => row.student_name).join(', ')} · 입력은 유지됩니다.</span><Button size="sm" variant="outline" disabled={saving || pendingDrafts > 0} onClick={() => persistDraft(rowsRef.current.filter(row => failedStudents.has(row.student_id)))}>다시 저장</Button><span className="text-xs">{draftError}</span></div>}
      {isError && <p role="alert" className="text-xs text-[var(--share-red)]">최신 데이터를 불러오지 못했습니다. 현재 입력은 유지됩니다.</p>}

      {rows.some((row) => row.grade_conflict) && (
        <p role="alert" className="text-sm text-[var(--share-red)]">다른 저장과 겹친 편집이 있습니다. 입력 내용은 유지됩니다. 변경 내용을 확인한 뒤 다시 불러와 주세요.</p>
      )}
      {questions.length === 0 && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          진단평가 채점 칸은 설정 → 해설지 탭에서 PDF를 올리면 자동으로 생성됩니다.
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 border-y border-border py-3 sm:gap-8" aria-label="수업 운영 요약">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="text-xs font-medium text-muted-foreground">학생</p><p className="text-xl font-bold leading-tight tracking-tight">{rows.length}<span className="ml-1 text-xs font-medium text-muted-foreground">명</span></p></div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="text-xs font-medium text-muted-foreground">출결</p><p className="text-xl font-bold leading-tight tracking-tight">{attendanceCounts.present + attendanceCounts.late}<span className="ml-1 text-xs font-medium text-muted-foreground">/ {rows.length}</span></p><p className="text-[11px] text-muted-foreground">{attendanceCounts.late > 0 && <span className="mr-2 font-semibold text-foreground">지각 {attendanceCounts.late}</span>}{attendanceCounts.absent > 0 && <span className="mr-2 text-[var(--share-red)]">결석 {attendanceCounts.absent}</span>}{attendanceCounts.missing > 0 && <span>미기록 {attendanceCounts.missing}</span>}</p></div>
        <button type="button" aria-label={`검토 필요 ${reviewCount}건 보기`} disabled={!reviewCount || saving || pendingDrafts > 0} onClick={() => {
          setShowReviewPanel(true)
          reviewPanelRef.current?.scrollIntoView?.({ block: 'start' })
        }} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg text-left enabled:cursor-pointer enabled:hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span className="text-xs font-medium text-muted-foreground">검토 필요</span><span className={cn('text-xl font-bold leading-tight tracking-tight', reviewCount > 0 ? 'text-[var(--share-red)]' : 'text-foreground')}>{reviewCount}<span className="ml-1 text-xs font-medium text-muted-foreground">건</span></span></button>
      </div>

      {attendanceQuery.isError && <p role="alert" className="text-xs text-[var(--share-red)]">출결 조회 실패 · <button onClick={()=>void attendanceQuery.refetch()}>다시 조회</button></p>}
      {/* 일괄 사진 처리 */}
        <div className="grid grid-cols-2 items-center gap-2 pt-2 sm:flex sm:flex-wrap sm:justify-end">
          <div className="col-span-2 mr-auto flex items-baseline gap-2"><h2 className="text-[15px] font-bold text-foreground">학생별 성적</h2></div>

          {onOpenAttendance && <Button className="h-12 gap-2 text-sm sm:h-10" variant="outline" onClick={onOpenAttendance} disabled={entryBusy || pendingDrafts > 0}><CalendarCheck2 aria-hidden="true" className="size-4" />출결 관리</Button>}
          {questions.length > 0 && (
            <Button variant="outline"
              type="button"
              aria-label="독해 사진 채점" title="사진을 올려 학생별 답안을 입력합니다" disabled={saving || pendingDrafts > 0}
              onClick={() => setExamBatchOpen(true)}
              className="h-12 gap-2 text-sm sm:h-10"
            >
              <Camera className="h-3.5 w-3.5" />
              <span>독해 사진 채점</span>
            </Button>
          )}
          {showVocab && (
          <Button variant="outline"
            type="button"
            aria-label="단어 사진 채점" title="단어 시험지 사진을 올려 채점합니다" disabled={saving || pendingDrafts > 0}
            onClick={() => setBatchOpen(true)}
            className="h-12 gap-2 text-sm sm:h-10"
          >
            <Images className="h-3.5 w-3.5" />
            <span>단어 사진 채점</span>
          </Button>
          )}
          {hasSubjective && (() => {
            const needsReviewCount = reviewCount
            return (
              <Button variant="outline"
                type="button"
                aria-label="검토할 답안" aria-pressed={showReviewPanel} title="AI 채점 결과를 확인하고 수정합니다" disabled={saving || pendingDrafts > 0}
                onClick={() => setShowReviewPanel((v) => !v)}
                className={cn('h-12 gap-2 text-sm sm:h-10', showReviewPanel && 'border-[var(--share-blue)] bg-[var(--share-blue-bg)] text-[var(--share-blue)]')}
              >
                <ListChecks aria-hidden="true" className="size-4" />
                <span>{showReviewPanel ? "성적표로" : needsReviewCount ? "검토 필요" : "답안 검토"}</span>
                {needsReviewCount > 0 && (
                  <span className="bg-muted text-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {needsReviewCount}
                  </span>
                )}
              </Button>
            )
          })()}
          <ExamBatchGradeDialog
            open={active && examBatchOpen}
            onOpenChange={setExamBatchOpen}
            weekId={weekId}
            questionCount={activeQuestions.length}
            students={rows.map((r) => ({
              student_id: r.student_id,
              student_name: r.student_name,
              present: r.present,
              hasExisting: r.answers.some((a) => a.student_answer !== null || !!a.student_answer_text),
            }))}
            onApplied={applyExamOcr}
            continueDisabled={saving || pendingDrafts > 0 || savingEntries || recovery !== null || invalidHomework.size > 0}
            onContinue={async (studentIds) => {
              if (pendingDraftsRef.current > 0 || recovery) throw new Error('답안 저장이 끝난 뒤 다시 시도해 주세요.')
              const targets = rowsRef.current.filter(row => studentIds.includes(row.student_id))
              if (!targets.length) throw new Error('채점할 답안이 없습니다.')
              const snapshot = capture(studentIds)
              await saveGrade.mutateAsync(snapshotGradeRows(targets))
              acknowledge(snapshot)
              setFailedStudents(previous => new Set([...previous].filter(id => !studentIds.includes(id))))
              setServerRevision(version => version + 1)
              setDraftError(null)
              setSavedAt(new Date())
              setShowReviewPanel(hasSubjective)
              onSaved?.()
            }}
          />
          <VocabBatchGradeDialog
            open={active && batchOpen}
            onOpenChange={setBatchOpen}
            weekId={weekId}
            students={rows.map((r) => ({
              student_id: r.student_id,
              student_name: r.student_name,
              present: r.present,
              hasExisting: r.vocab_correct !== null,
            }))}
            onGraded={(studentId, vocabCorrect) => {
              updateRow(studentId, 'vocab_correct', vocabCorrect)
              acknowledge(capture([studentId], ['vocab_correct']))
              queryClient.refetchQueries({ queryKey: ['grade', weekId] })
            }}
          />
        </div>

      {/* 채점 영역 — 저장 중에는 이 블록 전체를 덮는다.
          예전엔 테이블에만 오버레이가 걸려서 아래 저장줄·검토 패널은 그대로 눌렸고,
          그때 편집한 내용은 저장 완료 후 refetch 로 조용히 덮였다. 범위를 실제 영향 범위로 맞춘다. */}
      <div className={cn("grid items-start gap-4", active && sheetView && "min-[1200px]:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]")}><div className={cn("relative min-w-0 space-y-3", active && sheetView && "min-[1200px]:max-h-[calc(100dvh-2rem)] min-[1200px]:overflow-y-auto min-[1200px]:overscroll-contain")}>
        {saveGrade.isPending && (
          <div className="absolute inset-0 z-20 flex items-start justify-center rounded-xl bg-card/80 backdrop-blur-[1px]">
            <div className="mt-16 flex flex-col items-center gap-2 text-sm text-gray-600">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
              <span className="font-medium">{hasSubjective ? 'AI 채점 중…' : '저장 중…'}</span>
              <span className="text-xs text-gray-400">
                {savingSummary}
              </span>
              <span className="text-[11px] text-gray-300">완료될 때까지 이 화면은 편집할 수 없습니다</span>
            </div>
          </div>
        )}

      <MobileGradeCards rows={rows} vocabTotal={vocabTotal} readingTotal={effectiveReadingTotal} homeworkTotal={homeworkTotal} showExam={showExam} saving={entryBusy} shareTokens={shareTokens} onOpenAttendance={onOpenAttendance} attendanceStatuses={attendanceStatuses}
        onUpdate={updateRow} onScoreSave={saveMetadata} onHomeworkValidity={setHomeworkInvalid}
        onOpen={(type,studentIndex) => changeSheet({ type, studentId: rows[studentIndex].student_id })} />
      {/* 테이블 */}
      <div className={cn("hidden overflow-x-auto rounded-xl border border-border bg-background md:block", active && sheetView && "min-[1200px]:[&_[data-grade-secondary]]:hidden min-[1200px]:[&_th]:w-auto min-[1200px]:[&_td]:whitespace-nowrap min-[1200px]:[&_[data-grade-student]]:min-w-20 min-[1200px]:[&_td]:py-2  min-[1200px]:[&_td]:px-1.5 min-[1200px]:[&_th]:px-2")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">학생</th>
              {onOpenAttendance && <th className="w-24 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">출결</th>}
              {showVocab && <th className="w-24 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">단어</th>}
              {showExam && <th className="w-24 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">독해</th>}
              {homeworkTotal > 0 && <th className="w-36 px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground">숙제</th>}
              <th data-grade-secondary className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.student_id} aria-selected={sheetView?.studentId === row.student_id} className={cn('transition-colors hover:bg-[var(--control-bg)]', sheetView?.studentId === row.student_id && 'bg-[var(--share-blue-bg)]')}>
                {/* 학생명 */}
                <td data-grade-student className="px-3 py-3 text-[13px] font-semibold text-foreground"><div className="flex flex-wrap items-center gap-x-1 gap-y-1"><span>{row.student_name}</span>{shareTokens.get(row.student_id) && <ParentReportLink token={shareTokens.get(row.student_id)!} studentName={row.student_name} />}</div></td>
                {onOpenAttendance && <td className="px-2 py-2 text-center"><AttendanceStatus studentName={row.student_name} status={attendanceStatuses.get(row.student_id)} /></td>}

                {/* 단어 셀 */}
                {showVocab && (
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      disabled={saving || workspaceBusy}
                      aria-label={`${row.student_name} 단어 답안 열기`}
                      onClick={() => changeSheet({ type: 'vocab', studentId: row.student_id })}
                      className={cn(
                        'group inline-flex min-h-9 min-w-20 items-center justify-between gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                        row.vocab_correct !== null
                            ? 'text-foreground'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      )}
                    >
                      <GradeScoreValue correct={row.vocab_correct} total={vocabTotal} nullLabel="미응시" /><GradeEditIcon />
                    </button>
                  </td>
                )}

                {/* 시험 셀 */}
                {showExam && (
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      disabled={saving || workspaceBusy}
                      aria-label={`${row.student_name} 시험 답안 열기`}
                      onClick={() => changeSheet({ type: 'exam', studentId: row.student_id })}
                      className={cn(
                        'group inline-flex min-h-9 min-w-20 items-center justify-between gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring',
                        row.reading_correct !== null
                            ? 'text-foreground'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      )}
                    >
                      <GradeScoreValue correct={row.reading_correct} total={effectiveReadingTotal} participating={row.reading_present} /><GradeEditIcon />
                    </button>
                  </td>
                )}

                {/* 숙제: null/0/소수를 그대로 기존 PATCH 경로로 저장 */}
                {homeworkTotal > 0 && <td className="px-2 py-2"><HomeworkInlineInput studentName={row.student_name} value={row.homework_done} total={homeworkTotal} disabled={entryBusy} onChange={value=>updateRow(row.student_id,'homework_done',value)} onValidityChange={invalid=>setHomeworkInvalid(row.student_id,invalid)}/>{dirtyFields[`${row.student_id}:homework_done`] && <span className="block text-center text-[10px] text-[var(--share-blue)]">변경됨</span>}</td>}

                {/* 메모 */}
                <td data-grade-secondary className="px-3 py-3">
                  <input
                    aria-label={`${row.student_name} 메모`}
                    value={row.memo}
                    onChange={(e) => updateRow(row.student_id, 'memo', e.target.value)}
                    onBlur={(e) => saveMetadata({ ...row, memo: e.target.value })}
                    disabled={saving}
                    placeholder="메모"
                    className="w-full text-xs h-7 bg-transparent outline-none placeholder:text-gray-300 text-gray-700 disabled:cursor-not-allowed"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mr-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span>{pendingDrafts > 0 ? `백그라운드 저장 중 · ${pendingDrafts}건` : saving ? '저장 중…' : hasUnsavedChanges ? '미저장 변경이 있습니다' : draftSaved ? '저장됨'   : '저장할 변경 없음'}</span>

      </div>
      {/* 저장 버튼 영역 */}
      {!showReviewPanel && <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background py-3 md:pr-28 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="text-xs text-gray-400">
          전체 {rows.length}명{entryDirtyCount>0 && ` · 숙제 변경 ${entryDirtyCount}명`}
          <span className="sr-only">{hasSubjective ? '저장: 입력 내용 보관 · AI 채점: 서술형 채점' : '저장: 입력 내용 보관'}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {entryError && <p role="alert" className="basis-full text-xs text-[var(--share-red)]">{entryError}</p>}
          <Button size="sm" variant="action" title="입력 내용 저장 · AI 채점 없음" disabled={entryBusy || pendingDrafts>0 || invalidHomework.size>0 || (!hasUnsavedChanges)} onClick={()=>void saveEntries()}>{savingEntries?'저장 중…':'저장'}</Button>
          {savedAt && (
            <span className="flex items-center gap-1 text-xs text-[var(--share-blue)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              AI 채점 완료 ({savedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})
            </span>
          )}

          {hasSubjective && <Button
            variant="outline"
            title="서술형 AI 채점 및 저장"
            onClick={() => setGradeConfirmOpen(true)}
            disabled={saving || savingEntries || invalidHomework.size>0 || pendingDrafts > 0 || recovery !== null}
          >
            {saveGrade.isPending ? '채점 중…' : '서술형 채점'}
          </Button>}
        </div>
      </div>}

      <Dialog open={active && gradeConfirmOpen} onOpenChange={setGradeConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>서술형 답안을 채점할까요?</DialogTitle>
            <DialogDescription>입력된 답안을 AI로 채점하고 결과를 저장합니다. 교사가 확정한 판정은 유지됩니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setGradeConfirmOpen(false)}>취소</Button>
            <Button type="button" variant="action" className="min-h-11"
              disabled={saving || savingEntries || invalidHomework.size > 0 || pendingDrafts > 0 || recovery !== null}
            onClick={() => {
              if (saving || savingEntries || invalidHomework.size > 0 || pendingDraftsRef.current > 0 || recovery) return
              setGradeConfirmOpen(false)
              setSavedAt(null)
              const snapshot = capture(rows.map(row => row.student_id))
              saveGrade.mutate(rows, {
                onSuccess: () => {
                  acknowledge(snapshot)
                  setFailedStudents(new Set())
                  setServerRevision(version => version + 1)
                  setDraftError(null)
                  setSavedAt(new Date())
                  setShowReviewPanel(true)
                  if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
                  savedTimerRef.current = setTimeout(() => setSavedAt(null), 10000)
                  onSaved?.()
                },
              })
            }}>채점 시작</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 서술형 검토 패널 */}
      {showReviewPanel && hasSubjective && (
        <div ref={revealReview} className="rounded-xl border bg-background p-4">
          <SubjectiveReviewPanel
            weekId={weekId}
            questions={questions}
            rows={rows}
            onDone={() => setShowReviewPanel(false)}
          />
        </div>
      )}
      </div>

      <AnswerWorkspace open={active && sheetView !== null} onClose={() => changeSheet(null)} busy={saving || workspaceBusy} description={sheetView?.type === 'vocab' ? '단어 답안과 원본 사진을 확인합니다.' : '독해 답안과 원본 사진을 확인합니다.'}>
          {sheetRow && sheetView && (
            <>
              {/* 헤더: 학생명 + 이전/다음 */}
              <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-background z-10 gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{sheetRow.student_name}</h3>
                  <span className="text-xs text-gray-400">{sheetIndex + 1}/{rows.length}</span>
                  <div className="flex rounded-lg bg-muted p-0.5" aria-label="채점 과목">
                    {([{type:'vocab',label:'단어',visible:showVocab},{type:'exam',label:'독해',visible:showExam}] as const).filter(item=>item.visible).map(item=><button key={item.type} type="button" aria-pressed={sheetView.type===item.type} disabled={saving || workspaceBusy} onClick={()=>changeSheet({type:item.type,studentId:sheetRow.student_id})} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold',sheetView.type===item.type?'bg-background text-[var(--share-blue)]':'text-muted-foreground')}>{item.label}</button>)}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="이전 학생"
                    onClick={() => navigateSheet(-1)}
                    disabled={saving || workspaceBusy || sheetIndex === 0}
                    className="flex size-9 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="다음 학생"
                    onClick={() => navigateSheet(1)}
                    disabled={saving || workspaceBusy || sheetIndex === rows.length - 1}
                    className="flex size-9 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="답안 닫기"
                    disabled={saving || workspaceBusy}
                    onClick={() => changeSheet(null)}
                    className="flex size-9 items-center justify-center rounded-lg hover:bg-muted transition-colors ml-1"
                  >
                    <X className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              </div>

              {navigationSaving && <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900">변경된 답안이 있습니다. 저장 후 이동합니다.</div>}
              <div key={`${sheetView.type}:${sheetRow.student_id}`} className={cn("relative min-h-48 flex-1", workspaceBusy ? "overflow-hidden" : "overflow-y-auto")}>
              {workspaceBusy && <div className="absolute inset-0 z-30 grid place-items-center bg-gray-100/90" role="status" aria-live="polite">
                <div className="w-56 space-y-3 rounded-xl border border-border bg-background p-5 text-center">
                  <LoaderCircle aria-hidden="true" className="mx-auto size-6 animate-spin text-[var(--share-blue)] motion-reduce:animate-none" />
                  <p className="text-sm font-semibold">{saving ? 'AI 채점 중…' : '답안 저장 중…'}</p>
                  <div role="progressbar" aria-label="답안 임시 저장" aria-valuetext="저장 중" className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-full animate-pulse bg-[var(--share-blue)] motion-reduce:animate-none" /></div>
                </div>
              </div>}
              <fieldset disabled={saving || workspaceBusy} className="m-0 min-w-0 border-0 p-0">
              {sheetView.type === 'vocab' && (
                <VocabSheetContent
                  key={sheetRow.student_id}
                  row={sheetRow}
                  weekId={weekId}
                  saveQueue={saveQueue}
                  onVersionsSaved={syncVersions}
                  weekScoreId={weekScoreIdMap.get(sheetRow.student_id) ?? ''}
                  vocabAnswers={vocabAnswerMap.get(sheetRow.student_id) ?? EMPTY_VOCAB}
                  vocabPhotoPath={vocabPhotoPathMap.get(sheetRow.student_id) ?? null}
                  updateRow={updateRow}
                />
              )}
              {sheetView.type === 'exam' && (
                <ExamSheetContent
                  key={sheetRow.student_id}
                  weekId={weekId}
                  row={sheetRow}
                  questions={activeQuestions}
                  readingTotal={effectiveReadingTotal}
                  examPhotoPath={examPhotoPathMap.get(sheetRow.student_id) ?? null}
                  updateRow={updateRow}
                  updateAnswer={updateAnswer}
                  updateAnswerText={updateAnswerText}
                />
              )}
              </fieldset>
              </div>
              <div className="sticky bottom-0 z-10 mt-auto space-y-2 border-t border-border bg-background px-4 py-3 min-[1200px]:pr-24 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {failedStudents.size > 0 && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[var(--share-red)]"><span>저장 실패 · {rows.filter(row => failedStudents.has(row.student_id)).map(row => row.student_name).join(', ')} · 답안 보관 중</span><Button size="sm" variant="outline" disabled={saving || pendingDrafts > 0} onClick={() => persistDraft(rowsRef.current.filter(row => failedStudents.has(row.student_id)))}>다시 저장</Button></div>}
                <div className="flex items-center justify-between gap-3">
                  <p role="status" className="text-xs text-muted-foreground">{workspaceBusy ? '저장 중…' : sheetView.type === 'exam' && Object.keys(capture([sheetRow.student_id], ['answers', 'reading_present', 'reading_correct'])).length ? '변경됨' : '저장됨'}</p>
                  <Button variant="outline" size="sm" disabled={saving || workspaceBusy} aria-label="전체 성적표" title="전체 성적표" onClick={() => changeSheet(null)}><Table2 aria-hidden="true" className="size-4" /></Button>
                </div>
              </div>
            </>
          )}
      </AnswerWorkspace>
      </div>
    </div>
  )
}
