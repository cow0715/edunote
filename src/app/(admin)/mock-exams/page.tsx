'use client'

import { useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  Loader2,
  Plus,
  Printer,
  Search,
  Send,
  Upload,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useStudents } from '@/hooks/use-students'
import {
  useCreateMockExam,
  useImportMockExamMetadata,
  useMockExam,
  useMockExams,
  useOcrMockExamAnswers,
  usePublishMockExamReport,
  useSaveMockExamResult,
  useUpdateMockExamQuestions,
} from '@/hooks/use-mock-exams'
import type { MockExamQuestion, MockExamResult, StudentWithEnrollments } from '@/lib/types'
import { MOCK_EXAM_TYPE_OPTIONS } from '@/lib/mock-exam'
import { cn } from '@/lib/utils'

type WorkMode = 'setup' | 'grading' | 'reports'

type CreateForm = {
  title: string
  exam_year: string
  exam_month: string
  grade: string
  source: string
  exam_date: string
}

const gradeTabs = [
  { value: '1', label: '고1' },
  { value: '2', label: '고2' },
  { value: '3', label: '고3' },
]

const difficultyLabels = {
  low: '하',
  medium: '중',
  high: '상',
} as const

function blankForm(grade: string): CreateForm {
  const now = new Date()
  return {
    title: `${now.getFullYear()}년 ${now.getMonth() + 1}월 고${grade} 영어 모의고사`,
    exam_year: String(now.getFullYear()),
    exam_month: String(now.getMonth() + 1),
    grade,
    source: '교육청',
    exam_date: now.toISOString().slice(0, 10),
  }
}

function resultRate(correct: number, total: number) {
  if (total <= 0) return '-'
  return `${Math.round((correct / total) * 100)}%`
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'))
    reader.readAsDataURL(file)
  })
}

function latestReport(result: MockExamResult | null | undefined) {
  return result?.mock_exam_report?.find((report) => report.status === 'published') ?? null
}

