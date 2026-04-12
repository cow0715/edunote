'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Upload, Trash2, Search, Copy, ChevronDown, ChevronUp, FileText, File, Plus, Pencil, BarChart2, Loader2, BookOpen, ChevronRight, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/client'

// ── 타입 ──────────────────────────────────────────────────────────────────

type ExamBank = {
  id: string
  title: string
  exam_year: number
  exam_month: number
  grade: number
  source: string
  form_type: string
  created_at: string
  exam_bank_question: { count: number }[]
}

type ExamBankQuestion = {
  id: string
  exam_bank_id: string
  question_number: number
  question_type: string
  passage: string
  question_text: string
  choices: string[]
  answer: string
  raw_text: string
  difficulty: string | null
  points: number | null
  correct_rate: number | null
  choice_rates: number[] | null
  explanation_intent: string | null
  explanation_translation: string | null
  explanation_solution: string | null
  explanation_vocabulary: string | null
  exam_bank?: {
    title: string
    exam_year: number
    exam_month: number
    grade: number
    source: string
  }
}

// ── 마크다운 인라인 렌더러 ────────────────────────────────────────────────
// **bold**, *italic*, <u>underline</u>을 React 요소로 변환

const MD_TOKEN_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|<u>[^<]+<\/u>)/g

// 마크다운 → HTML (한글/워드 붙여넣기용)
function mdToHtml(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

// 마크다운 기호 제거 (plain text용)
function mdToPlain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<u>([^<]+)<\/u>/g, '$1')
}

async function copyRich(plainText: string, htmlText: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(plainText)
  }
}

function renderLine(line: string, lineKey: number) {
  const parts = line.split(MD_TOKEN_RE)
  return (
    <span key={lineKey}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>
        }
        if (part.startsWith('<u>') && part.endsWith('</u>')) {
          return <u key={i}>{part.slice(3, -4)}</u>
        }
        return part
      })}
    </span>
  )
}

function MarkdownText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <span key={i}>
          {renderLine(line, i)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </span>
  )
}

