'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { errorMessage, runWithLoading } from '@/lib/async-ui'
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { Search, Copy, ChevronDown, Loader2, XCircle, Info } from 'lucide-react'
import {
  CURRENT_YEAR,
  DIFFICULTY_CRITERIA,
  DIFFICULTY_CRITERIA_TEXT,
  DIFFICULTY_OPTIONS,
  DIFFICULTY_STYLE,
  MONTHS,
  QUESTION_TYPE_LABELS,
} from './constants'
import { buildQuestionCopyText, buildQuestionCopyHtml, copyRich } from './markdown'
import { QuestionCard } from './question-list'
import type { ExamBank, ExamBankQuestion } from './types'

// ── 문제 검색 ────────────────────────────────────────────────────────────

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

export function QuestionSearch() {
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
    // useSearchParams() 값을 쓰면 외부 URL 변경 때마다 이 effect 가 다시 돌아 라우팅이 충돌한다.
    // 현재 쿼리는 effect 안에서 직접 읽어 의존성에서 뺀다 (exhaustive-deps 억제 주석을 없애야
    // React Compiler 가 이 컴포넌트를 최적화한다).
    const currentQuery = window.location.search.replace(/^\?/, '')
    if (newQuery !== currentQuery) {
      router.replace(newQuery ? `${pathname}?${newQuery}` : pathname, { scroll: false })
    }
  }, [filterKey, pathname, router])

  // 필터 변경 시 선택 초기화 — 렌더 중 조정 (effect 로 하면 이전 선택이 한 프레임 남는다)
  const [syncedFilterKey, setSyncedFilterKey] = useState(filterKey)
  if (syncedFilterKey !== filterKey) {
    setSyncedFilterKey(filterKey)
    setSelectedIds(new Set())
  }

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

  const buildAllQText = (list: ExamBankQuestion[]) =>
    list.map((q) => buildQuestionCopyText(q, getExamLabel(q))).join('\n\n---\n\n')

  const buildAllQHtml = (list: ExamBankQuestion[]) =>
    list.map((q) => buildQuestionCopyHtml(q, getExamLabel(q))).join('<hr>')

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

  const runCopyAll = async (
    label: string,
    build: (list: ExamBankQuestion[]) => { plain: string; html: string },
  ) => {
    if (total === 0 || copyingAll) return
    await runWithLoading(setCopyingAll, async () => {
      const all = await fetchAll()
      if (!all.length) {
        toast.error('복사할 문항이 없습니다')
        return
      }
      const { plain, html } = build(all)
      await copyRich(plain, html)
      toast.success(`${label} ${all.length}개 복사됨`)
    }, (e) => toast.error(errorMessage(e, '복사 실패')))
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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
            <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">월</p>
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
                  전체 월
                </DropdownMenuCheckboxItem>
                {MONTHS.map((month) => (
                  <DropdownMenuCheckboxItem
                    key={month}
                    checked={filters.months.includes(String(month))}
                    onCheckedChange={() => toggleMonthFilter(month)}
                    onSelect={(e) => e.preventDefault()}
                    className="rounded-lg text-xs"
                  >
                    {month}월
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
            <div className="mb-1 flex items-center gap-1">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">난이도</p>
              <div className="group relative inline-flex">
                <button
                  type="button"
                  aria-label={DIFFICULTY_CRITERIA_TEXT}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500 focus-visible:bg-gray-100 focus-visible:text-gray-500 focus-visible:outline-none"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
                <div className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-[280px] -translate-x-1/2 rounded-xl border border-gray-100 bg-white p-3 text-left shadow-[0px_12px_36px_rgba(0,75,198,0.12)] group-hover:block group-focus-within:block">
                  <p className="mb-2 text-[11px] font-semibold text-gray-500">메가스터디 정답률 기준</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {DIFFICULTY_CRITERIA.map(([level, range]) => {
                      const s = DIFFICULTY_STYLE[level]
                      return (
                        <span
                          key={level}
                          className={`inline-flex items-center justify-between gap-2 rounded-full px-2 py-1 text-[10px] font-medium ${s.bg} ${s.text}`}
                        >
                          <span>{level}</span>
                          <span className="font-normal opacity-75">{range}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
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
                    onToggleSelect={toggleSelect}
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
