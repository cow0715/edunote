'use client'

import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ExamBatchGradeDialog } from '@/components/grade/exam-batch-grade-dialog'
import { VocabBatchGradeDialog } from '@/components/grade/vocab-batch-grade-dialog'
import { ExamSheetContent } from '@/components/grade/exam-sheet-content'
import { VocabSheetContent, type VocabAnswerRow } from '@/components/grade/vocab-sheet-content'
import { CaptureRuntimeProvider } from '@/components/grade/capture-runtime'
import type { ExamOcrResult } from '@/components/grade/exam-photo-button'
import type { GradeRow } from '@/hooks/use-grade'
import type { ExamQuestion } from '@/lib/types'
import { createSampleCaptureRuntime, sampleBatchStudents, sampleStudents, sampleWeek, type SampleBatchStats } from './sample-runtime'

type Subject = '독해' | '단어'
type Mode = '일괄' | '개별'
const questions: ExamQuestion[] = Array.from({ length: 10 }, (_, index) => ({
  id: `sample-question-${index + 1}`, week_id: sampleWeek, question_number: index + 1, sub_label: null,
  question_type: null, question_text: null, question_stem: null, passage: null, choices: null,
  correct_answer: index % 5 + 1, correct_answer_text: null, extra_correct_answers: [], grading_criteria: null,
  explanation: null, needs_source_image: false, source_image_reason: null, source_page: null,
  source_bbox: null, source_image_path: null, exam_type: 'reading', question_style: 'objective',
  is_void: false, all_correct: false, created_at: '',
}))
function initialRows(roster: typeof sampleStudents): GradeRow[] {
  return roster.map((student) => ({ ...student, grade_version: { score_id: `score-${student.student_id}`, revision: 0 },
    vocab_correct: null, reading_present: true, reading_correct: null, homework_done: null, memo: '',
    answers: questions.map((question) => ({ exam_question_id: question.id, student_answer: null })),
  }))
}