function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  minRows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false }),
      Underline,
      Markdown.configure({ html: true, transformPastedText: true }),
    ],
    content: value,
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange((editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown())
    },
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[60px] text-sm text-gray-800 leading-relaxed',
      },
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>{label}</Label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
            className={`rounded px-1.5 py-0.5 text-xs font-bold border ${editor?.isActive('bold') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >B</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
            className={`rounded px-1.5 py-0.5 text-xs italic border ${editor?.isActive('italic') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >I</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run() }}
            className={`rounded px-1.5 py-0.5 text-xs underline border ${editor?.isActive('underline') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >U</button>
        </div>
      </div>
      <div
        className="rounded-md border bg-white px-3 py-2 text-sm focus-within:ring-1 focus-within:ring-ring"
        style={{ minHeight: `${minRows * 1.75 + 1}rem` }}
      >
        {editor && !editor.getText() && !editor.isFocused && (
          <p className="pointer-events-none absolute text-gray-400 text-sm">{placeholder}</p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  purpose: '글의 목적',
  mood: '심경/분위기',
  claim: '주장',
  implication: '함축 의미',
  topic: '주제',
  title: '제목',
  summary: '요약문',
  blank_vocabulary: '빈칸(어휘)',
  blank_grammar: '빈칸(문법)',
  blank_connective: '빈칸(연결어)',
  blank_phrase: '빈칸(구/절)',
  grammar: '어법',
  vocabulary: '어휘',
  reference: '지칭',
  content_match: '내용 일치',
  notice: '안내문/실용문',
  order: '순서',
  insert: '삽입',
  irrelevant: '무관한 문장',
  long_blank: '장문 빈칸',
  long_order: '장문 순서',
  long_insert: '장문 삽입',
  long_content_match: '장문 내용 일치',
  long_title: '장문 제목/주제',
  other: '기타',
}

// 수능/모의고사 구분 (source 값 → 그룹)
const EXAM_KIND_OPTIONS = [
  { label: '수능', value: '수능' },
  { label: '모의고사', value: '모의고사' },
]

const MONTHS = [3, 4, 6, 7, 9, 10, 11]
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 10 }, (_, i) => CURRENT_YEAR - i)

// ── 메인 페이지 ──────────────────────────────────────────────────────────

export default function ExamBankPage() {
  const [uploadOpen, setUploadOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">기출문제 은행</h1>
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          PDF 업로드
        </Button>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">시험 목록</TabsTrigger>
          <TabsTrigger value="search">문제 검색</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <ExamList />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <QuestionSearch />
        </TabsContent>
      </Tabs>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  )
}

// ── 메가스터디 통계 버튼 ──────────────────────────────────────────────────

function FetchStatsButton({ examId, formType }: { examId: string; formType: string }) {
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  const handleFetch = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/exam-bank/${examId}/fetch-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_type: formType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`통계 저장 완료 (${data.updated}/${data.total}문항)`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '통계 가져오기 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleFetch}
      disabled={loading}
      title="메가스터디 통계 가져오기"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart2 className="h-4 w-4" />}
    </Button>
  )
}

// ── 시험 목록 ─────────────────────────────────────────────────────────────

function ExamList() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [explanationTarget, setExplanationTarget] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const { data: exams, isLoading } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/exam-bank/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success('삭제되었습니다')
    },
  })

  if (isLoading) return <p className="text-sm text-gray-500">불러오는 중...</p>
  if (!exams?.length) return <p className="text-sm text-gray-500">등록된 기출 시험이 없습니다.</p>

  return (
    <div className="space-y-3">
      {exams.map((exam) => {
        const isExpanded = expandedId === exam.id
        const qCount = exam.exam_bank_question?.[0]?.count ?? 0
        return (
          <div key={exam.id} className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* 아이콘 */}
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 shrink-0">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              {/* 정보 */}
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : exam.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{exam.title}</span>
                  <span className="text-xs text-gray-400 shrink-0">{exam.form_type}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-400">{exam.exam_year}년 {exam.exam_month}월 · 고{exam.grade}</span>
                  <span className="text-xs font-medium text-blue-600">{qCount}문항</span>
                </div>
              </div>
              {/* 액션 버튼 */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : exam.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <FetchStatsButton examId={exam.id} formType={exam.form_type || '홀수형'} />
                <button
                  onClick={() => setExplanationTarget(exam.id)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                  title="해설 PDF 업로드"
                >
                  <BookOpen className="h-4 w-4" />
                </button>
                <button
                  disabled={generatingId === exam.id}
                  onClick={async () => {
                    setGeneratingId(exam.id)
                    try {
                      const res = await fetch(`/api/exam-bank/${exam.id}/generate-explanation`, { method: 'POST' })
                      const json = await res.json()
                      if (!res.ok) toast.error(json.error ?? 'AI 해설 생성 실패')
                      else toast.success(`AI 해설 생성 완료 (${json.updated}/${json.total}문항)`)
                    } catch {
                      toast.error('AI 해설 생성 실패')
                    } finally {
                      setGeneratingId(null)
                    }
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="AI 해석/어휘 생성 (20~24, 29~42번)"
                >
                  {generatingId === exam.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />
                  }
                </button>
                <button
                  onClick={() => { if (confirm('이 시험과 모든 문항을 삭제하시겠습니까?')) deleteMutation.mutate(exam.id) }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="border-t border-gray-100">
                <QuestionList examId={exam.id} />
              </div>
            )}
          </div>
        )
      })}
      <ExplanationUploadDialog
        examId={explanationTarget}
        onOpenChange={(open) => { if (!open) setExplanationTarget(null) }}
      />
    </div>
  )
}

// ── 문항 목록 (펼침) ──────────────────────────────────────────────────────

function QuestionList({ examId }: { examId: string }) {
  const queryClient = useQueryClient()
  const [editTarget, setEditTarget] = useState<ExamBankQuestion | null | 'new'>(null)

  const { data: questions, isLoading } = useQuery<ExamBankQuestion[]>({
    queryKey: ['exam-bank-questions', examId],
    queryFn: () => fetch(`/api/exam-bank/${examId}/questions`).then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (qid: string) =>
      fetch(`/api/exam-bank/${examId}/questions/${qid}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success('문항이 삭제되었습니다')
    },
  })

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-400">{questions?.length ?? 0}문항</p>
        <Button size="sm" variant="outline" onClick={() => setEditTarget('new')}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          문항 추가
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">문항 로딩 중...</p>}
      {!isLoading && !questions?.length && <p className="text-sm text-gray-400">문항 없음</p>}

      <div className="space-y-3">
        {questions?.map((q) => (
          <QuestionCard
            key={q.id}
            question={q}
            onEdit={() => setEditTarget(q)}
            onDelete={() => {
              if (confirm(`${q.question_number}번 문항을 삭제하시겠습니까?`)) {
                deleteMutation.mutate(q.id)
              }
            }}
          />
        ))}
      </div>

      <QuestionEditDialog
        examId={examId}
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  )
}

