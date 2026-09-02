'use client'

// 학부모 공유 화면의 셸.
// 데이터 로딩 · 공통 상태 · 헤더/탭바/시트만 담당하고, 화면은 tabs/* 가 그린다.
// 파생 데이터 계산은 use-share-model.ts 로 빠져 있다.

import { use, useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  X, Home, BarChart2, PieChart, BookX,
  ChevronDown, CalendarDays, LibraryBig,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ShareData, TabId } from './share-types'
import { ThemeToggle } from './share-components'
import { INITIAL_VOCAB_FILTER, VocabFilterState, VocabStudyMode } from './share-utils'
import { useShareModel } from './use-share-model'
import { DrawerTag, TagDrawer } from './tag-drawer'
import { HomeTab } from './tabs/home-tab'
import { ScoreTab } from './tabs/score-tab'
import { AnalysisTab } from './tabs/analysis-tab'
import { VocabTab } from './tabs/vocab-tab'
import { WrongNoteSubTab, WrongNoteTab } from './tabs/wrongnote-tab'
import { useShareTheme } from './use-share-theme'

const TABS = [
  { id: 'home' as TabId, label: '홈', Icon: Home },
  { id: 'score' as TabId, label: '성적', Icon: BarChart2 },
  { id: 'analysis' as TabId, label: '분석', Icon: PieChart },
  { id: 'vocab' as TabId, label: '단어장', Icon: LibraryBig },
  { id: 'wrongnote' as TabId, label: '오답', Icon: BookX },
]

