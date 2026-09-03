'use client'

// 단어 탭 — "단어장".
//
// design_handoff_share_report/README.md "5. 단어" 가 원본이다.
//   · 타이틀 + "N/M개 표시" → 검색 → 필터 칩 → 주차 아코디언.
//   · 프로토타입은 "틀린 단어" 만 있었지만 실제 데이터에는 사전학습 단어장 전체가 있다.
//     그래서 칩으로 오답/재시험/미작성을 좁히고, 주차·지문·품사·예문 같은 세부 조건은
//     "상세 조건" 뒤로 접어 둔다 (README 가 말한 "필터 로직 재사용").

import { useDeferredValue, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card, EmptyNote } from '../share-components'
import { Chevron } from '../share-ui'
import { PRESS, PRESS_ROW, T } from '../share-tokens'
import { VocabStudyWordCard } from '../vocab-word-card'
import { ShareModel } from '../use-share-model'
import {
  VocabExampleFilter,
  VocabFilterState,
  VocabStudyItem,
  VocabStudyMode,
  countVocabFilters,
  fmtShortDate,
  getWeekLabel,
  matchesVocabSearch,
  normalizeVocabText,
} from '../share-utils'

const SELECT_CLASS = 'h-9 w-full rounded-[12px] bg-white px-3 text-[12px] font-bold text-[#4E5968] outline-none'
const SELECT_LABEL_CLASS = 'text-[10px] font-bold text-[#8B95A1]'

