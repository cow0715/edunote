'use client'

import { useState, useRef, useCallback } from 'react'
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
import { Upload, Trash2, Search, Copy, ChevronDown, ChevronUp, FileText, Plus, Pencil, File } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// ── 타입 ──────────────────────────────────────────────────────────────────

type ExamBank = {
  id: string
  title: string
  exam_year: number
  exam_month: number
  grade: number
  source: string
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
  // execCommand 방식: 브라우저+OS가 HTML→RTF 변환 처리 (한글 호환성 ↑)
  const div = document.createElement('div')
  div.innerHTML = htmlText
  div.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;'
  document.body.appendChild(div)
  try {
    const range = document.createRange()
    range.selectNodeContents(div)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.execCommand('copy')
    sel?.removeAllRanges()
  } finally {
    document.body.removeChild(div)
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

// ── 시험 목록 ─────────────────────────────────────────────────────────────

function ExamList() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
      {exams.map((exam) => (
        <Card key={exam.id} className="p-4">
          <div className="flex items-center justify-between">
            <div
              className="flex-1 cursor-pointer"
              onClick={() => setExpandedId(expandedId === exam.id ? null : exam.id)}
            >
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{exam.title}</h3>
                <Badge variant="secondary">{exam.source}</Badge>
                <Badge variant="outline">
                  {exam.exam_bank_question?.[0]?.count ?? 0}문항
                </Badge>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {exam.exam_year}년 {exam.exam_month}월 · 고{exam.grade}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedId(expandedId === exam.id ? null : exam.id)}
              >
                {expandedId === exam.id ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => {
                  if (confirm('이 시험과 모든 문항을 삭제하시겠습니까?')) {
                    deleteMutation.mutate(exam.id)
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {expandedId === exam.id && <QuestionList examId={exam.id} />}
        </Card>
      ))}
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
    <div className="mt-4 border-t pt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">{questions?.length ?? 0}문항</p>
        <Button size="sm" variant="outline" onClick={() => setEditTarget('new')}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          문항 추가
        </Button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">문항 로딩 중...</p>}
      {!isLoading && !questions?.length && <p className="text-sm text-gray-500">문항 없음</p>}

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
  const copyText = useCallback(async () => {
    const plain = [
      `[${q.question_number}번] ${mdToPlain(q.question_text)}`,
      q.passage ? `\n${mdToPlain(q.passage)}` : '',
      q.choices.length > 0 ? `\n${q.choices.map(mdToPlain).join('\n')}` : '',
      q.answer ? `\n정답: ${q.answer}` : '',
    ].join('')

    const html = `<p><strong>[${q.question_number}번]</strong> ${mdToHtml(q.question_text)}</p>`
      + (q.passage ? `<p>${mdToHtml(q.passage)}</p>` : '')
      + (q.choices.length > 0 ? `<p>${q.choices.map(mdToHtml).join('<br>')}</p>` : '')
      + (q.answer ? `<p>정답: ${q.answer}</p>` : '')

    await copyRich(plain, html)
    toast.success('클립보드에 복사되었습니다')
  }, [q])

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">{q.question_number}번</span>
          <Badge variant="secondary" className="text-xs">
            {QUESTION_TYPE_LABELS[q.question_type] || q.question_type}
          </Badge>
          {q.answer && (
            <Badge variant="outline" className="text-xs">
              정답: {q.answer}
            </Badge>
          )}
          {showExamInfo && q.exam_bank && (
            <span className="text-xs text-gray-400">
              {q.exam_bank.exam_year}년 {q.exam_bank.exam_month}월 고{q.exam_bank.grade} {q.exam_bank.source}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={copyText}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap text-justify">
        <MarkdownText text={q.question_text} />
      </p>

      {q.passage && (
        <pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-600 text-justify">
          <MarkdownText text={q.passage} />
        </pre>
      )}

      {q.choices.length > 0 && (
        <div className="mt-2 space-y-1">
          {q.choices.map((c, i) => (
            <p key={i} className="text-sm text-gray-600">{c}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 문제 검색 (인라인) ────────────────────────────────────────────────────

const EMPTY_FILTERS = { type: '', grade: '', year_from: '', year_to: '', kind: '', month: '' }

function QuestionSearch() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [results, setResults] = useState<ExamBankQuestion[] | null>(null)
  const [searching, setSearching] = useState(false)

  const set = (key: keyof typeof EMPTY_FILTERS) => (v: string) =>
    setFilters((f) => ({ ...f, [key]: v === 'all' ? '' : v }))

  const handleSearch = async () => {
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (filters.type) params.set('type', filters.type)
      if (filters.grade) params.set('grade', filters.grade)
      if (filters.year_from) params.set('year_from', filters.year_from)
      if (filters.year_to) params.set('year_to', filters.year_to)
      if (filters.month) params.set('month', filters.month)
      if (filters.kind === '수능') params.set('source', '수능')
      else if (filters.kind === '모의고사') params.set('source', '모의고사')

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

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setResults(null)
  }

  const copyAll = async () => {
    if (!results?.length) return
    const examInfo = (q: ExamBankQuestion) =>
      q.exam_bank ? `${q.exam_bank.exam_year}년 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade}` : ''

    const plain = results.map((q) => [
      `[${examInfo(q)} ${q.question_number}번] ${mdToPlain(q.question_text)}`,
      q.passage ? `\n${mdToPlain(q.passage)}` : '',
      q.choices.length > 0 ? `\n${q.choices.map(mdToPlain).join('\n')}` : '',
      q.answer ? `\n정답: ${q.answer}` : '',
    ].join('')).join('\n\n---\n\n')

    const html = results.map((q) =>
      `<p><strong>[${examInfo(q)} ${q.question_number}번]</strong> ${mdToHtml(q.question_text)}</p>`
      + (q.passage ? `<p>${mdToHtml(q.passage)}</p>` : '')
      + (q.choices.length > 0 ? `<p>${q.choices.map(mdToHtml).join('<br>')}</p>` : '')
      + (q.answer ? `<p>정답: ${q.answer}</p>` : '')
    ).join('<hr>')

    await copyRich(plain, html)
    toast.success(`${results.length}개 문항이 클립보드에 복사되었습니다`)
  }

  const hasFilter = Object.values(filters).some(Boolean)

  return (
    <div className="flex gap-5 items-start">
      {/* 결과 영역 */}
      <div className="flex-1 min-w-0 space-y-3">
        {results === null && (
          <p className="text-sm text-gray-400 mt-2">필터를 선택하고 검색하세요.</p>
        )}
        {results !== null && results.length === 0 && (
          <p className="text-sm text-gray-400 mt-2">검색 결과가 없습니다.</p>
        )}
        {results !== null && results.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{results.length}개 문항</p>
              <Button size="sm" variant="outline" onClick={copyAll}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                전체 복사 ({results.length})
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {results.map((q) => <QuestionCard key={q.id} question={q} showExamInfo />)}
            </div>
          </>
        )}
      </div>

      {/* 필터 패널 (우측 고정) */}
      <Card className="w-44 shrink-0 p-3 sticky top-4">
        <div className="space-y-2">
          {([
            { key: 'type', label: '유형', items: [['all', '전체 유형'], ...Object.entries(QUESTION_TYPE_LABELS)] },
            { key: 'grade', label: '학년', items: [['all', '전체'], ['1', '고1'], ['2', '고2'], ['3', '고3']] },
            { key: 'kind', label: '구분', items: [['all', '전체'], ['수능', '수능'], ['모의고사', '모의고사']] },
            { key: 'month', label: '월', items: [['all', '전체'], ...MONTHS.map((m) => [String(m), `${m}월`])] },
          ] as { key: keyof typeof EMPTY_FILTERS; label: string; items: [string, string][] }[]).map(({ key, label, items }) => (
            <div key={key}>
              <p className="mb-0.5 text-[11px] text-gray-400">{label}</p>
              <Select value={filters[key] || 'all'} onValueChange={set(key)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}

          <div>
            <p className="mb-0.5 text-[11px] text-gray-400">년도</p>
            <div className="flex items-center gap-1">
              <Select value={filters.year_from || 'all'} onValueChange={set('year_from')}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="시작" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-gray-400">~</span>
              <Select value={filters.year_to || 'all'} onValueChange={set('year_to')}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="종료" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <Button size="sm" onClick={handleSearch} disabled={searching} className="w-full h-7 text-xs">
            <Search className="mr-1 h-3 w-3" />
            {searching ? '검색 중...' : '검색'}
          </Button>
          {hasFilter && (
            <Button size="sm" variant="ghost" onClick={handleReset} className="w-full h-7 text-xs text-gray-400">
              초기화
            </Button>
          )}
        </div>
      </Card>
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

      toast.success(`${data.question_count}개 문항이 추출되었습니다`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      onOpenChange(false)
      setForm({ exam_year: new Date().getFullYear(), exam_month: 3, grade: 2, source: '교육청' })
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