/** 상태 코드를 살려둬야 "만료된 링크"와 "없는 링크"를 다르게 안내할 수 있다 */
class ShareError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function useShareData(token: string, periodId: string | null) {
  return useQuery<ShareData, ShareError>({
    queryKey: ['share', token, periodId],
    queryFn: async () => {
      const query = periodId ? `?periodId=${encodeURIComponent(periodId)}` : ''
      const res = await fetch(`/api/share/${token}${query}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new ShareError(res.status, body?.error ?? '데이터를 불러올 수 없습니다')
      }
      return res.json()
    },
    retry: false,
  })
}

/** 링크가 안 열릴 때 학부모가 다음에 뭘 해야 할지까지 알려준다 */
function shareErrorMessage(status: number | undefined): { title: string; hint: string } {
  if (status === 410) return {
    title: '링크가 만료되었습니다',
    hint: '가장 최근에 받으신 문자의 링크로 접속해 주세요.',
  }
  if (status === 403) return {
    title: '공유가 종료되었습니다',
    hint: '자세한 내용은 선생님께 문의해 주세요.',
  }
  return {
    title: '학생 정보를 찾을 수 없습니다',
    hint: '링크가 잘못되었을 수 있습니다. 문자의 링크를 다시 확인해 주세요.',
  }
}

/** Set 토글 — 주차 아코디언용 */
function toggleInSet(set: Set<string>, id: string) {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export default function ShareClient({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedPeriodId = searchParams.get('periodId')
  const { data, isLoading, error } = useShareData(token, selectedPeriodId)
  const { isDark, themeReady, toggleTheme } = useShareTheme()

  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [drawerTag, setDrawerTag] = useState<DrawerTag | null>(null)

  const [wrongNoteTab, setWrongNoteTab] = useState<WrongNoteSubTab>('reading')
  const [expandedWrongWeekIds, setExpandedWrongWeekIds] = useState<Set<string>>(new Set())
  const [expandedVocabWeekIds, setExpandedVocabWeekIds] = useState<Set<string>>(new Set())
  const [vocabFilter, setVocabFilter] = useState<VocabFilterState>(INITIAL_VOCAB_FILTER)

  const model = useShareModel(data)
  const { wrongNoteGroups, vocabWrongGroups, studentAnswers, weekNumberByWeekId, weekLabelByWeekId, periodGroups, periodOptions } = model

  // ── 오답노트 최신 주차 자동 펼침 ──────────────────────────────────────────
  // 탭에 들어오자마자 주차 헤더만 보이던 문제. sentinel 로 두고 렌더 중 조정한다
  // (기간을 바꾸면 최신 주차가 달라지므로 그때 한 번 더 펼쳐진다).
  const firstReadingWeekId = wrongNoteGroups[0]?.week.id ?? null
  const [autoExpandedReading, setAutoExpandedReading] = useState<string | null>(null)
  if (firstReadingWeekId && autoExpandedReading !== firstReadingWeekId) {
    setAutoExpandedReading(firstReadingWeekId)
    setExpandedWrongWeekIds((prev) => new Set([...prev, firstReadingWeekId]))
  }
  const firstVocabWeekId = vocabWrongGroups[0]?.week.id ?? null
  const [autoExpandedVocab, setAutoExpandedVocab] = useState<string | null>(null)
  if (firstVocabWeekId && autoExpandedVocab !== firstVocabWeekId) {
    setAutoExpandedVocab(firstVocabWeekId)
    setExpandedVocabWeekIds((prev) => new Set([...prev, firstVocabWeekId]))
  }

  // 대상 요소에 scroll-mt-* 가 걸려 있어 헤더 높이를 여기서 계산하지 않는다
  const scrollTo = useCallback((id: string, delay = 0) => {
    const go = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (delay > 0) setTimeout(go, delay)
    else go()
  }, [])

  const openWrongNote = useCallback((kind: WrongNoteSubTab, weekId?: string) => {
    setActiveTab('wrongnote')
    setWrongNoteTab(kind)
    const targetId = weekId ?? (kind === 'reading' ? firstReadingWeekId : firstVocabWeekId)
    if (!targetId) return
    const setExpanded = kind === 'reading' ? setExpandedWrongWeekIds : setExpandedVocabWeekIds
    setExpanded((prev) => new Set([...prev, targetId]))
    scrollTo(`wrongnote-${kind}-${targetId}`, 150)
  }, [firstReadingWeekId, firstVocabWeekId, scrollTo])

  /** 오답노트 → 단어장. 목록 탐색은 단어장 탭이 전담한다 */
  const openVocabList = useCallback((weekId: string | null, studyMode: VocabStudyMode) => {
    setVocabFilter({ ...INITIAL_VOCAB_FILTER, studyMode, week: weekId ?? 'all', lookupOpen: true })
    setActiveTab('vocab')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const patchVocabFilter = useCallback((patch: Partial<VocabFilterState>) => {
    setVocabFilter((prev) => ({ ...prev, ...patch }))
  }, [])

  const resetVocabFilters = useCallback(() => {
    setVocabFilter((prev) => ({ ...INITIAL_VOCAB_FILTER, viewMode: prev.viewMode, lookupOpen: prev.lookupOpen }))
  }, [])

  const openDrawerTag = useCallback((id: string, name: string) => {
    setDrawerTag({ id, name, weekId: null })
  }, [])

  const drawerAnswers = useMemo(() => drawerTag
    ? studentAnswers
      .filter((a) =>
        !a.is_correct &&
        a.exam_question?.exam_question_tag.some((t) => t.concept_tag?.id === drawerTag.id) &&
        (drawerTag.weekId ? a.exam_question?.week_id === drawerTag.weekId : true)
      )
      .sort((a, b) => {
        const wa = weekNumberByWeekId.get(a.exam_question?.week_id ?? '') ?? 0
        const wb = weekNumberByWeekId.get(b.exam_question?.week_id ?? '') ?? 0
        return wb - wa
      })
    : [], [drawerTag, studentAnswers, weekNumberByWeekId])

  if (isLoading) return (
    <div className={themeReady && isDark ? 'dark' : ''}>
      <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] dark:bg-[#0B0F17]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2463EB] border-t-transparent" />
      </div>
    </div>
  )
  if (error || !data) {
    const { title, hint } = shareErrorMessage(error?.status)
    return (
      <div className={themeReady && isDark ? 'dark' : ''}>
        <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] px-8 dark:bg-[#0B0F17]">
          <div className="max-w-xs text-center">
            <p className="text-base font-bold text-[#1A1C1E] dark:text-[#F1F5F9]">{title}</p>
            <p className="mt-2 text-sm leading-relaxed text-[#8B95A1] dark:text-gray-500">{hint}</p>
          </div>
        </div>
      </div>
    )
  }

  const { student, currentPeriod } = data
  const selectedPeriod = selectedPeriodId ? periodOptions.find((p) => p.id === selectedPeriodId) : null
  const currentViewLabel = selectedPeriod
    ? `${selectedPeriod.class_name} · ${selectedPeriod.label}`
    : currentPeriod
      ? currentPeriod.label
      : '현재 기간'

  return (
    <div className={themeReady && isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-[#F5F6F8] dark:bg-[#0B0F17]">

        {/* ── 헤더 ──────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 border-b border-[#E9EBEF] bg-[#F5F6F8]/90 px-4 py-3 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#0B0F17]/90">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <span className="text-sm font-bold text-[#1A1C1E] dark:text-[#F1F5F9]">학습 리포트</span>
            <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
          </div>
        </header>

        {/* ── 탭 콘텐츠 ─────────────────────────────────────────────── */}
        <main className="mx-auto max-w-lg space-y-3 px-4 pt-4 pb-28">
          {periodOptions.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="min-w-0 truncate text-[13px] text-[#8B95A1]">
                {selectedPeriod
                  ? selectedPeriod.is_active_class && selectedPeriod.is_current ? '선택한 반' : '지난 기록'
                  : '현재 기간'}
                <span className="ml-1.5 font-semibold text-[#3F4650] dark:text-[#CBD5E1]">{currentViewLabel}</span>
              </p>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-[#2463EB] active:opacity-70 dark:text-[#3B82F6]"
              >
                반·기간 선택
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {activeTab === 'home' && (
            <HomeTab
              student={student}
              model={model}
              isDark={isDark}
              onOpenWrongNote={(kind) => openWrongNote(kind)}
              onGoScoreSection={(id) => { setActiveTab('score'); scrollTo(id, 120) }}
              onGoAnalysis={() => { setActiveTab('analysis'); window.scrollTo({ top: 0 }) }}
            />
          )}

          {activeTab === 'score' && (
            <ScoreTab
              model={model}
              isDark={isDark}
              onOpenWrongNoteWeek={(kind, weekId) => openWrongNote(kind, weekId)}
            />
          )}

          {activeTab === 'analysis' && (
            <AnalysisTab model={model} isDark={isDark} onTagClick={openDrawerTag} />
          )}

          {activeTab === 'vocab' && (
            <VocabTab
              model={model}
              filter={vocabFilter}
              onFilterChange={patchVocabFilter}
              onResetFilters={resetVocabFilters}
            />
          )}

          {activeTab === 'wrongnote' && (
            <WrongNoteTab
              token={token}
              model={model}
              subTab={wrongNoteTab}
              onSubTabChange={setWrongNoteTab}
              expandedReadingWeekIds={expandedWrongWeekIds}
              onToggleReadingWeek={(id) => setExpandedWrongWeekIds((prev) => toggleInSet(prev, id))}
              expandedVocabWeekIds={expandedVocabWeekIds}
              onToggleVocabWeek={(id) => setExpandedVocabWeekIds((prev) => toggleInSet(prev, id))}
              onOpenVocabList={openVocabList}
              onStartRetake={(weekId) => router.push(`/share/${token}/retake/${weekId}`)}
            />
          )}
        </main>

        {/* ── 하단 탭바 ─────────────────────────────────────────────── */}
        <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-[#E9EBEF] bg-white/95 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#151B26]/95">
          <div className="mx-auto flex max-w-lg pb-safe">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveTab(id)}
                  className={`relative flex flex-1 flex-col items-center gap-1 pt-3 pb-2.5 transition-colors ${
                    active ? 'text-[#2463EB] dark:text-blue-400' : 'text-[#8B95A1] dark:text-gray-500'
                  }`}
                >
                  {active && (
                    <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[#2463EB] dark:bg-blue-400" />
                  )}
                  <Icon className="h-5 w-5" />
                  <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* ── 반·기간 선택 시트 ─────────────────────────────────────── */}
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="bottom" className="mx-auto max-h-[82vh] w-full max-w-lg rounded-t-3xl border-0 bg-white p-0 dark:bg-[#151B26]" showCloseButton={false}>
            <SheetHeader className="px-5 pt-5 pb-3">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-200 dark:bg-white/20" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SheetTitle className="text-base font-bold text-[#1A1C1E] dark:text-[#F1F5F9]">반·기간 선택</SheetTitle>
                  <p className="mt-1 text-xs text-[#8B95A1] dark:text-[#94A3B8]">반과 기간을 선택하면 해당 범위로 다시 계산됩니다</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="닫기"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400 dark:bg-white/[0.06] dark:text-gray-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </SheetHeader>
            <div className="overflow-y-auto px-5 pb-6">
              <button
                type="button"
                onClick={() => { router.push(`/share/${token}`); setHistoryOpen(false) }}
                className={`mb-3 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors ${
                  !selectedPeriodId
                    ? 'bg-blue-50 text-[#2463EB] dark:bg-blue-950/40 dark:text-blue-300'
                    : 'bg-gray-50 text-gray-700 dark:bg-white/[0.05] dark:text-gray-300'
                }`}
              >
                <span>
                  <span className="block text-sm font-bold">현재 반/기간</span>
                  <span className="mt-0.5 block text-xs opacity-70">{currentPeriod?.label ?? '현재 기간'}</span>
                </span>
                <CalendarDays className="h-4 w-4" />
              </button>

              <div className="space-y-4">
                {[...periodGroups.entries()].map(([className, periods]) => (
                  <PeriodGroup
                    key={className}
                    className={className}
                    periods={periods}
                    selectedPeriodId={selectedPeriodId}
                    onSelect={(id) => { router.push(`/share/${token}?periodId=${id}`); setHistoryOpen(false) }}
                  />
                ))}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <TagDrawer
          tag={drawerTag}
          answers={drawerAnswers}
          token={token}
          weekLabelByWeekId={weekLabelByWeekId}
          onClose={() => setDrawerTag(null)}
        />
      </div>
    </div>
  )
}

function PeriodGroup({
  className,
  periods,
  selectedPeriodId,
  onSelect,
}: {
  className: string
  periods: ShareData['periodOptions']
  selectedPeriodId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-[#8B95A1] dark:text-[#94A3B8]">
        {className}
        {periods[0]?.class_type === 'special' && (
          <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold normal-case text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            특강
          </span>
        )}
      </p>
      <div className="space-y-1.5">
        {periods.map((period) => {
          const active = selectedPeriodId === period.id
          return (
            <button
              key={period.id}
              type="button"
              onClick={() => onSelect(period.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${
                active
                  ? 'bg-blue-50 text-[#2463EB] dark:bg-blue-950/40 dark:text-blue-300'
                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{period.label}</span>
                <span className="mt-0.5 block text-xs opacity-70">
                  {period.start_date}{period.end_date ? ` ~ ${period.end_date}` : ' 이후'}
                </span>
              </span>
              {period.is_current && (
                <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-[#2463EB] dark:bg-white/[0.08] dark:text-blue-300">
                  현재
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
