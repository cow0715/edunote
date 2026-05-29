'use client'

import { useMemo, useRef, useState } from 'react'
import { Camera, ClipboardCheck, Copy, ExternalLink, FileText, Loader2, Plus, Save, Send, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useClasses } from '@/hooks/use-classes'
import { useStudents } from '@/hooks/use-students'
import {
  useCreateMockExam,
  useMockExam,
  useMockExams,
  useOcrMockExamAnswers,
  usePublishMockExamReport,
  useSaveMockExamResult,
  useUpdateMockExamQuestions,
} from '@/hooks/use-mock-exams'
import type { MockExamQuestion, MockExamResult } from '@/lib/types'
import { MOCK_EXAM_TYPE_OPTIONS } from '@/lib/mock-exam'
import { cn } from '@/lib/utils'

type CreateForm = {
  title: string
  class_id: string
  exam_year: string
  exam_month: string
  grade: string
  source: string
  exam_date: string
}

const difficultyLabels = {
  low: '하',
  medium: '중',
  high: '상',
} as const

const stageLabels = [
  '시험 등록',
  '정답/배점',
  '답안지 OCR',
  '검수/채점',
  '성적표 발행',
]

const blankForm = (): CreateForm => {
  const now = new Date()
  return {
    title: `${now.getFullYear()}년 ${now.getMonth() + 1}월 영어 모의고사`,
    class_id: 'none',
    exam_year: String(now.getFullYear()),
    exam_month: String(now.getMonth() + 1),
    grade: '3',
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

function latestReport(result: MockExamResult | null) {
  return result?.mock_exam_report?.find((report) => report.status === 'published') ?? null
}

export default function MockExamsPage() {
  const [form, setForm] = useState<CreateForm>(() => blankForm())
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState<string>('')
  const [questionDraft, setQuestionDraft] = useState<MockExamQuestion[] | null>(null)
  const [answers, setAnswers] = useState<Record<number, string> | null>(null)
  const [teacherComment, setTeacherComment] = useState<string | null>(null)
  const ocrInputRef = useRef<HTMLInputElement>(null)

  const { data: exams = [], isLoading: examsLoading } = useMockExams()
  const { data: classes = [] } = useClasses()
  const { data: students = [] } = useStudents()
  const effectiveExamId = selectedExamId ?? exams[0]?.id ?? null
  const { data: detail, isLoading: detailLoading } = useMockExam(effectiveExamId)
  const createExam = useCreateMockExam()
  const updateQuestions = useUpdateMockExamQuestions(effectiveExamId)
  const saveResult = useSaveMockExamResult(effectiveExamId)
  const ocrAnswers = useOcrMockExamAnswers(effectiveExamId)
  const publishReport = usePublishMockExamReport(effectiveExamId)

  const selectedExam = detail?.exam ?? exams.find((exam) => exam.id === effectiveExamId) ?? null
  const activeQuestions = questionDraft ?? detail?.questions ?? []
  const incompleteAnswerKeyCount = activeQuestions.filter((question) => !question.is_void && !question.all_correct && !question.correct_answer.trim()).length
  const selectedResult = detail?.results.find((result) => result.student_id === selectedStudentId) ?? null
  const publishedReport = latestReport(selectedResult)

  const filteredStudents = useMemo(() => {
    if (!selectedExam?.class_id) return students
    const effectiveDate = selectedExam.exam_date ?? new Date().toISOString().slice(0, 10)
    return students.filter((student) =>
      student.class_student?.some((enrollment) =>
        enrollment.class_id === selectedExam.class_id &&
        (!enrollment.joined_at || enrollment.joined_at <= effectiveDate) &&
        (!enrollment.left_at || enrollment.left_at > effectiveDate)
      )
    )
  }, [selectedExam, students])

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

  const pipeline = useMemo(() => {
    const hasExam = !!effectiveExamId
    const questionsReady = activeQuestions.length === 45 && incompleteAnswerKeyCount === 0
    const hasResult = !!selectedResult
    const hasReport = !!publishedReport
    return [
      hasExam,
      questionsReady,
      hasResult,
      hasResult,
      hasReport,
    ]
  }, [activeQuestions.length, effectiveExamId, incompleteAnswerKeyCount, publishedReport, selectedResult])

  async function handleCreate() {
    const exam = await createExam.mutateAsync({
      title: form.title,
      class_id: form.class_id === 'none' ? null : form.class_id,
      exam_year: Number(form.exam_year),
      exam_month: Number(form.exam_month),
      grade: form.grade === 'none' ? null : Number(form.grade),
      source: form.source,
      exam_date: form.exam_date || null,
    })
    handleSelectExam(exam.id)
  }

  function handleSelectExam(id: string) {
    setSelectedExamId(id)
    setSelectedStudentId('')
    setQuestionDraft(null)
    setAnswers(null)
    setTeacherComment(null)
  }

  function handleSelectStudent(id: string) {
    setSelectedStudentId(id)
    setAnswers(null)
    setTeacherComment(null)
  }

  function updateQuestion(questionNumber: number, patch: Partial<MockExamQuestion>) {
    setQuestionDraft((prev) =>
      (prev ?? detail?.questions ?? []).map((question) =>
        question.question_number === questionNumber ? { ...question, ...patch } : question
      )
    )
  }

  function updatePoints(questionNumber: number, value: string) {
    const points = Number(value)
    if (!Number.isInteger(points) || points < 1 || points > 100) return
    updateQuestion(questionNumber, { points })
  }

  function updateAnswer(questionNumber: number, value: string) {
    setAnswers((prev) => ({
      ...(prev ?? savedAnswers),
      [questionNumber]: value,
    }))
  }

  function handleSaveQuestions() {
    updateQuestions.mutate(activeQuestions)
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

  async function handleOcrFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || !selectedStudentId) return
    if (incompleteAnswerKeyCount > 0) {
      toast.error('OCR 전에 정답키를 먼저 완성해 주세요')
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

  function handlePublish(result: MockExamResult) {
    publishReport.mutate(result.id)
  }

  function reportUrl(token: string) {
    if (typeof window === 'undefined') return `/mock-exam-reports/${token}`
    return `${window.location.origin}/mock-exam-reports/${token}`
  }

  async function handleCopyReportUrl(token: string) {
    await navigator.clipboard.writeText(reportUrl(token))
    toast.success('성적표 링크를 복사했습니다.')
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-[#EBF3FF] to-white pb-10 text-[#1A1C1E]">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#2463EB]">
              <Trophy className="h-4 w-4" />
              상용 운영형 모의고사 파이프라인
            </div>
            <h1 className="mt-2 text-3xl font-extrabold">모의고사 성적표</h1>
            <p className="mt-2 text-sm text-[#8B95A1]">
              시험 등록부터 답안지 OCR, 검수, 채점, 성적표 스냅샷 발행까지 한 흐름으로 관리합니다.
            </p>
          </div>

          <Card className="w-full rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)] md:w-[560px]">
            <CardContent className="grid gap-3 p-4 md:grid-cols-6">
              <div className="md:col-span-3">
                <Label className="text-xs text-[#8B95A1]">시험명</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-[#8B95A1]">연도</Label>
                <Input value={form.exam_year} onChange={(e) => setForm({ ...form, exam_year: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-[#8B95A1]">월</Label>
                <Input value={form.exam_month} onChange={(e) => setForm({ ...form, exam_month: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-[#8B95A1]">학년</Label>
                <Select value={form.grade} onValueChange={(grade) => setForm({ ...form, grade })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">고1</SelectItem>
                    <SelectItem value="2">고2</SelectItem>
                    <SelectItem value="3">고3</SelectItem>
                    <SelectItem value="none">미지정</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-[#8B95A1]">시행 수업</Label>
                <Select value={form.class_id} onValueChange={(class_id) => setForm({ ...form, class_id })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">전체 학생</SelectItem>
                    {classes.map((cls) => <SelectItem key={cls.id} value={cls.id}>{cls.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-[#8B95A1]">출처</Label>
                <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs text-[#8B95A1]">응시일</Label>
                <Input type="date" value={form.exam_date} onChange={(e) => setForm({ ...form, exam_date: e.target.value })} />
              </div>
              <Button className="md:col-span-6 rounded-full bg-[#2463EB]" onClick={handleCreate} disabled={createExam.isPending}>
                <Plus className="mr-2 h-4 w-4" />
                새 모의고사 생성
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <CardContent className="grid gap-3 p-4 md:grid-cols-5">
            {stageLabels.map((label, index) => (
              <div key={label} className={cn('rounded-2xl px-4 py-3', pipeline[index] ? 'bg-blue-50 text-[#2463EB]' : 'bg-slate-50 text-slate-400')}>
                <div className="text-xs font-semibold">STEP {index + 1}</div>
                <div className="mt-1 text-sm font-bold">{label}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
            <CardHeader>
              <CardTitle className="text-lg">시험 목록</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {examsLoading ? (
                <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
              ) : exams.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-[#8B95A1]">등록된 모의고사가 없습니다.</div>
              ) : exams.map((exam) => (
                <button
                  key={exam.id}
                  onClick={() => handleSelectExam(exam.id)}
                  className={cn(
                    'w-full rounded-2xl p-4 text-left transition',
                    effectiveExamId === exam.id ? 'bg-[#2463EB] text-white' : 'bg-slate-50 text-slate-700 hover:bg-blue-50',
                  )}
                >
                  <div className="font-semibold">{exam.title}</div>
                  <div className={cn('mt-1 text-xs', effectiveExamId === exam.id ? 'text-blue-100' : 'text-slate-400')}>
                    {exam.exam_year}년 {exam.exam_month}월 · {exam.class?.name ?? '전체'} · 응시 {exam.result_count ?? 0}명
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-[#2463EB]" />
                  정답/배점/유형 메타데이터
                </CardTitle>
                <Button size="sm" className="rounded-full bg-[#2463EB]" onClick={handleSaveQuestions} disabled={!effectiveExamId || updateQuestions.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  저장 및 재채점
                </Button>
              </CardHeader>
              <CardContent>
                {detailLoading ? (
                  <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
                ) : !effectiveExamId ? (
                  <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-[#8B95A1]">시험을 먼저 생성하거나 선택해 주세요.</div>
                ) : (
                  <div className="max-h-[520px] overflow-auto rounded-2xl border border-slate-100">
                    <table className="w-full min-w-[820px] text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs text-[#8B95A1]">
                        <tr>
                          <th className="px-3 py-2 text-left">번호</th>
                          <th className="px-3 py-2 text-left">정답</th>
                          <th className="px-3 py-2 text-left">배점</th>
                          <th className="px-3 py-2 text-left">영역</th>
                          <th className="px-3 py-2 text-left">유형</th>
                          <th className="px-3 py-2 text-left">난도</th>
                          <th className="px-3 py-2 text-center">제외</th>
                          <th className="px-3 py-2 text-center">전원정답</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeQuestions.map((question) => (
                          <tr key={question.question_number} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-semibold">{question.question_number}</td>
                            <td className="px-3 py-2">
                              <Input className="h-8 w-20" value={question.correct_answer} onChange={(e) => updateQuestion(question.question_number, { correct_answer: e.target.value })} />
                            </td>
                            <td className="px-3 py-2">
                              <Input className="h-8 w-16" value={question.points} onChange={(e) => updatePoints(question.question_number, e.target.value)} />
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
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={question.is_void} onChange={(e) => updateQuestion(question.question_number, { is_void: e.target.checked })} />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={question.all_correct} onChange={(e) => updateQuestion(question.question_number, { all_correct: e.target.checked })} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
              <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ClipboardCheck className="h-5 w-5 text-[#2463EB]" />
                    답안지 OCR / 검수 / 채점
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <input ref={ocrInputRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={handleOcrFiles} />
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => ocrInputRef.current?.click()} disabled={!selectedStudentId || !effectiveExamId || ocrAnswers.isPending || incompleteAnswerKeyCount > 0}>
                      {ocrAnswers.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                      답안지 OCR
                    </Button>
                    <Button size="sm" className="rounded-full bg-[#2463EB]" onClick={handleSaveResult} disabled={!effectiveExamId || !selectedStudentId || saveResult.isPending || incompleteAnswerKeyCount > 0}>
                      채점 저장
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="max-w-sm">
                    <Label className="text-xs text-[#8B95A1]">학생</Label>
                    <Select value={selectedStudentId || 'none'} onValueChange={(value) => handleSelectStudent(value === 'none' ? '' : value)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">학생 선택</SelectItem>
                        {filteredStudents.map((student) => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {incompleteAnswerKeyCount > 0 && (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      정답이 비어 있는 문항이 {incompleteAnswerKeyCount}개 있습니다. 제외 또는 전원정답이 아닌 문항은 정답을 먼저 입력해 주세요.
                    </div>
                  )}

                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-9 lg:grid-cols-[repeat(15,minmax(0,1fr))]">
                    {activeQuestions.map((question) => (
                      <label key={question.question_number} className="space-y-1 rounded-xl bg-slate-50 p-2">
                        <span className="block text-center text-xs font-semibold text-slate-500">{question.question_number}</span>
                        <Input
                          className="h-8 text-center"
                          value={activeAnswers[question.question_number] ?? ''}
                          onChange={(e) => updateAnswer(question.question_number, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>

                  <div>
                    <Label className="text-xs text-[#8B95A1]">성적표 코멘트</Label>
                    <Textarea value={activeTeacherComment} onChange={(e) => setTeacherComment(e.target.value)} placeholder="성적표에 표시할 코멘트를 입력하세요." />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
                <CardHeader>
                  <CardTitle className="text-lg">결과 / 발행 센터</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail?.results.length ? detail.results.map((result) => {
                    const report = result.mock_exam_report?.find((item) => item.status === 'published')
                    return (
                      <div
                        key={result.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectStudent(result.student_id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') handleSelectStudent(result.student_id)
                        }}
                        className="w-full rounded-2xl bg-slate-50 p-4 text-left hover:bg-blue-50"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{result.student?.name ?? '학생'}</span>
                          <span className="text-xl font-extrabold text-[#2463EB]">{result.raw_score ?? '-'}점</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>{result.grade ?? '-'}등급</span>
                          <span>듣기 {resultRate(result.listening_correct, result.listening_total)}</span>
                          <span>독해 {resultRate(result.reading_correct, result.reading_total)}</span>
                          {report ? <Badge className="bg-blue-100 text-[#2463EB]">발행됨</Badge> : <Badge variant="outline">미발행</Badge>}
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          {report && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  window.open(reportUrl(report.share_token), '_blank', 'noopener,noreferrer')
                                }}
                              >
                                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                성적표 열기
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleCopyReportUrl(report.share_token)
                                }}
                              >
                                <Copy className="mr-2 h-3.5 w-3.5" />
                                링크 복사
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant={report ? 'outline' : 'default'}
                            className={cn('rounded-full', !report && 'bg-[#2463EB]')}
                            disabled={publishReport.isPending}
                            onClick={(event) => {
                              event.stopPropagation()
                              handlePublish(result)
                            }}
                          >
                            <Send className="mr-2 h-3.5 w-3.5" />
                            {report ? '스냅샷 재발행' : '성적표 발행'}
                          </Button>
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-[#8B95A1]">아직 채점 결과가 없습니다.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
