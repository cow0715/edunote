'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Upload, Trash2, Search, Copy, ChevronDown, ChevronUp, FileText, File, Plus, Pencil, BarChart2, Loader2, BookOpen, ChevronRight, Sparkles, FolderOpen, CheckCircle2, XCircle, Circle, Download } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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

type VocabSource = {
  year: number
  month: number
  grade: number
  source: string
  question_number: number
}

type VocabCollection = {
  id: string
  title: string
  grade: number
  year_from: number
  year_to: number
  months: number[]
  item_count: number
  created_at: string
}

type VocabCollectionItem = {
  id: string
  word: string
  meaning: string
  frequency: number
  topic: string
  synonyms: string[]
  antonyms: string[]
  similar_words: string[]
  sources: VocabSource[]
  sort_order: number
}

type VocabCollectionDetail = VocabCollection & {
  items: VocabCollectionItem[]
}

type GenerateVocabResult =
  | { duplicate: true; existing: VocabCollection }
  | { duplicate?: false; id: string; title: string; item_count: number }

// ── 마크다운 인라인 렌더러 ────────────────────────────────────────────────
// **bold**, *italic*, <u>underline</u>을 React 요소로 변환

// 각주 마커(* word, ** word)와 구분: 여는 * 뒤에 공백 없음, 닫는 * 앞에 공백 없음
const MD_TOKEN_RE = /(\*\*(?!\s)[^*]+(?<!\s)\*\*|\*(?!\s)(?!\*)[^*]+(?<!\s)\*|<u>[^<]+<\/u>)/g

// 마크다운 → HTML (한글/워드 붙여넣기용)
function mdToHtml(text: string): string {
  return text
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)(?!\*)([^*]+?)(?<!\s)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

// 마크다운 기호 제거 (plain text용)
function mdToPlain(text: string): string {
  return text
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '$1')
    .replace(/\*(?!\s)(?!\*)([^*]+?)(?<!\s)\*/g, '$1')
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

const MONTHS = [3, 4, 5, 6, 7, 9, 10, 11]
const CURRENT_YEAR = new Date().getFullYear()

/** Response가 JSON이 아닐 때도 안전하게 파싱 */
async function safeJson(res: Response): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const text = await res.text()
  try {
    return { ok: res.ok, data: JSON.parse(text) }
  } catch {
    return { ok: false, data: { error: text.slice(0, 200) || `HTTP ${res.status}` } }
  }
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────

