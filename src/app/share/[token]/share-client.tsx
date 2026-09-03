'use client'

// 학생·학부모 공유 리포트의 셸.
// 데이터 로딩 · 공통 상태 · 헤더/탭바/기간 시트만 담당하고, 화면은 tabs/* 가 그린다.
// 파생 데이터 계산은 use-share-model.ts 로 빠져 있다.
//
// 디자인 원본: 학습 리포트 디자인 벤치마킹/design_handoff_share_report/README.md
// 이 화면은 라이트 기준이다 (다크 매핑은 범위 밖).

import { use, useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, History, Home, Languages, PieChart } from 'lucide-react'
import { ShareData, TabId } from './share-types'
import { INITIAL_VOCAB_FILTER, VocabFilterState, VocabStudyMode } from './share-utils'
import { PRESS, T } from './share-tokens'
import { useShareModel } from './use-share-model'
import { DrawerTag, TagDrawer } from './tag-drawer'
import { HomeTab } from './tabs/home-tab'
import { ScoreTab } from './tabs/score-tab'
import { AnalysisTab } from './tabs/analysis-tab'
import { VocabTab } from './tabs/vocab-tab'
import { WrongNoteSubTab, WrongNoteTab } from './tabs/wrongnote-tab'

const TABS = [
  { id: 'home' as TabId, label: '홈', Icon: Home },
  { id: 'score' as TabId, label: '기록', Icon: History },
  { id: 'analysis' as TabId, label: '분석', Icon: PieChart },
  { id: 'wrongnote' as TabId, label: '오답', Icon: BookOpen },
  { id: 'vocab' as TabId, label: '단어', Icon: Languages },
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

/** "06.28 ~ 진행 중" */
function fmtPeriodRange(start: string, end: string | null) {
  const dot = (d: string) => d.slice(5).replace('-', '.')
  return `${dot(start)} ~ ${end ? dot(end) : '진행 중'}`
}

export default function ShareClient({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedPeriodId = searchParams.get('periodId')
  const { data, isLoading, error } = useShareData(token, selectedPeriodId)

  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false)
  const [drawerTag, setDrawerTag] = useState<DrawerTag | null>(null)

  const [wrongNoteTab, setWrongNoteTab] = useState<WrongNoteSubTab>('reading')
  const [expandedWrongWeekIds, setExpandedWrongWeekIds] = useState<Set<string>>(new Set())
  const [expandedVocabWeekIds, setExpandedVocabWeekIds] = useState<Set<string>>(new Set())
  const [vocabFilter, setVocabFilter] = useState<VocabFilterState>(INITIAL_VOCAB_FILTER)

  const model = useShareModel(data)
  const { wrongNoteGroups, vocabWrongGroups, studentAnswers, weekNumberByWeekId, weekLabelByWeekId, periodOptions } = model

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

  /** 오답노트 → 단어장. 목록 탐색은 단어 탭이 전담한다 */
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

  /** 홈 그래프 점 → 기록 탭 해당 회차 */
  const openHistoryWeek = useCallback((weekId: string) => {
    setActiveTab('score')
    scrollTo(`history-${weekId}`, 150)
  }, [scrollTo])

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
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
    </div>
  )
  if (error || !data) {
    const { title, hint } = shareErrorMessage(error?.status)
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-8">
        <div className="max-w-xs text-center">
          <p className="text-[16px] font-extrabold text-[#191F28]">{title}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#8B95A1]">{hint}</p>
        </div>
      </div>
    )
  }

  const { student, currentPeriod } = data
  const selectedPeriod = selectedPeriodId ? periodOptions.find((p) => p.id === selectedPeriodId) : null
  const periodLabel = selectedPeriod?.label ?? currentPeriod?.label ?? '전체'
  const className = selectedPeriod?.class_name ?? model.classes[0]?.name ?? ''
  const headerLine = [student.grade, student.school, className].filter(Boolean).join(' · ')
  const activeIndex = TABS.findIndex((t) => t.id === activeTab)

  const selectPeriod = (id: string | null) => {
    router.push(id ? `/share/${token}?periodId=${id}` : `/share/${token}`)
    setPeriodSheetOpen(false)
    // 기간이 바뀌면 펼침 상태·스크롤을 초기화한다 — 회차 목록 자체가 달라지기 때문
    setExpandedWrongWeekIds(new Set())
    setExpandedVocabWeekIds(new Set())
    setAutoExpandedReading(null)
    setAutoExpandedVocab(null)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="relative mx-auto min-h-screen max-w-[430px] bg-white pb-[92px] text-[#191F28]">

      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-3 px-5 pt-[18px] pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium text-[#8B95A1]">{headerLine || '학습 리포트'}</span>
          <span className="text-[20px] font-extrabold tracking-[-0.01em]">{student.name}</span>
        </div>
        {periodOptions.length > 1 && (
          <button
            type="button"
            onClick={() => setPeriodSheetOpen(true)}
            className={`${PRESS} flex shrink-0 items-center gap-1.5 rounded-full bg-[#F2F4F6] py-2 pr-3 pl-3.5 text-[13px] font-extrabold`}
          >
            <span className="max-w-[110px] truncate">{periodLabel}</span>
            <span className="text-[10px] text-[#8B95A1]">▾</span>
          </button>
        )}
      </header>

      {/* ── 탭 콘텐츠 ─────────────────────────────────────────────── */}
      <main className="flex flex-col gap-3 px-4 pt-2">
        {activeTab === 'home' && (
          <HomeTab
            model={model}
            periodLabel={periodLabel}
            onOpenWrongNote={(kind) => openWrongNote(kind)}
            onGoHistoryWeek={openHistoryWeek}
            onGoHistory={() => { setActiveTab('score'); window.scrollTo({ top: 0 }) }}
          />
        )}

        {activeTab === 'score' && (
          <ScoreTab
            token={token}
            model={model}
            periodLabel={periodLabel}
            selectedPeriodId={selectedPeriodId}
            hasOtherPeriods={periodOptions.length > 1}
            onOpenWrongNoteWeek={(kind, weekId) => openWrongNote(kind, weekId)}
          />
        )}

        {activeTab === 'analysis' && (
          <AnalysisTab model={model} periodLabel={periodLabel} onTagClick={openDrawerTag} />
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

        {activeTab === 'vocab' && (
          <VocabTab
            model={model}
            filter={vocabFilter}
            onFilterChange={patchVocabFilter}
            onResetFilters={resetVocabFilters}
          />
        )}
      </main>

      {/* ── 하단 탭바 ─────────────────────────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-[#EEF1F4] bg-white">
        {/* 인디케이터 하나가 탭 사이를 미끄러진다 */}
        <span
          aria-hidden
          className="absolute top-0 h-[3px] w-[22px] rounded-full bg-[#3182F6] transition-[left] duration-[280ms] ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ left: `calc(${activeIndex * 20}% + 10% - 11px)` }}
        />
        <div className="flex pb-safe">
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => { setActiveTab(id); window.scrollTo({ top: 0 }) }}
                className="flex flex-1 flex-col items-center gap-1 pt-3 pb-2.5 transition-transform duration-[120ms] active:scale-[0.92]"
                style={{ color: active ? T.blue : T.muted2 }}
              >
                <Icon className="h-5 w-5" />
                <span className={`text-[10px] ${active ? 'font-extrabold' : 'font-medium'}`}>{label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── 기간 선택 바텀시트 ─────────────────────────────────────── */}
      {periodSheetOpen && (
        <div
          role="presentation"
          onClick={() => setPeriodSheetOpen(false)}
          className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(25,31,40,0.5)]"
          style={{ animation: 'share-fade-in .2s ease both' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="기간 선택"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] w-full max-w-[430px] overflow-y-auto rounded-t-[20px] bg-[#F9FAFB] px-4 pt-3.5 pb-7"
            style={{ animation: 'share-sheet-up .42s cubic-bezier(.22,.9,.3,1) both' }}
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-[#E5E8EB]" />
            <span className="block px-1.5 pb-3 text-[16px] font-extrabold">기간 선택</span>
            <div className="flex flex-col gap-1.5">
              {periodOptions.map((period) => {
                const active = selectedPeriodId ? selectedPeriodId === period.id : period.id === currentPeriod?.id
                // 회차가 없는 기간은 열어봐야 빈 화면이라 고를 수 없게 둔다
                const empty = (period.week_count ?? 0) === 0
                return (
                  <button
                    key={period.id}
                    type="button"
                    disabled={empty}
                    onClick={() => selectPeriod(period.id)}
                    className={`${PRESS} flex items-center gap-3 rounded-[18px] px-4 py-3.5 text-left disabled:cursor-default`}
                    style={{ background: active ? T.blueBg : T.canvas }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="truncate text-[15px] font-extrabold"
                          style={{ color: empty ? T.disabled : active ? T.blue : T.ink }}
                        >
                          {period.class_name ? `${period.class_name} · ${period.label}` : period.label}
                        </span>
                        {period.is_current && (
                          <span className="shrink-0 rounded-full bg-[#E8F3FF] px-[7px] py-0.5 text-[10px] font-bold text-[#3182F6]">
                            현재
                          </span>
                        )}
                      </span>
                      <span className="text-[12px] text-[#8B95A1]">
                        {fmtPeriodRange(period.start_date, period.end_date)} · {period.week_count ?? 0}회차
                      </span>
                    </span>
                    {active && <span className="text-[14px] text-[#3182F6]">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <TagDrawer
        tag={drawerTag}
        answers={drawerAnswers}
        token={token}
        weekLabelByWeekId={weekLabelByWeekId}
        onClose={() => setDrawerTag(null)}
      />
    </div>
  )
}