function normalizeGrade(value: string | number | null | undefined) {
  const match = String(value ?? '').match(/[1-3]/)
  return match?.[0] ?? ''
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildAnswerSheetHtml(title: string, gradeLabel: string) {
  const rows = Array.from({ length: 45 }, (_, index) => {
    const number = index + 1
    const bubbles = [1, 2, 3, 4, 5].map((choice) => `<span>${choice}</span>`).join('')
    return `<div class="row"><b>${number}</b><div class="bubbles">${bubbles}</div></div>`
  }).join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} 답안지</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #111827; font-family: Arial, sans-serif; }
.sheet { height: 273mm; border: 2px solid #111827; padding: 10mm; }
.top { display: grid; grid-template-columns: 1fr 34mm 48mm; gap: 6mm; align-items: end; border-bottom: 2px solid #111827; padding-bottom: 6mm; }
.title { font-size: 20px; font-weight: 800; }
.meta { margin-top: 3mm; font-size: 12px; color: #4b5563; }
.field { border-bottom: 1.5px solid #111827; height: 10mm; font-size: 12px; }
.field span { display: block; color: #6b7280; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm 7mm; margin-top: 7mm; }
.row { display: grid; grid-template-columns: 9mm 1fr; align-items: center; height: 10.6mm; page-break-inside: avoid; }
.row b { font-size: 12px; }
.bubbles { display: flex; justify-content: space-between; gap: 2mm; }
.bubbles span { display: inline-flex; align-items: center; justify-content: center; width: 8mm; height: 8mm; border: 1.5px solid #111827; border-radius: 999px; font-size: 10px; font-weight: 700; }
.foot { margin-top: 5mm; border-top: 1px solid #d1d5db; padding-top: 3mm; font-size: 10px; color: #6b7280; }
@media print { .sheet { height: auto; min-height: 273mm; } }
</style>
</head>
<body>
<main class="sheet">
  <section class="top">
    <div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="meta">${escapeHtml(gradeLabel)} · 영어 모의고사 답안지 · 1~45번</div>
    </div>
    <div class="field"><span>학생명</span></div>
    <div class="field"><span>응시일</span></div>
  </section>
  <section class="grid">${rows}</section>
  <div class="foot">각 문항의 선택지를 진하게 표시한 뒤 촬영 또는 스캔하여 업로드하세요.</div>
</main>
</body>
</html>`
}

export default function MockExamsPage() {
  const [grade, setGrade] = useState('3')
  const [mode, setMode] = useState<WorkMode>('setup')
  const [form, setForm] = useState<CreateForm>(() => blankForm('3'))
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [questionDraft, setQuestionDraft] = useState<MockExamQuestion[] | null>(null)
  const [answers, setAnswers] = useState<Record<number, string> | null>(null)
  const [teacherComment, setTeacherComment] = useState<string | null>(null)
  const [metadataText, setMetadataText] = useState('')
  const metadataInputRef = useRef<HTMLInputElement>(null)
  const ocrInputRef = useRef<HTMLInputElement>(null)

  const { data: exams = [], isLoading: examsLoading } = useMockExams()
  const { data: students = [] } = useStudents()
  const gradeExams = useMemo(
    () => exams.filter((exam) => normalizeGrade(exam.grade) === grade),
    [exams, grade],
  )
  const effectiveExamId = selectedExamId && gradeExams.some((exam) => exam.id === selectedExamId)
    ? selectedExamId
    : gradeExams[0]?.id ?? null
  const { data: detail, isLoading: detailLoading } = useMockExam(effectiveExamId)
  const createExam = useCreateMockExam()
  const importMetadata = useImportMockExamMetadata(effectiveExamId)
  const updateQuestions = useUpdateMockExamQuestions(effectiveExamId)
  const saveResult = useSaveMockExamResult(effectiveExamId)
  const ocrAnswers = useOcrMockExamAnswers(effectiveExamId)
  const publishReport = usePublishMockExamReport(effectiveExamId)

  const selectedExam = detail?.exam ?? gradeExams.find((exam) => exam.id === effectiveExamId) ?? null
  const activeQuestions = questionDraft ?? detail?.questions ?? []
  const incompleteAnswerKeyCount = activeQuestions.filter((question) => !question.is_void && !question.all_correct && !question.correct_answer.trim()).length
  const readyQuestionCount = activeQuestions.length - incompleteAnswerKeyCount
  const typeCount = new Set(activeQuestions.map((question) => question.question_type).filter(Boolean)).size
  const resultByStudentId = useMemo(
    () => new Map((detail?.results ?? []).map((result) => [result.student_id, result])),
    [detail?.results],
  )

  const gradeStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase()
    return students
      .filter((student) => normalizeGrade(student.grade) === grade)
      .filter((student) => !query || student.name.toLowerCase().includes(query) || (student.school ?? '').toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [grade, studentSearch, students])

  const selectedResult = selectedStudentId ? resultByStudentId.get(selectedStudentId) ?? null : null
  const selectedStudent = gradeStudents.find((student) => student.id === selectedStudentId) ?? null

  const savedAnswers = useMemo(() => {
    const nextAnswers: Record<number, string> = {}
    for (const answer of selectedResult?.mock_exam_student_answer ?? []) {
      const questionNumber = answer.mock_exam_question?.question_number
      if (questionNumber) nextAnswers[questionNumber] = answer.student_answer ?? ''
    }
    return nextAnswers
  }, [selectedResult])
  const activeAnswers = answers ?? savedAnswers
  const activeTeacherComment = teacherComment ?? selectedResult?.teacher_comment ?? ''

  function changeGrade(nextGrade: string) {
    setGrade(nextGrade)
    setForm((prev) => ({ ...prev, ...blankForm(nextGrade), source: prev.source }))
    setSelectedExamId(null)
    setSelectedStudentId('')
    setQuestionDraft(null)
    setAnswers(null)
    setTeacherComment(null)
  }

  async function handleCreate() {
    const exam = await createExam.mutateAsync({
      title: form.title,
      class_id: null,
      exam_year: Number(form.exam_year),
      exam_month: Number(form.exam_month),
      grade: Number(form.grade),
      source: form.source,
      exam_date: form.exam_date || null,
    })
    setSelectedExamId(exam.id)
    setMode('setup')
  }

  function handleSelectExam(id: string) {
    setSelectedExamId(id)
    setSelectedStudentId('')
    setQuestionDraft(null)
    setAnswers(null)
    setTeacherComment(null)
  }

  function handleSelectStudent(student: StudentWithEnrollments) {
    setSelectedStudentId(student.id)
    setAnswers(null)
    setTeacherComment(null)
    setMode('grading')
  }

  function updateQuestion(questionNumber: number, patch: Partial<MockExamQuestion>) {
    setQuestionDraft((prev) =>
      (prev ?? detail?.questions ?? []).map((question) =>
        question.question_number === questionNumber ? { ...question, ...patch } : question
      )
    )
  }

  function updateAnswer(questionNumber: number, value: string) {
    setAnswers((prev) => ({
      ...(prev ?? savedAnswers),
      [questionNumber]: value,
    }))
  }

  async function handleMetadataFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !effectiveExamId) return
    const data = await importMetadata.mutateAsync({
      fileData: await readFileAsBase64(file),
      mimeType: file.type,
      fileName: file.name,
    })
    setQuestionDraft(data.questions)
  }

  async function handleMetadataText() {
    if (!metadataText.trim()) {
      toast.error('붙여넣은 메타데이터가 없습니다')
      return
    }
    const data = await importMetadata.mutateAsync({ raw_text: metadataText })
    setQuestionDraft(data.questions)
    setMetadataText('')
  }

  function handleSaveQuestions() {
    updateQuestions.mutate(activeQuestions)
  }

  async function handleOcrFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || !selectedStudentId) return
    if (incompleteAnswerKeyCount > 0) {
      toast.error('정답키가 완성된 뒤 답안지 OCR을 실행할 수 있습니다')
      return
    }

    const payload = await Promise.all(files.map(async (file) => ({
      fileData: await readFileAsBase64(file),
      mimeType: file.type,
      fileName: file.name,
    })))

    const data = await ocrAnswers.mutateAsync({ student_id: selectedStudentId, files: payload })
    const nextAnswers: Record<number, string> = {}
    for (const result of data.results ?? []) {
      nextAnswers[result.question_number] = String(result.student_answer ?? result.student_answer_text ?? '')
    }
    setAnswers(nextAnswers)
  }

  function handleSaveResult() {
    if (!selectedStudentId) return
    saveResult.mutate({
      student_id: selectedStudentId,
      teacher_comment: activeTeacherComment,
      answers: activeQuestions.map((question) => ({
        question_number: question.question_number,
        student_answer: activeAnswers[question.question_number] ?? '',
      })),
    })
  }

  function handlePublish(result: MockExamResult) {
    publishReport.mutate(result.id)
  }

  function reportUrl(token: string) {
    if (typeof window === 'undefined') return `/mock-exam-reports/${token}`
    return `${window.location.origin}/mock-exam-reports/${token}`
  }

  async function handleCopyReportUrl(token: string) {
    await navigator.clipboard.writeText(reportUrl(token))
    toast.success('성적표 링크를 복사했습니다')
  }

  function openAnswerSheet() {
    if (!selectedExam) return

    const iframe = document.createElement('iframe')
    iframe.title = `${selectedExam.title} 답안지`
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'
    document.body.appendChild(iframe)

    const frameWindow = iframe.contentWindow
    const frameDocument = iframe.contentDocument ?? frameWindow?.document
    if (!frameWindow || !frameDocument) {
      iframe.remove()
      toast.error('답안지를 준비하지 못했습니다')
      return
    }

    frameDocument.open()
    frameDocument.write(buildAnswerSheetHtml(selectedExam.title, `고${grade}`))
    frameDocument.close()

    iframe.onload = () => {
      frameWindow.focus()
      frameWindow.print()
      window.setTimeout(() => iframe.remove(), 1000)
    }
  }

  const modeItems = [
    { value: 'setup' as const, label: '등록', icon: FileUp },
    { value: 'grading' as const, label: '채점', icon: Camera },
    { value: 'reports' as const, label: '성적표', icon: BarChart3 },
  ]

  return (
    <div className="min-h-full bg-gradient-to-b from-[#EBF3FF] to-white pb-10 text-[#1A1C1E]">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="flex flex-col gap-4 rounded-[24px] bg-white p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)] lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-[#2463EB]">
              <CheckCircle2 className="h-4 w-4" />
              학년별 모의고사 운영
            </div>
            <h1 className="mt-2 text-3xl font-extrabold">모의고사 성적표</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full bg-slate-100 p-1">
              {gradeTabs.map((item) => (
                <button
                  key={item.value}
                  onClick={() => changeGrade(item.value)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-bold transition',
                    grade === item.value ? 'bg-[#2463EB] text-white shadow-sm' : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Button className="rounded-full bg-[#2463EB]" onClick={handleCreate} disabled={createExam.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              시험 생성
            </Button>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">시험</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-[#8B95A1]">연도</Label>
                  <Input value={form.exam_year} onChange={(event) => setForm({ ...form, exam_year: event.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-[#8B95A1]">월</Label>
                  <Input value={form.exam_month} onChange={(event) => setForm({ ...form, exam_month: event.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-[#8B95A1]">시험명</Label>
                  <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-[#8B95A1]">출처</Label>
                  <Input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-[#8B95A1]">응시일</Label>
                  <Input type="date" value={form.exam_date} onChange={(event) => setForm({ ...form, exam_date: event.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                {examsLoading ? (
                  <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                ) : gradeExams.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-4 text-sm text-[#8B95A1]">고{grade} 시험이 없습니다.</div>
                ) : gradeExams.map((exam) => (
                  <button
                    key={exam.id}
                    onClick={() => handleSelectExam(exam.id)}
                    className={cn(
                      'w-full rounded-2xl p-4 text-left transition',
                      effectiveExamId === exam.id ? 'bg-[#2463EB] text-white' : 'bg-slate-50 text-slate-700 hover:bg-blue-50',
                    )}
                  >
                    <div className="font-bold">{exam.title}</div>
                    <div className={cn('mt-1 text-xs', effectiveExamId === exam.id ? 'text-blue-100' : 'text-slate-400')}>
                      {exam.exam_year}년 {exam.exam_month}월 · 채점 {exam.result_count ?? 0}명
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
              <CardContent className="p-5">
                {!selectedExam ? (
                  <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm font-medium text-[#8B95A1]">
                    고{grade} 시험을 생성하거나 선택하세요.
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-extrabold">{selectedExam.title}</h2>
                        <Badge className={cn('rounded-full', incompleteAnswerKeyCount === 0 ? 'bg-blue-100 text-[#2463EB]' : 'bg-amber-100 text-amber-700')}>
                          {incompleteAnswerKeyCount === 0 ? '채점 가능' : `정답 ${incompleteAnswerKeyCount}개 필요`}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm text-[#8B95A1]">
                        <span>문항 {readyQuestionCount}/45</span>
                        <span>유형 {typeCount}개</span>
                        <span>학생 {gradeStudents.length}명</span>
                        <span>채점 {detail?.results.length ?? 0}명</span>
                      </div>
                    </div>

                    <div className="flex rounded-full bg-slate-100 p-1">
                      {modeItems.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          onClick={() => setMode(value)}
                          className={cn(
                            'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition',
                            mode === value ? 'bg-white text-[#2463EB] shadow-sm' : 'text-slate-500 hover:text-slate-900',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedExam && mode === 'setup' && (
              <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">시험지 / 메타데이터</CardTitle>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={openAnswerSheet}>
                    <Printer className="mr-2 h-4 w-4" />
                    답안지 출력
                  </Button>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <button
                      onClick={() => metadataInputRef.current?.click()}
                      disabled={importMetadata.isPending}
                      className="rounded-[24px] bg-blue-50 p-5 text-left transition hover:bg-blue-100 disabled:opacity-60"
                    >
                      {importMetadata.isPending ? <Loader2 className="h-5 w-5 animate-spin text-[#2463EB]" /> : <Upload className="h-5 w-5 text-[#2463EB]" />}
                      <div className="mt-4 text-base font-extrabold">PDF 업로드</div>
                      <div className="mt-1 text-sm text-[#8B95A1]">시험지, 해설지, 정답표</div>
                    </button>
                    <div className="rounded-[24px] bg-slate-50 p-5">
                      <div className="text-sm text-[#8B95A1]">정답 준비</div>
                      <div className="mt-2 text-3xl font-extrabold text-[#2463EB]">{readyQuestionCount}</div>
                      <div className="text-sm text-[#8B95A1]">/ 45문항</div>
                    </div>
                    <div className="rounded-[24px] bg-slate-50 p-5">
                      <div className="text-sm text-[#8B95A1]">총 배점</div>
                      <div className="mt-2 text-3xl font-extrabold text-[#1A1C1E]">
                        {activeQuestions.reduce((sum, question) => sum + (question.is_void ? 0 : Number(question.points ?? 0)), 0)}
                      </div>
                      <div className="text-sm text-[#8B95A1]">점</div>
                    </div>
                  </div>

                  <input ref={metadataInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={handleMetadataFile} />

                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Textarea
                      value={metadataText}
                      onChange={(event) => setMetadataText(event.target.value)}
                      placeholder="정답표나 메타데이터를 붙여넣으세요. 예: 1번 3번 2점 듣기 / 18번 2번 2점 목적"
                      className="min-h-28 rounded-2xl"
                    />
                    <Button className="rounded-full bg-[#2463EB] px-6" onClick={handleMetadataText} disabled={importMetadata.isPending || !effectiveExamId}>
                      {importMetadata.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
                      반영
                    </Button>
                  </div>

                  <details className="rounded-[24px] bg-slate-50 p-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-700">문항 메타데이터 검수</summary>
                    <div className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-white">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="sticky top-0 bg-white text-xs text-[#8B95A1]">
                          <tr>
                            <th className="px-3 py-2 text-left">번호</th>
                            <th className="px-3 py-2 text-left">정답</th>
                            <th className="px-3 py-2 text-left">배점</th>
                            <th className="px-3 py-2 text-left">영역</th>
                            <th className="px-3 py-2 text-left">유형</th>
                            <th className="px-3 py-2 text-left">난도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeQuestions.map((question) => (
                            <tr key={question.question_number} className="border-t border-slate-100">
                              <td className="px-3 py-2 font-bold">{question.question_number}</td>
                              <td className="px-3 py-2">
                                <Input className="h-8 w-20" value={question.correct_answer} onChange={(event) => updateQuestion(question.question_number, { correct_answer: event.target.value })} />
                              </td>
                              <td className="px-3 py-2">
                                <Input className="h-8 w-16" value={question.points} onChange={(event) => updateQuestion(question.question_number, { points: Number(event.target.value) || question.points })} />
                              </td>
                              <td className="px-3 py-2">
                                <Select value={question.section} onValueChange={(section: 'listening' | 'reading') => updateQuestion(question.question_number, { section })}>
                                  <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="listening">듣기</SelectItem>
                                    <SelectItem value="reading">독해</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <Select value={question.question_type} onValueChange={(question_type) => updateQuestion(question.question_number, { question_type })}>
                                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {MOCK_EXAM_TYPE_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <Select value={question.difficulty} onValueChange={(difficulty: 'low' | 'medium' | 'high') => updateQuestion(question.question_number, { difficulty })}>
                                  <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(difficultyLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button className="rounded-full bg-[#2463EB]" onClick={handleSaveQuestions} disabled={updateQuestions.isPending}>
                        저장 및 재채점
                      </Button>
                    </div>
                  </details>
                </CardContent>
              </Card>
            )}

            {selectedExam && mode === 'grading' && (
              <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
                <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Users className="h-5 w-5 text-[#2463EB]" />
                      고{grade} 학생
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-9" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="이름 검색" />
                    </div>
                    <div className="grid max-h-[560px] gap-2 overflow-auto pr-1">
                      {gradeStudents.map((student) => {
                        const result = resultByStudentId.get(student.id)
                        const report = latestReport(result)
                        return (
                          <button
                            key={student.id}
                            onClick={() => handleSelectStudent(student)}
                            className={cn(
                              'rounded-2xl p-4 text-left transition',
                              selectedStudentId === student.id ? 'bg-[#2463EB] text-white' : 'bg-slate-50 hover:bg-blue-50',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold">{student.name}</span>
                              {result ? <span className="text-sm font-extrabold">{result.raw_score}점</span> : <Badge variant="outline">미채점</Badge>}
                            </div>
                            <div className={cn('mt-1 text-xs', selectedStudentId === student.id ? 'text-blue-100' : 'text-slate-400')}>
                              {student.school ?? '학교 미입력'} {report ? '· 발행됨' : ''}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">{selectedStudent?.name ?? '학생 선택'}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <input ref={ocrInputRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={handleOcrFiles} />
                      <Button variant="outline" className="rounded-full" onClick={openAnswerSheet}>
                        <Printer className="mr-2 h-4 w-4" />
                        답안지
                      </Button>
                      <Button
                        className="rounded-full bg-[#2463EB]"
                        onClick={() => ocrInputRef.current?.click()}
                        disabled={!selectedStudentId || !effectiveExamId || ocrAnswers.isPending || incompleteAnswerKeyCount > 0}
                      >
                        {ocrAnswers.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                        OCR 채점
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!selectedStudent ? (
                      <div className="rounded-2xl bg-slate-50 p-10 text-center text-sm font-medium text-[#8B95A1]">
                        왼쪽에서 학생을 선택하세요.
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div className="rounded-2xl bg-blue-50 p-4">
                            <div className="text-xs font-bold text-[#8B95A1]">점수</div>
                            <div className="mt-1 text-3xl font-extrabold text-[#2463EB]">{selectedResult?.raw_score ?? '-'}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-[#8B95A1]">등급</div>
                            <div className="mt-1 text-3xl font-extrabold">{selectedResult?.grade ?? '-'}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-[#8B95A1]">듣기</div>
                            <div className="mt-2 text-xl font-extrabold">{selectedResult ? resultRate(selectedResult.listening_correct, selectedResult.listening_total) : '-'}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-[#8B95A1]">독해</div>
                            <div className="mt-2 text-xl font-extrabold">{selectedResult ? resultRate(selectedResult.reading_correct, selectedResult.reading_total) : '-'}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-5 gap-2 sm:grid-cols-9 xl:grid-cols-[repeat(15,minmax(0,1fr))]">
                          {activeQuestions.map((question) => (
                            <label key={question.question_number} className="space-y-1 rounded-xl bg-slate-50 p-2">
                              <span className="block text-center text-xs font-bold text-slate-500">{question.question_number}</span>
                              <Input
                                className="h-8 text-center"
                                value={activeAnswers[question.question_number] ?? ''}
                                onChange={(event) => updateAnswer(question.question_number, event.target.value)}
                              />
                            </label>
                          ))}
                        </div>

                        <div>
                          <Label className="text-xs text-[#8B95A1]">교사 기록</Label>
                          <Textarea
                            value={activeTeacherComment}
                            onChange={(event) => setTeacherComment(event.target.value)}
                            placeholder="응원 문구 없이 객관 사실만 입력하세요. 예: 빈칸 5문항 중 2문항 정답, 3점 문항 3개 오답."
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button className="rounded-full bg-[#2463EB]" onClick={handleSaveResult} disabled={saveResult.isPending || incompleteAnswerKeyCount > 0}>
                            검수 저장
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {selectedExam && mode === 'reports' && (
              <Card className="rounded-[24px] border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                <CardHeader>
                  <CardTitle className="text-lg">학생별 성적표</CardTitle>
                </CardHeader>
                <CardContent>
                  {detailLoading ? (
                    <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
                  ) : !detail?.results.length ? (
                    <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm font-medium text-[#8B95A1]">채점된 학생이 없습니다.</div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl bg-slate-50">
                      {detail.results.map((result) => {
                        const report = latestReport(result)
                        return (
                          <div key={result.id} className="grid gap-3 border-b border-white p-4 last:border-0 md:grid-cols-[1fr_auto] md:items-center">
                            <button className="text-left" onClick={() => {
                              setSelectedStudentId(result.student_id)
                              setMode('grading')
                            }}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base font-extrabold">{result.student?.name ?? '학생'}</span>
                                {report ? <Badge className="bg-blue-100 text-[#2463EB]">발행됨</Badge> : <Badge variant="outline">미발행</Badge>}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-3 text-sm text-[#8B95A1]">
                                <span>{result.raw_score ?? '-'}점</span>
                                <span>{result.grade ?? '-'}등급</span>
                                <span>듣기 {resultRate(result.listening_correct, result.listening_total)}</span>
                                <span>독해 {resultRate(result.reading_correct, result.reading_total)}</span>
                              </div>
                            </button>
                            <div className="flex flex-wrap justify-end gap-2">
                              {report && (
                                <>
                                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => window.open(reportUrl(report.share_token), '_blank', 'noopener,noreferrer')}>
                                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                    보기
                                  </Button>
                                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => void handleCopyReportUrl(report.share_token)}>
                                    <Copy className="mr-2 h-3.5 w-3.5" />
                                    복사
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                className={cn('rounded-full', !report && 'bg-[#2463EB]')}
                                variant={report ? 'outline' : 'default'}
                                disabled={publishReport.isPending}
                                onClick={() => handlePublish(result)}
                              >
                                <Send className="mr-2 h-3.5 w-3.5" />
                                {report ? '재발행' : '발행'}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