export default function ExamBankPage() {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">기출문제 은행</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            일괄 해설
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            PDF 업로드
          </Button>
        </div>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">시험 목록</TabsTrigger>
          <TabsTrigger value="search">문제 검색</TabsTrigger>
          <TabsTrigger value="vocab">단어장</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <ExamList />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <QuestionSearch />
        </TabsContent>

        <TabsContent value="vocab" className="mt-4">
          <VocabCollections />
        </TabsContent>
      </Tabs>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
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

// ── 기출 단어장 ───────────────────────────────────────────────────────────

function csvCell(value: string | number) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function sourceLabel(source: VocabSource) {
  return `${source.year}년 ${source.month}월 ${source.source} ${source.question_number}번`
}

function listOrEmpty(values: unknown) {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []
}

function hasRelatedWords(item: VocabCollectionItem) {
  return listOrEmpty(item.synonyms).length > 0
    || listOrEmpty(item.antonyms).length > 0
    || listOrEmpty(item.similar_words).length > 0
}

function downloadVocabCsv(collection: VocabCollectionDetail) {
  const header = ['번호', '단어', '뜻', '빈도', '주제', '유의어', '반의어', '유사어', '출처']
  const rows = collection.items.map((item, index) => [
    index + 1,
    item.word,
    item.meaning,
    item.frequency,
    item.topic,
    listOrEmpty(item.synonyms).join(' / '),
    listOrEmpty(item.antonyms).join(' / '),
    listOrEmpty(item.similar_words).join(' / '),
    item.sources.map(sourceLabel).join(' / '),
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${collection.title}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function readApiError(res: Response, fallback: string) {
  const text = await res.text().catch(() => '')
  if (text.includes('FUNCTION_INVOCATION_TIMEOUT') || res.status === 504) {
    return '단어장 생성 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.'
  }

  if (!text) return fallback

  try {
    const data = JSON.parse(text) as { error?: string; message?: string }
    return data.error ?? data.message ?? fallback
  } catch {
    return fallback
  }
}

function VocabCollections() {
  const queryClient = useQueryClient()
  const currentYear = new Date().getFullYear()
  const defaultYearTo = currentYear - 1
  const [yearFrom, setYearFrom] = useState(String(defaultYearTo - 4))
  const [yearTo, setYearTo] = useState(String(defaultYearTo))
  const [months, setMonths] = useState<number[]>([6, 9, 11])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [duplicateCollection, setDuplicateCollection] = useState<VocabCollection | null>(null)
  const [viewMode, setViewMode] = useState<'topic' | 'frequent' | 'related' | 'source'>('topic')

  const { data: collections, isLoading } = useQuery<VocabCollection[]>({
    queryKey: ['vocab-collections'],
    queryFn: () => fetch('/api/exam-bank/vocab-collections').then((r) => r.json()),
  })

  const { data: examsForYears } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
  })

  const { data: detail, isFetching: detailLoading } = useQuery<VocabCollectionDetail>({
    queryKey: ['vocab-collection', selectedId],
    queryFn: () => fetch(`/api/exam-bank/vocab-collections/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
  })

  useEffect(() => {
    setDuplicateCollection(null)
  }, [yearFrom, yearTo, months])

  const generateMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean } = {}) => {
      const res = await fetch('/api/exam-bank/vocab-collections/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_from: Number(yearFrom),
          year_to: Number(yearTo),
          grade: 3,
          months,
          force_regenerate: force,
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res, '단어장 생성 실패'))
      const data = await res.json()
      return data as GenerateVocabResult
    },
    onSuccess: (data) => {
      if (data.duplicate) {
        setDuplicateCollection(data.existing)
        toast.info('같은 조건의 단어장이 이미 있습니다')
        return
      }
      setDuplicateCollection(null)
      toast.success(`단어장 생성 완료 (${data.item_count}개)`)
      setSelectedId(data.id)
      queryClient.invalidateQueries({ queryKey: ['vocab-collections'] })
      queryClient.invalidateQueries({ queryKey: ['vocab-collection', data.id] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '단어장 생성 실패')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/exam-bank/vocab-collections/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readApiError(res, '단어장 삭제 실패'))
      return id
    },
    onSuccess: (id) => {
      toast.success('단어장을 삭제했습니다')
      if (selectedId === id) setSelectedId(null)
      setDuplicateCollection((current) => current?.id === id ? null : current)
      queryClient.invalidateQueries({ queryKey: ['vocab-collections'] })
      queryClient.removeQueries({ queryKey: ['vocab-collection', id] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '단어장 삭제 실패')
    },
  })

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, defaultYearTo])
    for (const exam of examsForYears ?? []) {
      if (Number.isFinite(exam.exam_year)) years.add(exam.exam_year)
    }
    for (const value of [yearFrom, yearTo]) {
      const year = Number(value)
      if (Number.isFinite(year) && year > 0) years.add(year)
    }
    const min = Math.min(...years)
    const max = Math.max(...years)
    return Array.from({ length: max - min + 1 }, (_, i) => max - i)
  }, [currentYear, defaultYearTo, examsForYears, yearFrom, yearTo])

  const toggleMonth = (month: number) => {
    setMonths((prev) => prev.includes(month)
      ? prev.filter((m) => m !== month)
      : [...prev, month].sort((a, b) => a - b))
  }

  const selectedCollection = detail ?? null
  const displayedItems = useMemo(() => {
    const items = [...(selectedCollection?.items ?? [])]
    if (viewMode === 'frequent') {
      return items.sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word))
    }
    if (viewMode === 'topic') {
      return items.sort((a, b) => a.topic.localeCompare(b.topic) || b.frequency - a.frequency || a.word.localeCompare(b.word))
    }
    if (viewMode === 'related') {
      return items
        .filter(hasRelatedWords)
        .sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word))
    }
    if (viewMode === 'source') {
      return items.sort((a, b) => {
        const aSource = a.sources[0]
        const bSource = b.sources[0]
        return (bSource?.year ?? 0) - (aSource?.year ?? 0)
          || (bSource?.month ?? 0) - (aSource?.month ?? 0)
          || (aSource?.question_number ?? 0) - (bSource?.question_number ?? 0)
          || a.word.localeCompare(b.word)
      })
    }
    return items.sort((a, b) => b.frequency - a.frequency || a.word.localeCompare(b.word))
  }, [selectedCollection, viewMode])

  const displaySections = useMemo(() => {
    if (viewMode !== 'topic') {
      const title = viewMode === 'frequent' ? '빈출순'
        : viewMode === 'related' ? '관련어 묶음'
          : '출처 최신순'
      return [{ title, items: displayedItems }]
    }

    const groups = new Map<string, VocabCollectionItem[]>()
    for (const item of displayedItems) {
      const topic = item.topic || '기타'
      groups.set(topic, [...(groups.get(topic) ?? []), item])
    }

    return [...groups.entries()]
      .map(([title, items]) => ({ title, items }))
      .sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title))
  }, [displayedItems, viewMode])

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-4 shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">기출 어휘 생성</h2>
            <BookOpen className="h-4 w-4 text-blue-600" />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">시행년</p>
              <div className="flex items-center gap-1">
                <Select value={yearFrom} onValueChange={setYearFrom}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => <SelectItem key={year} value={String(year)}>{year}년</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-300">~</span>
                <Select value={yearTo} onValueChange={setYearTo}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => <SelectItem key={year} value={String(year)}>{year}년</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide">시험</p>
              <div className="grid grid-cols-3 gap-2">
                {[6, 9, 11].map((month) => (
                  <label key={month} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gray-50 text-xs font-medium text-gray-600">
                    <Checkbox checked={months.includes(month)} onCheckedChange={() => toggleMonth(month)} />
                    {month === 11 ? '수능' : `${month}월`}
                  </label>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => generateMutation.mutate({ force: false })}
              disabled={generateMutation.isPending || months.length === 0}
            >
              {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              단어장 생성
            </Button>

            {duplicateCollection && (
              <div className="rounded-xl bg-blue-50 px-3 py-3 text-xs text-blue-700">
                <p className="font-semibold">같은 조건의 단어장이 이미 있습니다.</p>
                <p className="mt-1 text-blue-500">{duplicateCollection.title} · {duplicateCollection.item_count}개</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-blue-200 bg-white text-xs text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      setSelectedId(duplicateCollection.id)
                      setDuplicateCollection(null)
                    }}
                  >
                    기존 열기
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => generateMutation.mutate({ force: true })}
                    disabled={generateMutation.isPending}
                  >
                    재생성
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-2 shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80">
          {isLoading ? (
            <p className="px-3 py-6 text-sm text-gray-400">단어장을 불러오는 중...</p>
          ) : !collections?.length ? (
            <p className="px-3 py-6 text-sm text-gray-400">생성된 단어장이 없습니다.</p>
          ) : (
            <div className="space-y-1">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                    selectedId === collection.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(collection.id)}>
                      <p className="truncate text-sm font-semibold">{collection.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {collection.year_from}-{collection.year_to}년 · {collection.item_count}개
                      </p>
                    </button>
                    <button
                      className="mt-0.5 rounded-md p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      disabled={deleteMutation.isPending}
                      title="단어장 삭제"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (window.confirm(`"${collection.title}" 단어장을 삭제할까요?`)) {
                          deleteMutation.mutate(collection.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
        {!selectedCollection ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-400">
            단어장을 선택하거나 새로 생성하세요.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-gray-900">{selectedCollection.title}</h2>
                <p className="mt-0.5 text-xs text-gray-400">
                  {selectedCollection.year_from}-{selectedCollection.year_to}년 · {selectedCollection.months.map((m) => m === 11 ? '수능' : `${m}월`).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden rounded-lg bg-gray-50 p-1 sm:flex">
                  {[
                    ['topic', '주제'],
                    ['frequent', '빈출'],
                    ['related', '관련어 묶음'],
                    ['source', '출처'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setViewMode(value as typeof viewMode)}
                      className={`h-7 rounded-md px-2 text-xs font-medium transition-colors ${
                        viewMode === value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadVocabCsv(selectedCollection)}>
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-400">불러오는 중...</div>
            ) : (
              <div className="max-h-[680px] overflow-auto">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-400 sm:hidden">
                  <span>{displayedItems.length}개 표시</span>
                  <Select value={viewMode} onValueChange={(value) => setViewMode(value as typeof viewMode)}>
                    <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="topic">주제</SelectItem>
                      <SelectItem value="frequent">빈출</SelectItem>
                      <SelectItem value="related">관련어 묶음</SelectItem>
                      <SelectItem value="source">출처</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {displayedItems.length === 0 ? (
                  <div className="px-3 py-16 text-center text-sm text-gray-400">
                    표시할 단어가 없습니다.
                  </div>
                ) : (
                  <div>
                    {displaySections.map((section) => (
                      <section key={section.title} className="border-b border-gray-100 last:border-b-0">
                        <div className="sticky top-0 z-10 flex items-center justify-between bg-gray-50 px-4 py-2">
                          <h3 className="text-xs font-bold text-gray-700">{section.title}</h3>
                          <span className="text-[11px] text-gray-400">{section.items.length}개</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {section.items.map((item, index) => {
                            const synonyms = listOrEmpty(item.synonyms)
                            const antonyms = listOrEmpty(item.antonyms)
                            const similarWords = listOrEmpty(item.similar_words)
                            const rank = viewMode === 'topic' ? index + 1 : displayedItems.indexOf(item) + 1
                            return (
                              <div key={item.id} className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-[40px_minmax(160px,1.2fr)_minmax(240px,2fr)_120px]">
                                <div className="text-xs font-medium text-gray-300">{rank}</div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-gray-950">{item.word}</span>
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{item.frequency}회</span>
                                  </div>
                                  <p className="mt-1 text-gray-600">{item.meaning}</p>
                                </div>
                                <div className="space-y-1 text-xs leading-5 text-gray-500">
                                  {synonyms.length > 0 && <p><span className="font-semibold text-gray-400">유의</span> {synonyms.join(' / ')}</p>}
                                  {antonyms.length > 0 && <p><span className="font-semibold text-gray-400">반의</span> {antonyms.join(' / ')}</p>}
                                  {similarWords.length > 0 && <p><span className="font-semibold text-gray-400">유사</span> {similarWords.join(' / ')}</p>}
                                  {!synonyms.length && !antonyms.length && !similarWords.length ? <p className="text-gray-300">관련어 없음</p> : null}
                                </div>
                                <div className="text-xs leading-5 text-gray-400">
                                  {item.sources.slice(0, 3).map(sourceLabel).join(' / ')}
                                  {item.sources.length > 3 ? ` 외 ${item.sources.length - 3}` : ''}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </section>
                    ))}
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
                  title="AI 해설/어휘 생성 (20~24, 29~42번)"
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
  selectable,
  selected,
  onToggleSelect,
}: {
  question: ExamBankQuestion
  showExamInfo?: boolean
  onEdit?: () => void
  onDelete?: () => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const [showExplanation, setShowExplanation] = useState(false)
  const [editingExplanation, setEditingExplanation] = useState(false)
  const [expDraft, setExpDraft] = useState({
    intent: q.explanation_intent ?? '',
    translation: q.explanation_translation ?? '',
    solution: q.explanation_solution ?? '',
    vocabulary: q.explanation_vocabulary ?? '',
  })
  const [expSaving, setExpSaving] = useState(false)
  const queryClient = useQueryClient()
  const hasExplanation = !!(q.explanation_intent || q.explanation_translation || q.explanation_solution || q.explanation_vocabulary)

  const startEditExplanation = () => {
    setExpDraft({
      intent: q.explanation_intent ?? '',
      translation: q.explanation_translation ?? '',
      solution: q.explanation_solution ?? '',
      vocabulary: q.explanation_vocabulary ?? '',
    })
    setEditingExplanation(true)
    setShowExplanation(true)
  }

  const saveExplanation = async () => {
    setExpSaving(true)
    try {
      const res = await fetch(`/api/exam-bank/${q.exam_bank_id}/questions/${q.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          explanation_intent: expDraft.intent || null,
          explanation_translation: expDraft.translation || null,
          explanation_solution: expDraft.solution || null,
          explanation_vocabulary: expDraft.vocabulary || null,
        }),
      })
      if (!res.ok) throw new Error('저장 실패')
      await queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', q.exam_bank_id] })
      setEditingExplanation(false)
    } catch {
      toast.error('해설 저장에 실패했습니다')
    } finally {
      setExpSaving(false)
    }
  }

  // 시험 출처 레이블 (복사 헤더용)
  const examLabel = q.exam_bank
    ? `${q.exam_bank.exam_year}년 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
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

  const buildTranslationText = useCallback(() => {
    if (!q.explanation_translation) return ''
    const header = q.exam_bank ? `[${examLabel} 해석]\n` : `[${q.question_number}번 해석]\n`
    return header + q.explanation_translation
  }, [q, examLabel])

  const buildTranslationHtml = useCallback(() => {
    if (!q.explanation_translation) return ''
    const header = q.exam_bank ? `<p><strong>[${examLabel} 해석]</strong></p>` : `<p><strong>[${q.question_number}번 해석]</strong></p>`
    return header + `<p>${q.explanation_translation.replace(/\n/g, '<br>')}</p>`
  }, [q, examLabel])

  const copyQuestionWithTranslation = useCallback(async () => {
    const plain = buildQuestionText() + (q.explanation_translation ? '\n\n' + buildTranslationText() : '')
    const html = buildQuestionHtml() + (q.explanation_translation ? buildTranslationHtml() : '')
    await copyRich(plain, html)
    toast.success('문제+해석 복사 완료')
  }, [q, buildQuestionText, buildQuestionHtml, buildTranslationText, buildTranslationHtml])

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
          {/* 선택 체크박스 */}
          {selectable && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelect?.()}
              aria-label="선택"
              className="shrink-0"
            />
          )}
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
                  {/* 선지별 선택률 */}
                  {hasChoiceRates && q.choice_rates?.[i] != null && (
                    <span className={`ml-auto text-[11px] shrink-0 ${isAnswer ? 'text-blue-500 font-semibold' : 'text-gray-400'}`}>
                      {q.choice_rates[i]}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* 해설 토글 */}
        <div className="flex items-center gap-2">
          {hasExplanation && (
            <button
              onClick={() => setShowExplanation(!showExplanation)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showExplanation ? '해설 접기' : '해설 보기'}
            </button>
          )}
          {!editingExplanation && (
            <button
              onClick={startEditExplanation}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-amber-600 transition-colors"
            >
              <Pencil className="h-3 w-3" />
              해설 수정
            </button>
          )}
        </div>
        {showExplanation && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 space-y-2.5">
            {editingExplanation ? (
              <>
                {[
                  { key: 'intent', label: '출제의도' },
                  { key: 'translation', label: '해석' },
                  { key: 'solution', label: '풀이' },
                  { key: 'vocabulary', label: 'Words & Phrases' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">{label}</span>
                    <textarea
                      className="mt-0.5 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-gray-700 leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-amber-400"
                      rows={key === 'translation' ? 6 : key === 'vocabulary' ? 3 : 3}
                      value={expDraft[key as keyof typeof expDraft]}
                      onChange={(e) => setExpDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveExplanation}
                    disabled={expSaving}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    {expSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    저장
                  </button>
                  <button
                    onClick={() => setEditingExplanation(false)}
                    disabled={expSaving}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 문제 검색 ────────────────────────────────────────────────────────────

const DIFFICULTY_OPTIONS = ['하', '중하', '중', '중상', '최상'] as const
const EMPTY_FILTERS = {
  q: '',
  type: '',
  grade: '',
  year_from: '',
  year_to: '',
  kind: '',
  months: [] as string[],
  points: '',
  difficulties: [] as string[],
  max_correct_rate: '',
}

const PAGE_SIZE = 50

function buildFilterParams(f: typeof EMPTY_FILTERS) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.type) params.set('type', f.type)
  if (f.grade) params.set('grade', f.grade)
  if (f.year_from) params.set('year_from', f.year_from)
  if (f.year_to) params.set('year_to', f.year_to)
  if (f.months.length) params.set('month', f.months.join(','))
  if (f.kind === '수능') params.set('source', '수능')
  else if (f.kind === '모의고사') params.set('source', '모의고사')
  if (f.points) params.set('points', f.points)
  if (f.difficulties.length) params.set('difficulty', f.difficulties.join(','))
  if (f.max_correct_rate) params.set('max_correct_rate', f.max_correct_rate)
  return params
}

function filtersFromParams(sp: URLSearchParams): typeof EMPTY_FILTERS {
  const src = sp.get('source')
  const months = (sp.get('month') ?? '').split(',')
    .map((s) => s.trim())
    .filter((s) => MONTHS.includes(Number(s)))

  return {
    q: sp.get('q') ?? '',
    type: sp.get('type') ?? '',
    grade: sp.get('grade') ?? '',
    year_from: sp.get('year_from') ?? '',
    year_to: sp.get('year_to') ?? '',
    kind: src === '수능' ? '수능' : src === '모의고사' ? '모의고사' : '',
    months,
    points: sp.get('points') ?? '',
    difficulties: (sp.get('difficulty') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    max_correct_rate: sp.get('max_correct_rate') ?? '',
  }
}

function QuestionSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // 초기 필터: URL 쿼리에서 복원
  const [filters, setFilters] = useState(() => filtersFromParams(new URLSearchParams(searchParams?.toString() ?? '')))
  const [appliedFilters, setAppliedFilters] = useState(filters)
  const [copyingAll, setCopyingAll] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: examsForYears } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
  })

  const set = (key: keyof typeof EMPTY_FILTERS) => (v: string) =>
    setFilters((f) => ({ ...f, [key]: v === 'all' ? '' : v }))

  const toggleMonthFilter = (month: number) =>
    setFilters((f) => {
      const value = String(month)
      const months = f.months.includes(value)
        ? f.months.filter((m) => m !== value)
        : [...f.months, value].sort((a, b) => Number(a) - Number(b))
      return { ...f, months }
    })

  const monthFilterLabel = filters.months.length === 0 || filters.months.length === MONTHS.length
    ? '전체 월'
    : filters.months.map((m) => `${m}월`).join(', ')

  const toggleDifficulty = (d: string) =>
    setFilters((f) => ({
      ...f,
      difficulties: f.difficulties.includes(d)
        ? f.difficulties.filter((x) => x !== d)
        : [...f.difficulties, d],
    }))

  const filterKey = useMemo(() => buildFilterParams(appliedFilters).toString(), [appliedFilters])
  const liveFilterKey = useMemo(() => buildFilterParams(filters).toString(), [filters])
  const hasPendingChanges = liveFilterKey !== filterKey
  const yearOptions = useMemo(() => {
    const years = new Set<number>([CURRENT_YEAR])
    for (const exam of examsForYears ?? []) {
      if (Number.isFinite(exam.exam_year)) years.add(exam.exam_year)
    }
    for (const value of [filters.year_from, filters.year_to, appliedFilters.year_from, appliedFilters.year_to]) {
      const year = Number(value)
      if (Number.isFinite(year) && year > 0) years.add(year)
    }
    const minYear = Math.min(...years)
    const maxYear = Math.max(...years)
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i)
  }, [appliedFilters.year_from, appliedFilters.year_to, examsForYears, filters.year_from, filters.year_to])

  const runSearch = () => setAppliedFilters(filters)

  // URL 동기화 (filters 확정 후)
  useEffect(() => {
    const newQuery = filterKey
    const currentQuery = searchParams?.toString() ?? ''
    if (newQuery !== currentQuery) {
      router.replace(newQuery ? `${pathname}?${newQuery}` : pathname, { scroll: false })
    }
    // searchParams는 의존성에서 제외 (외부 변경 시 라우팅 충돌 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, pathname, router])

  // 필터 변경 시 선택 초기화
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filterKey])

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ['exam-bank-question-search', filterKey],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams(filterKey)
      params.set('page', String(pageParam))
      params.set('limit', String(PAGE_SIZE))
      const res = await fetch(`/api/exam-bank/questions?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '검색 실패')
      return json as { data: ExamBankQuestion[]; total: number; page: number; hasMore: boolean }
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  })

  const results = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])
  const total = data?.pages[0]?.total ?? 0
  const searching = isLoading || (isFetching && !isFetchingNextPage && results.length === 0)

  // 무한 스크롤 sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
  }

  const fetchAll = async () => {
    const params = new URLSearchParams(filterKey)
    params.set('all', '1')
    const res = await fetch(`/api/exam-bank/questions?${params}`)
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || '전체 조회 실패')
    return (json.data ?? []) as ExamBankQuestion[]
  }

  const getExamLabel = (q: ExamBankQuestion) =>
    q.exam_bank
      ? `${q.exam_bank.exam_year}년 ${q.exam_bank.exam_month}월 고${q.exam_bank.grade} ${q.exam_bank.source} ${q.question_number}번`
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

  const buildAllQWithTransText = (list: ExamBankQuestion[]) =>
    list.map((q) => {
      const circled2 = ['①','②','③','④','⑤']
      const ratesSummary = q.choice_rates?.some((r) => r != null)
        ? `\n선택률: ${q.choices.map((_, i) => {
            const r = q.choice_rates?.[i]
            return r != null ? `${circled2[i]} ${r}%` : null
          }).filter(Boolean).join('   ')}`
        : ''
      const qPart = [
        `[${getExamLabel(q)}]`,
        `\n${mdToPlain(q.question_text)}`,
        q.passage ? `\n${mdToPlain(q.passage)}` : '',
        q.choices.length > 0 ? `\n${q.choices.map(mdToPlain).join('\n')}` : '',
        q.answer ? `\n정답: ${q.answer}` : '',
        ratesSummary,
      ].join('')
      const transPart = q.explanation_translation
        ? `\n\n[${getExamLabel(q)} 해석]\n${q.explanation_translation}`
        : ''
      return qPart + transPart
    }).join('\n\n---\n\n')

  const buildAllQWithTransHtml = (list: ExamBankQuestion[]) =>
    list.map((q) =>
      `<p><strong>[${getExamLabel(q)}]</strong></p>`
      + `<p>${mdToHtml(q.question_text)}</p>`
      + (q.passage ? `<p>${mdToHtml(q.passage)}</p>` : '')
      + (q.choices.length > 0 ? `<p>${q.choices.map(mdToHtml).join('<br>')}</p>` : '')
      + (q.answer ? `<p>정답: ${q.answer}</p>` : '')
      + (q.explanation_translation
        ? `<p><strong>[${getExamLabel(q)} 해석]</strong><br>${q.explanation_translation.replace(/\n/g, '<br>')}</p>`
        : '')
    ).join('<hr>')

  const runCopyAll = async (
    label: string,
    build: (list: ExamBankQuestion[]) => { plain: string; html: string },
  ) => {
    if (total === 0 || copyingAll) return
    setCopyingAll(true)
    try {
      const all = await fetchAll()
      if (!all.length) {
        toast.error('복사할 문항이 없습니다')
        return
      }
      const { plain, html } = build(all)
      await copyRich(plain, html)
      toast.success(`${label} ${all.length}개 복사됨`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '복사 실패')
    } finally {
      setCopyingAll(false)
    }
  }

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const clearSelection = () => setSelectedIds(new Set())

  const selectedQuestions = useMemo(
    () => results.filter((q) => selectedIds.has(q.id)),
    [results, selectedIds],
  )

  const runCopySelected = async (
    label: string,
    build: (list: ExamBankQuestion[]) => { plain: string; html: string },
  ) => {
    if (selectedQuestions.length === 0) return
    const { plain, html } = build(selectedQuestions)
    await copyRich(plain, html)
    toast.success(`${label} ${selectedQuestions.length}개 복사됨`)
  }

  const copySelectedQuestions = () =>
    runCopySelected('문제', (list) => ({ plain: buildAllQText(list), html: buildAllQHtml(list) }))
  const copySelectedExplanations = () =>
    runCopySelected('해설', (list) => ({ plain: buildAllExText(list), html: buildAllExHtml(list) }))
  const copySelectedBoth = () =>
    runCopySelected('문제+해설', (list) => ({
      plain: buildAllQText(list) + '\n\n' + buildAllExText(list),
      html: buildAllQHtml(list) + buildAllExHtml(list),
    }))

  const copyAllQuestions = () =>
    runCopyAll('문제', (list) => ({ plain: buildAllQText(list), html: buildAllQHtml(list) }))

  const copyAllWithTranslation = () =>
    runCopyAll('문제+해석', (list) => ({
      plain: buildAllQWithTransText(list),
      html: buildAllQWithTransHtml(list),
    }))

  const copyAllExplanations = () =>
    runCopyAll('해설', (list) => ({ plain: buildAllExText(list), html: buildAllExHtml(list) }))

  const copyAllBoth = () =>
    runCopyAll('문제+해설', (list) => ({
      plain: buildAllQText(list) + '\n\n' + buildAllExText(list),
      html: buildAllQHtml(list) + buildAllExHtml(list),
    }))

  const hasFilter = filters.type || filters.grade || filters.year_from || filters.year_to
    || filters.kind || filters.months.length || filters.points || filters.difficulties.length || filters.max_correct_rate

  return (
    <div className="space-y-4">
      {/* ── 상단 필터 패널 ── */}
      <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 p-4 sticky top-4 z-10 space-y-3">

        {/* 키워드 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch()
              }
            }}
            placeholder="지문/발문에서 키워드 검색 (예: vaccine effective). Enter 또는 검색 버튼으로 실행"
            className="pl-9 pr-9 h-9"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isFetching && !isFetchingNextPage && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
            )}
            {filters.q && (
              <button
                onClick={() => setFilters((f) => ({ ...f, q: '' }))}
                className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                aria-label="검색어 지우기"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

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
          <div className="min-w-[132px]">
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">?</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-full justify-between rounded-lg border-gray-200 bg-white px-3 text-xs font-normal text-gray-700 hover:bg-gray-50"
                >
                  <span className="truncate">{monthFilterLabel}</span>
                  <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40 rounded-xl border-gray-100 bg-white p-1.5 shadow-[0px_12px_36px_rgba(0,75,198,0.10)]">
                <DropdownMenuCheckboxItem
                  checked={filters.months.length === 0}
                  onCheckedChange={() => setFilters((f) => ({ ...f, months: [] }))}
                  onSelect={(e) => e.preventDefault()}
                  className="rounded-lg text-xs"
                >
                  ?? ?
                </DropdownMenuCheckboxItem>
                {MONTHS.map((month) => (
                  <DropdownMenuCheckboxItem
                    key={month}
                    checked={filters.months.includes(String(month))}
                    onCheckedChange={() => toggleMonthFilter(month)}
                    onSelect={(e) => e.preventDefault()}
                    className="rounded-lg text-xs"
                  >
                    {month}?
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* 시행년 */}
          <div>
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">시행년</p>
            <div className="flex items-center gap-1">
              <Select value={filters.year_from || 'all'} onValueChange={set('year_from')}>
                <SelectTrigger className="h-8 text-xs w-[88px]"><SelectValue placeholder="시작" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-gray-300">~</span>
              <Select value={filters.year_to || 'all'} onValueChange={set('year_to')}>
                <SelectTrigger className="h-8 text-xs w-[88px]"><SelectValue placeholder="종료" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
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

          {/* 검색 버튼 */}
          <button
            onClick={runSearch}
            className={`h-8 px-4 rounded-lg text-xs font-medium transition-colors self-end inline-flex items-center gap-1.5 ${
              hasPendingChanges
                ? 'bg-blue-600 text-white hover:bg-blue-700 ring-2 ring-blue-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            검색
            {hasPendingChanges && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </button>
        </div>
      </div>

      {/* ── 결과 ── */}
      {searching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
      )}

      {!searching && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-gray-500 flex items-center gap-1.5">
              {total > 0
                ? `${results.length} / ${total}개 문항 표시${selectedIds.size > 0 ? ` · ${selectedIds.size}개 선택` : ''}`
                : '검색 결과가 없습니다'}
              {isFetching && !isFetchingNextPage && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
              )}
            </p>
            {total > 0 && (
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <>
                    <Button size="sm" variant="ghost" onClick={clearSelection}>
                      선택 해제
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm">
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          선택 복사 ({selectedIds.size})
                          <ChevronDown className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={copySelectedQuestions}>문제만</DropdownMenuItem>
                        <DropdownMenuItem onClick={copySelectedExplanations}>해설만</DropdownMenuItem>
                        <DropdownMenuItem onClick={copySelectedBoth}>문제+해설</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={copyingAll}>
                      {copyingAll ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      전체 복사 ({total})
                      <ChevronDown className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={copyAllQuestions}>문제만</DropdownMenuItem>
                    <DropdownMenuItem onClick={copyAllExplanations}>해설만</DropdownMenuItem>
                    <DropdownMenuItem onClick={copyAllBoth}>문제+해설</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
          {results.length > 0 && (
            <>
              <div
                className={`grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 transition-opacity ${
                  isFetching && !isFetchingNextPage ? 'opacity-60' : ''
                }`}
              >
                {results.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    showExamInfo
                    selectable
                    selected={selectedIds.has(q.id)}
                    onToggleSelect={() => toggleSelect(q.id)}
                  />
                ))}
              </div>
              <div ref={sentinelRef} className="h-8" />
              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              )}
              {!hasNextPage && total > PAGE_SIZE && (
                <p className="text-center text-xs text-gray-400 py-4">
                  모든 문항을 불러왔습니다
                </p>
              )}
            </>
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
    exam_month: 4,
    grade: 3,
    source: '모의고사',
    form_type: '홀수형',
  })

  const autoTitle = form.source === '수능'
    ? `${form.exam_year}년 ${form.exam_month}월 수능`
    : `${form.exam_year}년 ${form.exam_month}월 고${form.grade} 모의고사`

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
      const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
      const storagePath = `${Date.now()}_${safeFileName}`
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


      let data = await res.json()

      // 콘텐츠 필터 에러 → 페이지별 이미지 fallback
      if (!res.ok && data.contentFilter) {
        toast.info('일부 페이지 필터 감지, 페이지별 재처리 중...')

        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const blobs: Blob[] = new Array(pdf.numPages)
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: 2.0 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          blobs[i - 1] = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
        }

        const ts = Date.now()
        const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
        const storagePaths = await Promise.all(
          blobs.map(async (blob, i) => {
            const path = `${ts}_${safeFileName}_p${String(i + 1).padStart(2, '0')}.png`
            const { error } = await supabase.storage.from('exam-pdf-temp').upload(path, blob, { contentType: 'image/png' })
            if (error) throw new Error(`페이지 ${i + 1} 업로드 실패: ${error.message}`)
            return path
          })
        )

        const res2 = await fetch('/api/exam-bank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, title: autoTitle, storagePaths, mimeType: 'image/png' }),
        })
        data = await res2.json()
        if (!res2.ok) throw new Error(data.error || '재처리 실패')
      } else if (!res.ok) {
        throw new Error(data.error || '업로드 실패')
      }

      const skippedMsg = data.skipped_pages?.length ? ` · ${data.skipped_pages.length}개 페이지 건너뜀` : ''
      const statsMsg = data.stats_fetched > 0 ? ` · 메가스터디 통계 ${data.stats_fetched}문항` : ''
      toast.success(`${data.question_count}개 문항 추출 완료${statsMsg}${skippedMsg}`)
      queryClient.invalidateQueries({ queryKey: ['exam-bank'] })
      onOpenChange(false)
      setForm({ exam_year: new Date().getFullYear(), exam_month: 4, grade: 3, source: '모의고사', form_type: '홀수형' })
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
          {/* 년 */}
          <div className="flex items-center gap-3">
            <Label className="w-16 shrink-0 text-right text-sm text-gray-500">년</Label>
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
            <Select
              value={form.source}
              onValueChange={(v) => setForm({
                ...form,
                source: v,
                exam_month: v === '수능' ? 11 : form.exam_month,
                grade: v === '수능' ? 3 : form.grade,
              })}
            >
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
  const [preview, setPreview] = useState<{ rawTextPreview: string; parsed: { question_number: number; intent: string; translation: string; solution: string; vocabulary: string }[]; parsedCount: number } | null>(null)

  const uploadToStorage = async (file: File) => {
    const supabase = createClient()
    const safeFileName = file.name.replace(/[^\w.\-]/g, '_')
    const storagePath = `${Date.now()}_explanation_${safeFileName}`
    const { error: uploadErr } = await supabase.storage
      .from('exam-pdf-temp')
      .upload(storagePath, file, { contentType: file.type || 'application/pdf' })
    if (uploadErr) throw new Error(`파일 업로드 실패: ${uploadErr.message}`)
    return storagePath
  }

  const handlePreview = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !examId) return toast.error('PDF 파일을 선택해주세요')

    setUploading(true)
    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      const storagePath = await uploadToStorage(file)
      const { ok, data } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/debug-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
      )
      if (!ok) throw new Error((data.error as string) || '파싱 실패')
      setPreview(data as Parameters<typeof setPreview>[0])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '파싱 미리보기 실패')
    } finally {
      clearInterval(timer)
      setUploading(false)
      setElapsed(0)
    }
  }

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file || !examId) return toast.error('PDF 파일을 선택해주세요')

    setUploading(true)
    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      const storagePath = await uploadToStorage(file)
      const { ok: pdfOk, data } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/upload-explanation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        })
      )
      if (!pdfOk) throw new Error((data.error as string) || '해설 파싱 실패')

      // PDF 파싱 완료 → AI 해석/어휘 자동 생성 (20~24, 29~42번)
      const { ok: aiOk, data: aiData } = await safeJson(
        await fetch(`/api/exam-bank/${examId}/generate-explanation`, { method: 'POST' })
      )
      if (aiOk) {
        toast.success(`해설 적용 완료 (PDF ${data.updated}문항 + AI ${aiData.updated}문항)`)
      } else {
        toast.success(`PDF 해설 ${data.updated}/${data.total}문항 적용 완료`)
        toast.warning('AI 해설 생성 실패 — 나중에 Sparkles 버튼으로 재시도하세요')
      }
      queryClient.invalidateQueries({ queryKey: ['exam-bank-questions', examId] })
      queryClient.invalidateQueries({ queryKey: ['exam-bank-search'] })
      onOpenChange(false)
      setFileName('')
      setPreview(null)
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
    <Dialog open={!!examId} onOpenChange={(open) => { if (!open) setPreview(null); onOpenChange(open) }}>
      <DialogContent className={preview ? 'max-w-2xl' : 'max-w-sm'}>
        <DialogHeader>
          <DialogTitle>해설 PDF 업로드</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <>
            <p className="text-sm text-gray-500">
              해설 PDF를 업로드하면 [출제의도], [해석], [풀이], [Words and Phrases]를 자동으로 추출하여 문항에 연결합니다.
            </p>
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ''); setPreview(null) }}
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
                    <p className="text-sm font-medium text-amber-900">파싱 중...</p>
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

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handlePreview} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  파싱 미리보기
                </Button>
                <Button className="flex-1" onClick={handleUpload} disabled={uploading}>
                  {uploading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />저장 중...</>
                  ) : (
                    <><BookOpen className="mr-2 h-4 w-4" />해설 저장</>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                파싱 결과: <span className="text-blue-600 font-semibold">{preview.parsedCount}개 문항</span>
              </p>
              <button
                onClick={() => setPreview(null)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                ← 다시 선택
              </button>
            </div>

            {/* 원시 텍스트 미리보기 */}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 mb-1">원시 텍스트 (앞 3000자)</summary>
              <pre className="max-h-40 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600 whitespace-pre-wrap">
                {preview.rawTextPreview}
              </pre>
            </details>

            {/* 파싱된 문항 목록 */}
            <div className="max-h-80 overflow-auto space-y-2 pr-1">
              {preview.parsed.map((p) => (
                <div key={p.question_number} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs space-y-1">
                  <p className="font-semibold text-gray-800">{p.question_number}번</p>
                  {p.intent && <p><span className="text-gray-400">출제의도</span> {p.intent}</p>}
                  {p.translation && (
                    <p className="line-clamp-2"><span className="text-gray-400">해석</span> {p.translation}</p>
                  )}
                  {!p.translation && <p className="text-red-400">해석 없음</p>}
                  {p.vocabulary && (
                    <p className="line-clamp-1"><span className="text-gray-400">어휘</span> {p.vocabulary}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>
                다시 선택
              </Button>
              <Button className="flex-1" onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />저장 중...</> : '이대로 저장'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── 일괄 해설 업로드 다이얼로그 ───────────────────────────────────────────
// 파일명 규칙: YYYY_MM_G.pdf (예: 2025_06_3.pdf = 2025년 6월 고3)

type BulkItem = {
  file: File
  exam: ExamBank | null      // 매칭된 시험
  status: 'pending' | 'processing' | 'done' | 'error'
  message: string
}

function parseBulkFilename(name: string): { year: number; month: number; grade: number } | null {
  // YYYY_MM_G 또는 YYYY_M_G
  const m = name.match(/(\d{4})_(\d{1,2})_(\d)/)
  if (!m) return null
  return { year: parseInt(m[1]), month: parseInt(m[2]), grade: parseInt(m[3]) }
}

function BulkExplanationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<BulkItem[]>([])
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState(0)

  const { data: exams } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
    enabled: open,
  })

  const handleFiles = (files: FileList | null) => {
    if (!files || !exams) return
    const arr = Array.from(files).filter((f) => f.name.endsWith('.pdf'))
    const newItems: BulkItem[] = arr.map((file) => {
      const parsed = parseBulkFilename(file.name)
      const exam = parsed
        ? (exams.find(
            (e) => e.exam_year === parsed.year && e.exam_month === parsed.month && e.grade === parsed.grade,
          ) ?? null)
        : null
      return { file, exam, status: 'pending', message: exam ? `${exam.title}` : '매칭 실패 — 파일명 확인' }
    })
    setItems(newItems)
  }

  const handleRun = async (useVision = false) => {
    const matched = items.filter((it) => it.exam)
    if (!matched.length) return toast.error('매칭된 시험이 없습니다')

    setRunning(true)
    setCurrent(0)

    const pdfEndpoint = useVision ? 'upload-explanation-vision' : 'upload-explanation'

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.exam) continue

      setCurrent(i + 1)
      setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, status: 'processing' } : x))

      try {
        const supabase = createClient()
        const safeFileName = it.file.name.replace(/[^\w.\-]/g, '_')
        const storagePath = `${Date.now()}_bulk_${safeFileName}`
        const { error: uploadErr } = await supabase.storage
          .from('exam-pdf-temp')
          .upload(storagePath, it.file, { contentType: 'application/pdf' })
        if (uploadErr) throw new Error(`업로드 실패: ${uploadErr.message}`)

        // PDF 파싱
        const { ok: pdfOk, data } = await safeJson(
          await fetch(`/api/exam-bank/${it.exam.id}/${pdfEndpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storagePath }),
          })
        )
        if (!pdfOk) throw new Error((data.error as string) || '파싱 실패')

        // AI 해설/어휘 생성
        const { ok: aiOk, data: aiData } = await safeJson(
          await fetch(`/api/exam-bank/${it.exam.id}/generate-explanation`, { method: 'POST' })
        )

        const label = useVision ? 'Vision' : 'PDF'
        const msg = aiOk
          ? `완료 — ${label} ${data.updated}문항 + AI ${aiData.updated}문항`
          : `${label} ${data.updated}문항 완료 (AI 실패: ${aiData.error ?? ''})`

        setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, status: 'done', message: msg } : x))
      } catch (e) {
        const msg = e instanceof Error ? e.message : '오류'
        setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, status: 'error', message: msg } : x))
      }
    }

    setRunning(false)
    toast.success('일괄 처리 완료')
  }

  const matchedCount = items.filter((it) => it.exam).length
  const doneCount = items.filter((it) => it.status === 'done').length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) { onOpenChange(v); if (!v) setItems([]) } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>일괄 해설 업로드</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">파일명 규칙: <code>YYYY_MM_G.pdf</code></p>
            <p>예시: <code>2025_06_3.pdf</code> → 2025년 6월 고3 / <code>2025_11_3.pdf</code> → 2025년 11월 수능</p>
          </div>

          <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden"
            onChange={(e) => handleFiles(e.target.files)} />

          {items.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
            >
              <FolderOpen className="h-8 w-8" />
              <span className="text-sm">PDF 파일 여러 개 선택</span>
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{items.length}개 파일 · 매칭 {matchedCount}개</span>
                <button onClick={() => { setItems([]); if (fileRef.current) fileRef.current.value = '' }}
                  className="text-gray-400 hover:text-gray-600">다시 선택</button>
              </div>

              <div className="max-h-64 overflow-auto space-y-1.5 pr-1">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                    {it.status === 'pending' && (it.exam
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      : <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                    )}
                    {it.status === 'processing' && <Loader2 className="h-4 w-4 shrink-0 text-blue-500 animate-spin" />}
                    {it.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-600" />}
                    {it.status === 'error' && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-700 truncate">{it.file.name}</p>
                      <p className={`truncate ${it.exam ? 'text-gray-400' : 'text-red-400'} ${it.status === 'done' ? 'text-blue-500' : ''} ${it.status === 'error' ? 'text-red-500' : ''}`}>
                        {it.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {running && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>처리 중... ({doneCount}/{matchedCount})</span>
                    <span>{Math.round((doneCount / matchedCount) * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${(doneCount / matchedCount) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => handleRun(false)} disabled={running || matchedCount === 0}>
                  {running
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{current}/{matchedCount} 처리 중...</>
                    : <><Sparkles className="mr-2 h-4 w-4" />일괄 처리</>
                  }
                </Button>
                <Button variant="outline" onClick={() => handleRun(true)} disabled={running || matchedCount === 0} title="텍스트 추출 실패 PDF용 — Claude Vision으로 직접 파싱 (느림)">
                  {running
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <><Sparkles className="mr-1.5 h-4 w-4 text-purple-500" />Vision</>
                  }
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
