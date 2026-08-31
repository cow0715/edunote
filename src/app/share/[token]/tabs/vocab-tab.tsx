'use client'

// 사전학습 단어장 탭. 단어 "목록 탐색"(검색·필터)은 이 탭이 전담한다.
// 오답노트 단어 탭은 재시험 중심으로 두고, 목록을 보고 싶을 때 여기로 넘긴다.

import { useDeferredValue, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Filter, Layers2, List, Search } from 'lucide-react'
import { Card } from '../share-components'
import { VocabStudyWordCard } from '../vocab-word-card'
import { ShareModel } from '../use-share-model'
import {
  VocabExampleFilter,
  VocabFilterState,
  VocabStudyItem,
  VocabWrongFilter,
  countVocabFilters,
  getWeekLabel,
  matchesVocabSearch,
  normalizeVocabText,
} from '../share-utils'

const SELECT_CLASS = 'h-9 w-full rounded-xl bg-gray-50 px-3 text-xs font-semibold text-gray-700 outline-none dark:bg-white/[0.06] dark:text-gray-200'
const SELECT_LABEL_CLASS = 'text-[10px] font-bold text-gray-400 dark:text-gray-500'

export function VocabTab({
  model,
  filter,
  onFilterChange,
  onResetFilters,
}: {
  model: ShareModel
  filter: VocabFilterState
  onFilterChange: (patch: Partial<VocabFilterState>) => void
  onResetFilters: () => void
}) {
  const { vocabStudyGroups, vocabStudyItems, vocabWeekOptions, vocabPassageOptions, vocabPosOptions } = model
  const [expandedWeekIds, setExpandedWeekIds] = useState<Set<string>>(new Set())

  // 검색어 입력은 즉시 반영하고, 1600개 단어 필터링만 지연시킨다
  const deferredSearch = useDeferredValue(filter.search)

  const filteredVocabItems = useMemo(() => {
    const query = normalizeVocabText(deferredSearch)
    return vocabStudyItems.filter((item) => {
      const hasWrong = !!item.wrongAnswer
      const hasExample = !!item.word.example_sentence
      if (filter.studyMode === 'wrong_only' && !hasWrong) return false
      if (filter.studyMode === 'retake_pending' && (!item.wrongAnswer || item.wrongAnswer.retake_is_correct === true)) return false
      if (filter.week !== 'all' && item.week.id !== filter.week) return false
      if (filter.passage !== 'all' && (item.word.passage_label ?? '') !== filter.passage) return false
      if (filter.pos !== 'all' && (item.word.part_of_speech ?? '') !== filter.pos) return false
      if (filter.wrong === 'wrong' && !hasWrong) return false
      if (filter.wrong === 'not_wrong' && hasWrong) return false
      if (filter.example === 'with' && !hasExample) return false
      if (filter.example === 'without' && hasExample) return false
      return matchesVocabSearch(item.word, query)
    })
  }, [vocabStudyItems, deferredSearch, filter.studyMode, filter.week, filter.passage, filter.pos, filter.wrong, filter.example])

  const filteredByWeek = useMemo(() => {
    const map = new Map<string, VocabStudyItem[]>()
    filteredVocabItems.forEach((item) => {
      const list = map.get(item.week.id) ?? []
      list.push(item)
      map.set(item.week.id, list)
    })
    return map
  }, [filteredVocabItems])

  const filteredAllGroups = useMemo(() => vocabStudyGroups
    .map(({ week, words, className }) => ({
      week,
      className,
      totalCount: words.length,
      items: filteredByWeek.get(week.id) ?? [],
    }))
    .filter((group) => group.items.length > 0), [vocabStudyGroups, filteredByWeek])

  // 주차별 보기: 주차 → 지문별 묶음
  const filteredWeeklyGroups = useMemo(() => vocabStudyGroups
    .map(({ week, words, className }) => {
      const items = filteredByWeek.get(week.id) ?? []
      if (items.length === 0) return null
      const byPassage = new Map<string, VocabStudyItem[]>()
      items.forEach((item) => {
        const key = item.word.passage_label ?? ''
        const list = byPassage.get(key) ?? []
        list.push(item)
        byPassage.set(key, list)
      })
      return { week, className, totalCount: words.length, itemCount: items.length, passages: [...byPassage.entries()] }
    })
    .filter((g): g is NonNullable<typeof g> => g !== null), [vocabStudyGroups, filteredByWeek])

  const activeFilterCount = countVocabFilters(filter)
  const hasFilters = activeFilterCount > 0

  if (vocabStudyGroups.length === 0) {
    return (
      <Card title="사전학습 단어장">
        <p className="py-8 text-center text-sm text-[#8B95A1] dark:text-gray-500">아직 공개된 단어장이 없습니다.</p>
      </Card>
    )
  }

  const toggleWeek = (weekId: string) => setExpandedWeekIds((prev) => {
    const next = new Set(prev)
    if (next.has(weekId)) next.delete(weekId)
    else next.add(weekId)
    return next
  })

  return (
    <div className="space-y-4">
      <Card title="사전학습 단어장" subtitle={`${filteredVocabItems.length}/${vocabStudyItems.length}개 표시`}>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onFilterChange({ lookupOpen: !filter.lookupOpen })}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-blue-50/70 dark:bg-white/[0.06] dark:hover:bg-white/[0.09]"
            aria-expanded={filter.lookupOpen}
          >
            <span className="min-w-0">
              <span className="block text-sm font-black text-[#1A1C1E] dark:text-[#F8FAFC]">조회 조건</span>
              <span className="mt-0.5 block text-xs font-semibold text-[#8B95A1] dark:text-[#94A3B8]">
                {hasFilters ? `${activeFilterCount}개 조건 적용 중` : '전체 단어 표시 중'}
              </span>
            </span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#2463EB] shadow-sm dark:bg-[#0F172A] dark:text-blue-300">
              {filter.lookupOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </span>
          </button>

          {filter.lookupOpen && (
            <div className="space-y-3">
              <div className="flex rounded-2xl bg-gray-50 p-1 dark:bg-white/[0.06]">
                {([
                  { id: 'all' as const, label: '전체', Icon: List },
                  { id: 'weekly' as const, label: '주차별', Icon: Layers2 },
                ]).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onFilterChange({ viewMode: id })}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-bold transition-all ${
                      filter.viewMode === id
                        ? 'bg-[#2463EB] text-white shadow-sm dark:bg-[#3B82F6]'
                        : 'text-[#8B95A1] hover:text-[#1A1C1E] dark:text-[#94A3B8] dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300 dark:text-gray-500" />
                <input
                  value={filter.search}
                  onChange={(e) => onFilterChange({ search: e.target.value })}
                  placeholder="단어, 뜻, 유의어, 반의어 검색"
                  className="h-11 w-full rounded-2xl bg-gray-50 pl-9 pr-3 text-sm font-medium text-[#1A1C1E] outline-none transition-colors placeholder:text-gray-300 focus:bg-white focus:ring-2 focus:ring-[#2463EB]/15 dark:bg-white/[0.06] dark:text-white dark:placeholder:text-gray-500 dark:focus:bg-white/[0.08]"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {([
                  { id: 'all' as const, label: '전체 학습' },
                  { id: 'wrong_only' as const, label: '내가 틀린 단어' },
                  { id: 'retake_pending' as const, label: '재시험 남은 단어' },
                ]).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => onFilterChange({ studyMode: mode.id })}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                      filter.studyMode === mode.id
                        ? 'bg-[#2463EB] text-white dark:bg-[#3B82F6]'
                        : 'bg-gray-50 text-[#8B95A1] hover:bg-blue-50 hover:text-[#2463EB] dark:bg-white/[0.06] dark:text-[#94A3B8] dark:hover:bg-blue-950/40 dark:hover:text-blue-300'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className={`flex items-center gap-1 ${SELECT_LABEL_CLASS}`}>
                    <Filter className="h-3 w-3" /> 주차
                  </span>
                  <select value={filter.week} onChange={(e) => onFilterChange({ week: e.target.value })} className={SELECT_CLASS}>
                    <option value="all">전체</option>
                    {vocabWeekOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={SELECT_LABEL_CLASS}>지문</span>
                  <select value={filter.passage} onChange={(e) => onFilterChange({ passage: e.target.value })} className={SELECT_CLASS}>
                    <option value="all">전체</option>
                    {vocabPassageOptions.map((passage) => (
                      <option key={passage} value={passage}>지문 {passage}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={SELECT_LABEL_CLASS}>품사</span>
                  <select value={filter.pos} onChange={(e) => onFilterChange({ pos: e.target.value })} className={SELECT_CLASS}>
                    <option value="all">전체</option>
                    {vocabPosOptions.map((pos) => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={SELECT_LABEL_CLASS}>오답</span>
                  <select
                    value={filter.wrong}
                    onChange={(e) => onFilterChange({ wrong: e.target.value as VocabWrongFilter })}
                    className={SELECT_CLASS}
                  >
                    <option value="all">전체</option>
                    <option value="wrong">오답만</option>
                    <option value="not_wrong">오답 제외</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={SELECT_LABEL_CLASS}>예문</span>
                  <select
                    value={filter.example}
                    onChange={(e) => onFilterChange({ example: e.target.value as VocabExampleFilter })}
                    className={SELECT_CLASS}
                  >
                    <option value="all">전체</option>
                    <option value="with">예문 있음</option>
                    <option value="without">예문 없음</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={onResetFilters}
                    disabled={!hasFilters}
                    className="h-9 w-full rounded-xl bg-gray-900 px-3 text-xs font-bold text-white transition-colors disabled:bg-gray-100 disabled:text-gray-300 dark:bg-white dark:text-gray-900 dark:disabled:bg-white/[0.06] dark:disabled:text-gray-600"
                  >
                    초기화
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {filteredVocabItems.length === 0 ? (
        <Card title="검색 결과">
          <p className="py-8 text-center text-sm text-[#8B95A1] dark:text-gray-500">조건에 맞는 단어가 없습니다.</p>
        </Card>
      ) : filter.viewMode === 'all' ? (
        <Card title="전체 단어" subtitle={`${filteredAllGroups.length}개 주차 · ${filteredVocabItems.length}개`} noPad>
          <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
            {filteredAllGroups.map(({ week, className, totalCount, items }) => {
              const isOpen = expandedWeekIds.has(week.id)
              const wrongCount = items.filter((item) => !!item.wrongAnswer).length
              const exampleCount = items.filter((item) => !!item.word.example_sentence).length
              const previewWords = items.slice(0, 4).map((item) => item.word.english_word).join(', ')

              return (
                <section key={week.id}>
                  <button
                    type="button"
                    onClick={() => toggleWeek(week.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-blue-50/50 dark:hover:bg-white/[0.04]"
                    aria-expanded={isOpen}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-black text-[#1A1C1E] dark:text-[#F8FAFC]">{getWeekLabel(week)}</span>
                        {className && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-white/[0.08] dark:text-slate-300">
                            {className}
                          </span>
                        )}
                        {wrongCount > 0 && (
                          <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-500 dark:bg-rose-950/30 dark:text-rose-300">
                            오답 {wrongCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[#8B95A1] dark:text-gray-500">
                        {items.length}/{totalCount}개 표시{exampleCount > 0 ? ` · 예문 ${exampleCount}` : ''}{previewWords ? ` · ${previewWords}` : ''}
                      </span>
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.08]">
                      {items.map((item) => (
                        <VocabStudyWordCard key={item.word.id} item={item} />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </Card>
      ) : (
        filteredWeeklyGroups.map(({ week, className, totalCount, itemCount, passages }) => (
          <Card
            key={week.id}
            title={`${getWeekLabel(week)} 단어장`}
            subtitle={`${className ? `${className} · ` : ''}${itemCount}/${totalCount}개`}
            noPad
          >
            <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
              {passages.map(([passage, passageItems]) => (
                <div key={passage || 'none'}>
                  {passage && (
                    <div className="bg-blue-50/70 px-5 py-2 text-[11px] font-bold text-[#2463EB] dark:bg-blue-950/30 dark:text-blue-300">
                      지문 {passage}
                    </div>
                  )}
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {passageItems.map((item) => (
                      <VocabStudyWordCard key={item.word.id} item={item} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