function CaptureScenario({ subject, mode, studentId, review, largeBatch }: {
  subject: Subject; mode: Mode; studentId: string; review: boolean; largeBatch: boolean
}) {
  const batchReview = review && subject === '독해' && mode === '일괄'
  const useLargeBatch = batchReview && largeBatch
  const roster = useLargeBatch ? sampleBatchStudents : sampleStudents
  const [stats, setStats] = useState<SampleBatchStats>({ active: 0, peak: 0, uploads: 0, reads: 0, grades: 0, storedAtFirstRead: null, retried: [] })
  const runtime = useMemo(() => createSampleCaptureRuntime(subject, mode === '개별' ? studentId : undefined, batchReview,
    useLargeBatch ? setStats : undefined), [subject, mode, studentId, batchReview, useLargeBatch])
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }))
  useEffect(() => () => client.clear(), [client])
  const [rows, setRows] = useState(() => initialRows(roster))
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const row = rows.find((entry) => entry.student_id === studentId)!
  const updateRow = (id: string, key: keyof GradeRow, value: unknown) => {
    setRows((previous) => previous.map((entry) => entry.student_id === id ? { ...entry, [key]: value } : entry))
  }
  const applyReading = (id: string, results: ExamOcrResult[], path: string) => {
    setRows((previous) => previous.map((entry) => entry.student_id !== id ? entry : { ...entry, exam_photo_path: path,
      answers: entry.answers.map((answer, index) => ({ ...answer, student_answer: results.find((result) => result.question_number === index + 1)?.student_answer ?? null })) }))
    setEvents((previous) => [...previous, `${sampleStudents.find((student) => student.student_id === id)!.student_name} · ${results.length}문항 인식 (샘플)`])
    return results.length
  }
  const vocabAnswers: VocabAnswerRow[] = row.vocab_correct === null ? [] : Array.from({ length: 10 }, (_, index) => ({
    id: `sample-answer-${index + 1}`, number: index + 1, english_word: ['apple', 'bright', 'decide', 'earth', 'friend'][index % 5],
    student_answer: ['사과', '밝은', '결정하다', '지구', '친구'][index % 5], is_correct: index < 9, teacher_locked: false,
  }))
  const batchStatus = useLargeBatch && (
    <div aria-label="샘플 사진 처리 집계" className="mb-3 space-y-1 rounded-xl bg-[var(--share-box)] p-3 text-xs text-[var(--share-body)]">
      <p>동시 OCR {stats.active}장 · 최대 {stats.peak}장</p>
      <p>사진 저장 {stats.uploads}장 · OCR 요청 {stats.reads}건</p>
      <p>채점 요청 {stats.grades}건</p>
      {stats.storedAtFirstRead !== null && <p>첫 OCR 전 저장 확인 {stats.storedAtFirstRead}장</p>}
      <p>재시도 {stats.retried.length ? stats.retried.join(', ') : '0장'}</p>
    </div>
  )
  return <CaptureRuntimeProvider value={runtime}><QueryClientProvider client={client}>
    <div className="space-y-4 rounded-[20px] bg-[var(--share-card)] p-4">
      <p className="text-sm text-[var(--share-body)]">{useLargeBatch
        ? '촬영 창에서 ‘사진 추가’를 누르면 샘플 15장이 들어갑니다. 학생을 확인하면 8번 사진의 첫 OCR만 실패합니다.'
        : mode === '일괄' ? '실제 일괄 촬영 창에서 ‘사진 추가’를 누르면 샘플 두 장이 들어갑니다. ‘연속 촬영’은 가상 답안지 영상을 보여줍니다.'
          : '선택한 학생의 실제 개별 채점 패널입니다. 촬영 버튼을 누르면 샘플 사진이 바로 처리됩니다.'}</p>
      <Button variant="action" onClick={() => setOpen(true)}>{mode === '일괄' ? '일괄 촬영 열기' : `${row.student_name} 개별 촬영 열기`}</Button>
      {mode === '일괄' && subject === '독해' && (batchReview ? (
        <ExamBatchGradeDialog open={open} onOpenChange={setOpen} weekId={sampleWeek} students={roster} questionCount={10} statusDetails={batchStatus}
          questions={questions.map((question) => question.question_number === 10
            ? { ...question, question_style: 'subjective', correct_answer_text: 'They work together.' } : question)}
          prepareOcr={(id, results, path) => ({
            applied: results.length,
            row: { ...rows.find((entry) => entry.student_id === id)!, exam_photo_path: path,
              answers: questions.map((question) => {
                const result = results.find((answer) => answer.question_number === question.question_number)
                return { exam_question_id: question.id, student_answer: result?.student_answer ?? null, student_answer_text: result?.student_answer_text }
              }) },
          })}
          onFinalize={async (graded, jobId) => {
            runtime.finalizeJob(jobId, graded)
            setRows((previous) => previous.map((entry) => graded.find((result) => result.student_id === entry.student_id) ?? entry))
            setEvents(graded.map((entry) => `${entry.student_name} · ${entry.answers.filter((answer) => answer.is_correct).length}/10 확정 완료 (샘플)`))
          }}
        />
      ) : <ExamBatchGradeDialog open={open} onOpenChange={setOpen} weekId={sampleWeek}
        students={sampleStudents} questionCount={10} onApplied={applyReading} />)}
      {mode === '일괄' && subject === '단어' && <VocabBatchGradeDialog open={open} onOpenChange={setOpen} weekId={sampleWeek}
        students={sampleStudents} onGraded={(id, correct, total) => {
          updateRow(id, 'vocab_correct', correct)
          setEvents((previous) => [...previous, `${sampleStudents.find((student) => student.student_id === id)!.student_name} · ${correct}/${total} 채점·저장 (샘플)`])
        }} />}
      {mode === '개별' && <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full p-0 sm:w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="border-b px-4 py-4"><SheetTitle>{row.student_name} · {subject}</SheetTitle><SheetDescription>샘플 학생의 실제 개별 채점 패널입니다.</SheetDescription></SheetHeader>
          {subject === '독해' ? <ExamSheetContent key={studentId} weekId={sampleWeek} row={row} questions={questions}
            readingTotal={10} examPhotoPath={row.exam_photo_path ?? null} updateRow={updateRow}
            updateAnswer={(id, questionId, value) => setRows((previous) => previous.map((entry) => entry.student_id !== id ? entry : { ...entry,
              answers: entry.answers.map((answer) => answer.exam_question_id === questionId ? { ...answer, student_answer: value } : answer) }))}
            updateAnswerText={(id, questionId, value) => setRows((previous) => previous.map((entry) => entry.student_id !== id ? entry : { ...entry,
              answers: entry.answers.map((answer) => answer.exam_question_id === questionId ? { ...answer, student_answer_text: value } : answer) }))} />
            : <VocabSheetContent key={studentId} weekId={sampleWeek} row={row} weekScoreId={`score-${studentId}`}
              vocabAnswers={vocabAnswers} vocabPhotoPath={row.vocab_correct === null ? null : `${sampleWeek}/${studentId}/sample-photo`} updateRow={updateRow} />}
        </SheetContent>
      </Sheet>}
      {events.length > 0 && <>{batchStatus}<ul aria-label="샘플 처리 결과" className="space-y-2 text-sm">{events.map((event, index) => <li key={index}>{event}</li>)}</ul></>}
    </div>
  </QueryClientProvider></CaptureRuntimeProvider>
}