// ── 난이도 색상 ────────────────────────────────────────────────────────────

const DIFFICULTY_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  '하':   { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-400' },
  '중하': { bg: 'bg-lime-50',   text: 'text-lime-700',   dot: 'bg-lime-400' },
  '중':   { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  '중상': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  '최상': { bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-400' },
}

// ── 문항 카드 ─────────────────────────────────────────────────────────────

function QuestionCard({
  question: q,
  showExamInfo,
  onEdit,
  onDelete,
}: {
  question: ExamBankQuestion
  showExamInfo?: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [showExplanation, setShowExplanation] = useState(false)
  const hasExplanation = !!(q.explanation_intent || q.explanation_translation || q.explanation_solution || q.explanation_vocabulary)

  // 시험 출처 레이블 (복사 헤더용)
  const examLabel = q.exam_bank
    ? `${q.exam_bank.exam_year}년도 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
    : `${q.question_number}번`

  const buildQuestionText = useCallback(() => {
    const header = q.exam_bank ? `[${examLabel}]\n` : ''
    const circled = ['①','②','③','④','⑤']
    const ratesSummary = q.choice_rates?.some((r) => r != null)
      ? `\n선택률: ${q.choices.map((_, i) => {
          const r = q.choice_rates?.[i]
          return r != null ? `${circled[i]} ${r}%` : null
        }).filter(Boolean).join('   ')}`
      : ''
    return header + [
      mdToPlain(q.question_text),
      q.passage ? `\n${mdToPlain(q.passage)}` : '',
      q.choices.length > 0 ? `\n${q.choices.map(mdToPlain).join('\n')}` : '',
      q.answer ? `\n정답: ${q.answer}` : '',
      ratesSummary,
    ].join('')
  }, [q, examLabel])

  const buildQuestionHtml = useCallback(() => {
    const header = q.exam_bank ? `<p><strong>[${examLabel}]</strong></p>` : ''
    return header
      + `<p>${mdToHtml(q.question_text)}</p>`
      + (q.passage ? `<p>${mdToHtml(q.passage)}</p>` : '')
      + (q.choices.length > 0 ? `<p>${q.choices.map(mdToHtml).join('<br>')}</p>` : '')
      + (q.answer ? `<p>정답: ${q.answer}</p>` : '')
  }, [q, examLabel])

  const buildExplanationText = useCallback(() => {
    const header = q.exam_bank ? `[${examLabel} 해설]\n` : `[${q.question_number}번 해설]\n`
    const parts = [
      q.explanation_intent ? `[출제의도] ${q.explanation_intent}` : '',
      q.explanation_translation ? `[해석]\n${q.explanation_translation}` : '',
      q.explanation_solution ? `[풀이]\n${q.explanation_solution}` : '',
      q.explanation_vocabulary ? `[Words and Phrases]\n${q.explanation_vocabulary}` : '',
    ].filter(Boolean)
    return header + parts.join('\n\n')
  }, [q, examLabel])

  const buildExplanationHtml = useCallback(() => {
    const header = q.exam_bank ? `<p><strong>[${examLabel} 해설]</strong></p>` : `<p><strong>[${q.question_number}번 해설]</strong></p>`
    return header
      + (q.explanation_intent ? `<p><strong>[출제의도]</strong> ${q.explanation_intent}</p>` : '')
      + (q.explanation_translation ? `<p><strong>[해석]</strong><br>${q.explanation_translation.replace(/\n/g, '<br>')}</p>` : '')
      + (q.explanation_solution ? `<p><strong>[풀이]</strong><br>${q.explanation_solution}</p>` : '')
      + (q.explanation_vocabulary ? `<p><strong>[Words and Phrases]</strong><br>${q.explanation_vocabulary}</p>` : '')
  }, [q, examLabel])

  const copyQuestion = useCallback(async () => {
    await copyRich(buildQuestionText(), buildQuestionHtml())
    toast.success('문제 복사 완료')
  }, [buildQuestionText, buildQuestionHtml])

  const copyExplanation = useCallback(async () => {
    await copyRich(buildExplanationText(), buildExplanationHtml())
    toast.success('해설 복사 완료')
  }, [buildExplanationText, buildExplanationHtml])

  const copyBoth = useCallback(async () => {
    const plain = buildQuestionText() + '\n\n' + buildExplanationText()
    const html = buildQuestionHtml() + buildExplanationHtml()
    await copyRich(plain, html)
    toast.success('문제+해설 복사 완료')
  }, [buildQuestionText, buildQuestionHtml, buildExplanationText, buildExplanationHtml])

  const diffStyle = q.difficulty ? (DIFFICULTY_STYLE[q.difficulty] ?? DIFFICULTY_STYLE['중상']) : null

  // 정답 번호 (①→1, ②→2, ...)
  const answerIdx = q.answer ? ['①','②','③','④','⑤'].indexOf(q.answer) : -1

  // 선택률 인라인 표시 여부
  const hasChoiceRates = q.choice_rates && q.choice_rates.some((r) => r != null)

  return (
    <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 문항번호 */}
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
            {q.question_number}
          </span>
          {/* 유형 */}
          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">
            {QUESTION_TYPE_LABELS[q.question_type] || q.question_type}
          </span>
          {/* 난이도 칩 */}
          {diffStyle && (
            <span className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-0.5 ${diffStyle.bg} ${diffStyle.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${diffStyle.dot}`} />
              {q.difficulty}
            </span>
          )}
          {/* 배점 */}
          {q.points && (
            <span className="text-xs text-gray-400 font-medium">{q.points}점</span>
          )}
          {/* 정답률 */}
          {q.correct_rate != null && (
            <span className="text-xs text-blue-500 font-semibold">{q.correct_rate}%</span>
          )}
          {/* 출처 */}
          {showExamInfo && q.exam_bank && (
            <span className="text-xs text-gray-400">
              {q.exam_bank.exam_year}년 {q.exam_bank.exam_month}월 고{q.exam_bank.grade} {q.exam_bank.source}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 복사 드롭다운 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                <Copy className="h-3.5 w-3.5" />
                <ChevronRight className="h-2.5 w-2.5 rotate-90" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-sm">
              <DropdownMenuItem onClick={copyQuestion}>문제만</DropdownMenuItem>
              <DropdownMenuItem onClick={copyExplanation} disabled={!hasExplanation}>
                해설만
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyBoth} disabled={!hasExplanation}>
                문제 + 해설
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onEdit && (
            <button onClick={onEdit} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* 발문 */}
        <p className="text-sm font-medium text-gray-800 leading-relaxed">
          <MarkdownText text={q.question_text} />
        </p>

        {/* 지문 */}
        {q.passage && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap text-justify">
              <MarkdownText text={q.passage} />
            </p>
          </div>
        )}

        {/* 선지 */}
        {q.choices.length > 0 && (
          <div className="space-y-1">
            {q.choices.map((c, i) => {
              const isAnswer = i === answerIdx
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    isAnswer ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600'
                  }`}
                >
                  <span className="shrink-0 break-words">{c}</span>
                  {/* 선지별 선택률 바 */}
                  {hasChoiceRates && q.choice_rates?.[i] != null && (
                    <div className="ml-auto flex items-center gap-1.5 shrink-0">
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isAnswer ? 'bg-blue-400' : 'bg-gray-300'}`}
                          style={{ width: `${q.choice_rates[i]}%` }}
                        />
                      </div>
                      <span className={`text-[11px] w-7 text-right ${isAnswer ? 'text-blue-500 font-semibold' : 'text-gray-400'}`}>
                        {q.choice_rates[i]}%
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 해설 토글 */}
        {hasExplanation && (
          <>
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showExplanation ? '해설 접기' : '해설 보기'}
            </button>
            {showExplanation && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-2.5">
                {q.explanation_intent && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">출제의도</span>
                    <p className="text-sm text-gray-700 mt-0.5">{q.explanation_intent}</p>
                  </div>
                )}
                {q.explanation_translation && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">해석</span>
                    <p className="text-sm text-gray-600 mt-0.5 leading-relaxed whitespace-pre-wrap">{q.explanation_translation}</p>
                  </div>
                )}
                {q.explanation_solution && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">풀이</span>
                    <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{q.explanation_solution}</p>
                  </div>
                )}
                {q.explanation_vocabulary && (
                  <div>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Words &amp; Phrases</span>
                    <p className="text-sm text-gray-600 mt-0.5 leading-relaxed">{q.explanation_vocabulary}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── 문제 검색 ────────────────────────────────────────────────────────────

const DIFFICULTY_OPTIONS = ['하', '중하', '중', '중상', '최상'] as const
const EMPTY_FILTERS = {
  type: '',
  grade: '',
  year_from: '',
  year_to: '',
  kind: '',
  month: '',
  points: '',
  difficulties: [] as string[],
  max_correct_rate: '',
}

function QuestionSearch() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [results, setResults] = useState<ExamBankQuestion[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (key: keyof typeof EMPTY_FILTERS) => (v: string) =>
    setFilters((f) => ({ ...f, [key]: v === 'all' ? '' : v }))

  const toggleDifficulty = (d: string) =>
    setFilters((f) => ({
      ...f,
      difficulties: f.difficulties.includes(d)
        ? f.difficulties.filter((x) => x !== d)
        : [...f.difficulties, d],
    }))

  const doSearch = async (f: typeof EMPTY_FILTERS) => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (f.type) params.set('type', f.type)
      if (f.grade) params.set('grade', f.grade)
      if (f.year_from) params.set('year_from', f.year_from)
      if (f.year_to) params.set('year_to', f.year_to)
      if (f.month) params.set('month', f.month)
      if (f.kind === '수능') params.set('source', '수능')
      else if (f.kind === '모의고사') params.set('source', '모의고사')
      if (f.points) params.set('points', f.points)
      if (f.difficulties.length) params.set('difficulty', f.difficulties.join(','))
      if (f.max_correct_rate) params.set('max_correct_rate', f.max_correct_rate)

      const res = await fetch(`/api/exam-bank/questions?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '검색 실패')
    } finally {
      setSearching(false)
    }
  }

  // 필터 변경 시 debounce 자동 검색
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(filters), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const handleReset = () => setFilters(EMPTY_FILTERS)

  const getExamLabel = (q: ExamBankQuestion) =>
    q.exam_bank
      ? `${q.exam_bank.exam_year}년도 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
      : `${q.question_number}번`

  const circled = ['①','②','③','④','⑤']

  const buildAllQText = (list: ExamBankQuestion[]) =>
    list.map((q) => {
      const ratesSummary = q.choice_rates?.some((r) => r != null)
        ? `\n선택률: ${q.choices.map((_, i) => {
            const r = q.choice_rates?.[i]
            return r != null ? `${circled[i]} ${r}%` : null
          }).filter(Boolean).join('   ')}`
        : ''
      return [
        `[${getExamLabel(q)}]`,
        `\n${mdToPlain(q.question_text)}`,
        q.passage ? `\n${mdToPlain(q.passage)}` : '',
        q.choices.length > 0 ? `\n${q.choices.map(mdToPlain).join('\n')}` : '',
        q.answer ? `\n정답: ${q.answer}` : '',
        ratesSummary,
      ].join('')
    }).join('\n\n---\n\n')

  const buildAllQHtml = (list: ExamBankQuestion[]) =>
    list.map((q) =>
      `<p><strong>[${getExamLabel(q)}]</strong></p>`
      + `<p>${mdToHtml(q.question_text)}</p>`
      + (q.passage ? `<p>${mdToHtml(q.passage)}</p>` : '')
      + (q.choices.length > 0 ? `<p>${q.choices.map(mdToHtml).join('<br>')}</p>` : '')
      + (q.answer ? `<p>정답: ${q.answer}</p>` : '')
    ).join('<hr>')

  const buildAllExText = (list: ExamBankQuestion[]) =>
    list.map((q) => {
      const label = getExamLabel(q)
      const parts = [
        q.explanation_intent ? `[출제의도] ${q.explanation_intent}` : '',
        q.explanation_translation ? `[해석]\n${q.explanation_translation}` : '',
        q.explanation_solution ? `[풀이]\n${q.explanation_solution}` : '',
        q.explanation_vocabulary ? `[Words and Phrases]\n${q.explanation_vocabulary}` : '',
      ].filter(Boolean)
      return `[${label} 해설]\n` + parts.join('\n\n')
    }).join('\n\n---\n\n')

  const buildAllExHtml = (list: ExamBankQuestion[]) =>
    list.map((q) => {
      const label = getExamLabel(q)
      return `<p><strong>[${label} 해설]</strong></p>`
        + (q.explanation_intent ? `<p><strong>[출제의도]</strong> ${q.explanation_intent}</p>` : '')
        + (q.explanation_translation ? `<p><strong>[해석]</strong><br>${q.explanation_translation.replace(/\n/g, '<br>')}</p>` : '')
        + (q.explanation_solution ? `<p><strong>[풀이]</strong><br>${q.explanation_solution}</p>` : '')
        + (q.explanation_vocabulary ? `<p><strong>[Words and Phrases]</strong><br>${q.explanation_vocabulary}</p>` : '')
    }).join('<hr>')

  const copyAllQuestions = async () => {
    if (!results?.length) return
    await copyRich(buildAllQText(results), buildAllQHtml(results))
    toast.success(`문제 ${results.length}개 복사됨`)
  }

  const copyAllExplanations = async () => {
    if (!results?.length) return
    await copyRich(buildAllExText(results), buildAllExHtml(results))
    toast.success(`해설 ${results.length}개 복사됨`)
  }

  const copyAllBoth = async () => {
    if (!results?.length) return
    const plain = buildAllQText(results) + '\n\n' + buildAllExText(results)
    const html = buildAllQHtml(results) + buildAllExHtml(results)
    await copyRich(plain, html)
    toast.success(`문제+해설 ${results.length}개 복사됨`)
  }

  const hasFilter = filters.type || filters.grade || filters.year_from || filters.year_to
    || filters.kind || filters.month || filters.points || filters.difficulties.length || filters.max_correct_rate

  return (
    <div className="space-y-4">
      {/* ── 상단 필터 패널 ── */}
      <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 p-4 sticky top-4 z-10">
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-end">

          {/* 유형 */}
          <div className="min-w-[120px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">유형</p>
            <Select value={filters.type || 'all'} onValueChange={set('type')}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 유형</SelectItem>
                {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 학년 */}
          <div className="min-w-[72px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">학년</p>
            <Select value={filters.grade || 'all'} onValueChange={set('grade')}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[['all','전체'],['1','고1'],['2','고2'],['3','고3']].map(([v,l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 구분 */}
          <div className="min-w-[88px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">구분</p>
            <Select value={filters.kind || 'all'} onValueChange={set('kind')}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[['all','전체'],['수능','수능'],['모의고사','모의고사']].map(([v,l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 월 */}
          <div className="min-w-[72px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">월</p>
            <Select value={filters.month || 'all'} onValueChange={set('month')}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 년도 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">년도</p>
            <div className="flex items-center gap-1">
              <Select value={filters.year_from || 'all'} onValueChange={set('year_from')}>
                <SelectTrigger className="h-8 text-xs w-[72px]"><SelectValue placeholder="시작" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-gray-300">~</span>
              <Select value={filters.year_to || 'all'} onValueChange={set('year_to')}>
                <SelectTrigger className="h-8 text-xs w-[72px]"><SelectValue placeholder="종료" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 구분선 */}
          <div className="w-px h-8 bg-gray-200 hidden sm:block" />

          {/* 배점 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">배점</p>
            <div className="flex gap-1">
              {[['', '전체'], ['2', '2점'], ['3', '3점']].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFilters((f) => ({ ...f, points: f.points === v ? '' : v }))}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                    filters.points === v
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 난이도 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">난이도</p>
            <div className="flex gap-1">
              {DIFFICULTY_OPTIONS.map((d) => {
                const s = DIFFICULTY_STYLE[d]
                const active = filters.difficulties.includes(d)
                return (
                  <button
                    key={d}
                    onClick={() => toggleDifficulty(d)}
                    className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                      active ? `${s.bg} ${s.text} ring-1 ring-current` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 정답률 */}
          <div className="min-w-[96px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">정답률 이하</p>
            <Select value={filters.max_correct_rate || 'all'} onValueChange={set('max_correct_rate')}>
              <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="30">~30%</SelectItem>
                <SelectItem value="40">~40%</SelectItem>
                <SelectItem value="50">~50%</SelectItem>
                <SelectItem value="60">~60%</SelectItem>
                <SelectItem value="70">~70%</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 리셋 */}
          {hasFilter && (
            <button
              onClick={handleReset}
              className="h-8 px-3 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors self-end"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* ── 결과 ── */}
      {searching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
      )}

      {!searching && results !== null && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {results.length > 0 ? `${results.length}개 문항` : '검색 결과가 없습니다'}
            </p>
            {results.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    전체 복사 ({results.length})
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyAllQuestions}>문제만</DropdownMenuItem>
                  <DropdownMenuItem onClick={copyAllExplanations}>해설만</DropdownMenuItem>
                  <DropdownMenuItem onClick={copyAllBoth}>문제+해설</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {results.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {results.map((q) => <QuestionCard key={q.id} question={q} showExamInfo />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 문항 추가/수정 다이얼로그 ─────────────────────────────────────────────

const EMPTY_FORM = {
  question_number: '',
  question_type: '',
  question_text: '',
  passage: '',
  choices: ['', '', '', '', ''],
  answer: '',
}

function QuestionEditDialog({
  examId,
  target,
  onClose,
}: {
  examId: string
  target: ExamBankQuestion | null | 'new'
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isNew = target === 'new'
  const open = target !== null

  const [form, setForm] = useState(EMPTY_FORM)

  const prevTarget = useRef<typeof target>(null)
  if (target !== prevTarget.current) {
    prevTarget.current = target
    if (target && target !== 'new') {
      const q = target
      setForm({
        question_number: String(q.question_number),
        question_type: q.question_type,
        question_text: q.question_text,
        passage: q.passage || '',
        choices: q.choices.length === 5 ? q.choices : [...q.choices, ...Array(5 - q.choices.length).fill('')],
        answer: q.answer || '',
      })
    } else if (target === 'new') {
      setForm(EMPTY_FORM)
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        question_number: Number(form.question_number),
        question_type: form.question_type,
        question_text: form.question_text.trim(),
        passage: form.passage.trim(),
        choices: form.choices.map((c) => c.trim()).filter(Boolean),
        answer: form.answer.trim(),
      }
      const url = isNew
        ? `/api/exam-bank/${examId}/questions`
        : `/api/exam-bank/${examId}/questions/${(target as ExamBankQuestion).id}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '저장 실패')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      toast.success(isNew ? '문항이 추가되었습니다' : '문항이 수정되었습니다')
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '저장 실패'),
  })

  const setChoice = (i: number, val: string) => {
    const next = [...form.choices]
    next[i] = val
    setForm({ ...form, choices: next })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? '문항 추가' : `${(target as ExamBankQuestion)?.question_number}번 문항 수정`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>문항 번호</Label>
              <Input
                type="number"
                min={18}
                max={45}
                value={form.question_number}
                onChange={(e) => setForm({ ...form, question_number: e.target.value })}
                placeholder="예: 38"
              />
            </div>
            <div>
              <Label>문항 유형</Label>
              <Select value={form.question_type} onValueChange={(v) => setForm({ ...form, question_type: v })}>
                <SelectTrigger><SelectValue placeholder="유형 선택" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <MarkdownField
            label="발문 (+ 주어진 문장)"
            minRows={3}
            value={form.question_text}
            onChange={(v) => setForm({ ...form, question_text: v })}
            placeholder="다음 글의 목적으로 가장 적절한 것은?"
          />

          <MarkdownField
            label="지문"
            minRows={8}
            value={form.passage}
            onChange={(v) => setForm({ ...form, passage: v })}
            placeholder="지문 내용 (없으면 비워두세요)"
          />

          <div>
            <Label>보기 (5개)</Label>
            <div className="space-y-2">
              {['①', '②', '③', '④', '⑤'].map((sym, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-sm text-gray-500 shrink-0">{sym}</span>
                  <Input
                    value={form.choices[i] ?? ''}
                    onChange={(e) => setChoice(i, e.target.value)}
                    placeholder={`${sym} 보기 내용`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>정답</Label>
            <Input
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              placeholder="예: 3 또는 2,4"
              className="max-w-32"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>취소</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.question_number || !form.question_type || !form.question_text}
            >
              {saveMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── 업로드 다이얼로그 ─────────────────────────────────────────────────────

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [form, setForm] = useState({
    exam_year: new Date().getFullYear(),
    exam_month: 3,
    grade: 2,
    source: '교육청',
    form_type: '홀수형',
  })

  const autoTitle = form.source === '수능'
    ? `${form.exam_year}년도 수능`
    : `${form.exam_year}년도 ${form.exam_month}월 고${form.grade} 모의고사`

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return toast.error('PDF 파일을 선택해주세요')

    setUploading(true)
    setUploadStep(1)
    setElapsed(0)

    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    const step2 = setTimeout(() => setUploadStep(2), 4000)
    const step3 = setTimeout(() => setUploadStep(3), 30000)
    const step4 = setTimeout(() => setUploadStep(4), 120000)

    try {
      // PDF를 Supabase Storage에 직접 업로드 (Vercel 4.5MB body 한도 우회)
      const supabase = createClient()
      const storagePath = `${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('exam-pdf-temp')
        .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
      if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)

      const res = await fetch('/api/exam-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          title: autoTitle,
          storagePath,
          mimeType: file.type || 'application/pdf',
        }),
      })


      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '업로드 실패')

      const statsMsg = data.stats_fetched > 0 ? ` · 메가스터디 통계 ${data.stats_fetched}문항` : ''
      toast.success(`${data.question_count}개 문항 추출 완료${statsMsg}`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      onOpenChange(false)
      setForm({ exam_year: new Date().getFullYear(), exam_month: 3, grade: 2, source: '교육청', form_type: '홀수형' })
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF 파싱 실패')
    } finally {
      clearInterval(timer)
      clearTimeout(step2)
      clearTimeout(step3)
      clearTimeout(step4)
      setUploading(false)
      setUploadStep(0)
      setElapsed(0)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>기출문제 PDF 업로드</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* 년도 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">년도</Label>
            <Input
              type="number"
              value={form.exam_year}
              onChange={(e) => setForm({ ...form, exam_year: Number(e.target.value) })}
              className="flex-1"
            />
          </div>

          {/* 월 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">월</Label>
            <Select value={String(form.exam_month)} onValueChange={(v) => setForm({ ...form, exam_month: Number(v) })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => <SelectItem key={m} value={String(m)}>{m}월</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 학년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">학년</Label>
            <Select value={String(form.grade)} onValueChange={(v) => setForm({ ...form, grade: Number(v) })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((g) => <SelectItem key={g} value={String(g)}>고{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 구분 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">구분</Label>
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="수능">수능</SelectItem>
                <SelectItem value="모의고사">모의고사</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 시험지 유형 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">유형</Label>
            <Select value={form.form_type} onValueChange={(v) => setForm({ ...form, form_type: v })}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="홀수형">홀수형</SelectItem>
                <SelectItem value="짝수형">짝수형</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 제목 미리보기 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">제목</Label>
            <div className="flex-1 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{autoTitle}</div>
          </div>

          {/* PDF */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">파일</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-1 items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              <File className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate">{fileName || 'PDF 또는 이미지 파일 선택'}</span>
            </button>
          </div>

          {uploading && <UploadProgress step={uploadStep} elapsed={elapsed} />}

          <Button className="w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <>
                <FileText className="mr-2 h-4 w-4 animate-spin" />
                파싱 중... ({elapsed}초)
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                업로드 & 파싱
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── 업로드 진행 표시 ──────────────────────────────────────────────────────

const UPLOAD_STEPS = [
  { label: 'PDF 전송 중...', sub: 'Claude에게 파일을 보내는 중입니다' },
  { label: 'Claude가 시험지를 읽는 중...', sub: '페이지 구조와 문항 범위를 파악하고 있습니다' },
  { label: '지문과 보기를 추출하는 중...', sub: '18~45번 문항을 하나씩 파싱하고 있습니다' },
  { label: '거의 다 됐습니다...', sub: 'JSON 구조로 변환 중입니다. 조금만 기다려주세요' },
]

function UploadProgress({ step, elapsed }: { step: number; elapsed: number }) {
  const current = UPLOAD_STEPS[step - 1] ?? UPLOAD_STEPS[0]
  const progress = Math.min((elapsed / 240) * 100, 95)

  return (
    <div className="rounded-lg border bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-blue-900">{current.label}</p>
        <span className="text-xs text-blue-600">{elapsed}초</span>
      </div>
      <p className="text-xs text-blue-600">{current.sub}</p>
      <div className="h-1.5 w-full rounded-full bg-blue-200">
        <div
          className="h-1.5 rounded-full bg-blue-500 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ── 해설 PDF 업로드 다이얼로그 ──────────────────────────────────────────────

function ExplanationUploadDialog({
  examId,
  onOpenChange,
}: {
  examId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !examId) return toast.error('PDF 파일을 선택해주세요')

    setUploading(true)
    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      const supabase = createClient()
      const storagePath = `${Date.now()}_explanation_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('exam-pdf-temp')
        .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
      if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)

      const res = await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '해설 파싱 실패')

      toast.success(`${data.updated}/${data.total}개 문항 해설 적용 완료`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank-search'] })
      onOpenChange(false)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '해설 PDF 파싱 실패')
    } finally {
      clearInterval(timer)
      setUploading(false)
      setElapsed(0)
    }
  }

  return (
    <Dialog open={!!examId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>해설 PDF 업로드</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-500">
          해설 PDF를 업로드하면 [출제의도], [해석], [풀이], [Words and Phrases]를 자동으로 추출하여 문항에 연결합니다.
        </p>
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors"
          >
            <File className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="truncate">{fileName || '해설 PDF 파일 선택'}</span>
          </button>

          {uploading && (
            <div className="rounded-lg border bg-amber-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-amber-900">해설 추출 중...</p>
                <span className="text-xs text-amber-600">{elapsed}초</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-amber-200">
                <div
                  className="h-1.5 rounded-full bg-amber-500 transition-all duration-1000"
                  style={{ width: `${Math.min((elapsed / 30) * 100, 95)}%` }}
                />
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleUpload} disabled={uploading}>
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                파싱 중... ({elapsed}초)
              </>
            ) : (
              <>
                <BookOpen className="mr-2 h-4 w-4" />
                해설 업로드
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