const MODE_CHIPS: { id: VocabStudyMode; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'wrong_only', label: '오답' },
  { id: 'retake_pending', label: '재시험 남음' },
  { id: 'unanswered', label: '미작성만' },
]

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
      const wrong = item.wrongAnswer
      const hasExample = !!item.word.example_sentence
      if (filter.studyMode === 'wrong_only' && !wrong) return false
      if (filter.studyMode === 'retake_pending' && (!wrong || wrong.retake_is_correct === true)) return false
      // 미작성 = 오답 중에서도 답을 아예 안 쓴 것. "몰라서 못 쓴 단어" 만 모아 보는 자리다
      if (filter.studyMode === 'unanswered' && (!wrong || !!wrong.student_answer?.trim())) return false
      if (filter.week !== 'all' && item.week.id !== filter.week) return false
      if (filter.passage !== 'all' && (item.word.passage_label ?? '') !== filter.passage) return false
      if (filter.pos !== 'all' && (item.word.part_of_speech ?? '') !== filter.pos) return false
      if (filter.wrong === 'wrong' && !wrong) return false
      if (filter.wrong === 'not_wrong' && wrong) return false
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

  const groups = useMemo(() => vocabStudyGroups
    .map(({ week, words, className }) => ({
      week,
      className,
      totalCount: words.length,
      items: filteredByWeek.get(week.id) ?? [],
    }))
    .filter((group) => group.items.length > 0), [vocabStudyGroups, filteredByWeek])

  const detailFilterCount = countVocabFilters({ ...filter, studyMode: 'all', search: '' })

  if (vocabStudyGroups.length === 0) {
    return <EmptyNote title="이 기간엔 공개된 단어장이 없어요" hint="단어 시험이 등록되면 여기에 표시됩니다." />
  }

  const toggleWeek = (weekId: string) => setExpandedWeekIds((prev) => {
    const next = new Set(prev)
    if (next.has(weekId)) next.delete(weekId)
    else next.add(weekId)
    return next
  })

  return (
    <>
      <div className="px-1.5 pt-1">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">단어장</h1>
        <p className="mt-0.5 text-[13px] text-[#8B95A1] tabular-nums">
          {filteredVocabItems.length}/{vocabStudyItems.length}개 표시
        </p>
      </div>

      {/* 검색 + 칩 */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#B0B8C1]" />
          <input
            value={filter.search}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            placeholder="단어, 뜻, 유의어, 반의어 검색"
            className="h-11 w-full rounded-[18px] bg-[#F2F4F6] pr-3 pl-10 text-[14px] font-medium text-[#191F28] outline-none placeholder:text-[#B0B8C1]"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {MODE_CHIPS.map((mode) => {
            const active = filter.studyMode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange({ studyMode: mode.id })}
                className={`${PRESS} rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors`}
                style={active ? { background: T.blue, color: '#FFFFFF' } : { background: T.box, color: T.body2 }}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 상세 조건 — 주차·지문·품사·예문. 평소엔 접어 둔다 */}
      <Card noPad>
        <button
          type="button"
          onClick={() => onFilterChange({ lookupOpen: !filter.lookupOpen })}
          aria-expanded={filter.lookupOpen}
          className={`${PRESS_ROW} flex w-full items-center justify-between gap-3 px-[18px] py-3.5 text-left`}
        >
          <span className="min-w-0">
            <span className="block text-[14px] font-extrabold">상세 조건</span>
            <span className="mt-0.5 block text-[12px] text-[#8B95A1]">
              {detailFilterCount > 0 ? `${detailFilterCount}개 조건 적용 중` : '주차 · 지문 · 품사 · 예문'}
            </span>
          </span>
          <Chevron open={filter.lookupOpen} />
        </button>

        {filter.lookupOpen && (
          <div className="grid grid-cols-2 gap-2 border-t border-[#EEF1F4] px-[18px] py-4">
            <label className="space-y-1">
              <span className={SELECT_LABEL_CLASS}>주차</span>
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
            <div className="col-span-2">
              <button
                type="button"
                onClick={onResetFilters}
                disabled={countVocabFilters(filter) === 0}
                className={`${PRESS} h-9 w-full rounded-[12px] text-[12px] font-bold text-white disabled:bg-[#D1D6DB]`}
                style={countVocabFilters(filter) === 0 ? undefined : { background: T.ink }}
              >
                초기화
              </button>
            </div>
          </div>
        )}
      </Card>

      {filteredVocabItems.length === 0 ? (
        <EmptyNote
          title={filter.studyMode === 'wrong_only' ? '이 기간엔 틀린 단어가 없어요' : '조건에 맞는 단어가 없어요'}
          hint="검색어나 필터를 바꿔 보세요."
        />
      ) : (
        groups.map(({ week, className, totalCount, items }) => {
          const isOpen = expandedWeekIds.has(week.id)
          const wrongCount = items.filter((item) => !!item.wrongAnswer).length
          const preview = items.slice(0, 3).map((item) => item.word.english_word).join(', ')

          return (
            <Card key={week.id} noPad>
              <button
                type="button"
                onClick={() => toggleWeek(week.id)}
                aria-expanded={isOpen}
                className={`${PRESS_ROW} flex w-full items-center justify-between gap-3 px-[18px] py-3.5 text-left`}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-extrabold">
                      {[className, getWeekLabel(week)].filter(Boolean).join(' ')}
                    </span>
                    {week.start_date && (
                      <span className="text-[12px] text-[#8B95A1]">{fmtShortDate(week.start_date)}</span>
                    )}
                    {wrongCount > 0 && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                        style={{ color: T.red, background: T.redBg }}
                      >
                        오답 {wrongCount}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[12px] text-[#8B95A1]">
                    {items.length}/{totalCount}개{preview ? ` · ${preview}` : ''}
                  </span>
                </span>
                <Chevron open={isOpen} />
              </button>

              {isOpen && (
                <div className="divide-y divide-[#EEF1F4] border-t border-[#EEF1F4]">
                  {items.map((item) => (
                    <VocabStudyWordCard key={item.word.id} item={item} />
                  ))}
                </div>
              )}
            </Card>
          )
        })
      )}

      <p className="px-2 pb-2 text-[11px] leading-relaxed text-[#8B95A1]">
        시험에 나온 단어와 사전학습 단어장을 함께 보여줍니다. 주차·지문·품사는 상세 조건에서 좁힐 수 있어요.
      </p>
    </>
  )
}