export function ExamStudentConfirmPreview({ review = false }: { review?: boolean }) {
  const [subject, setSubject] = useState<Subject>('독해')
  const [mode, setMode] = useState<Mode>('일괄')
  const [studentId, setStudentId] = useState(sampleStudents[0].student_id)
  const [version, setVersion] = useState(0)
  const [largeBatch, setLargeBatch] = useState(false)
  return <main className="min-h-dvh bg-[var(--share-canvas)] px-4 py-6 text-[var(--share-ink)] sm:px-6">
    <section className="mx-auto max-w-xl space-y-5">
      <div className="rounded-xl bg-[var(--share-box)] p-4 text-xs text-[var(--share-body)]">실제 촬영·채점 컴포넌트 · 샘플 데이터<br />카메라·사진 선택·응답만 가상입니다. 실제 사진·DB·판독 API는 사용하지 않습니다.</div>
      <div className="flex flex-wrap items-center gap-2">
        {(['독해', '단어'] as const).map((value) => <Button key={value} variant={subject === value ? 'outline' : 'ghost'} size="sm" aria-pressed={subject === value} onClick={() => setSubject(value)}>{value} 시험</Button>)}
        {(['일괄', '개별'] as const).map((value) => <Button key={value} variant={mode === value ? 'outline' : 'ghost'} size="sm" aria-pressed={mode === value} onClick={() => setMode(value)}>{value} 촬영</Button>)}
        <Button variant="ghost" size="sm" onClick={() => setVersion((previous) => previous + 1)}>처음으로</Button>
        {review && subject === '독해' && mode === '일괄' && (
          <Button variant="outline" size="sm" aria-pressed={largeBatch} onClick={() => setLargeBatch((current) => !current)}>15장 테스트</Button>
        )}
      </div>
      <h1 className="text-[23px] font-bold">{subject} · {mode} 촬영</h1>
      {mode === '개별' && <label className="block space-y-2 text-sm">학생 선택
        <select className="h-11 w-full rounded-xl border border-[var(--share-line-strong)] bg-[var(--share-canvas)] px-3 text-base" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
          {sampleStudents.map((student) => <option key={student.student_id} value={student.student_id}>{student.student_name}</option>)}
        </select>
      </label>}
      <CaptureScenario key={`${subject}-${mode}-${studentId}-${version}-${largeBatch}`} subject={subject} mode={mode} studentId={studentId} review={review} largeBatch={largeBatch} />
    </section>
  </main>
}
