'use client'

import { SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  RATIO_SOURCES,
  SOURCE_RATIO_PRESETS,
  VocabRatioSource,
  VocabSourceRatio,
  ratioSourceLabel,
} from '@/lib/vocab-test-ratio'

// 출제 비율 패널. 유형이 7개라 카드+슬라이더 대신
// 한 줄 분포 바 + 유형별 % 입력의 컴팩트 레이아웃을 쓴다.
// 후보가 없는 유형(예: 예문 생성 전의 예문 유형)은 잠그고 이유를 적는다 — 아니면 % 를 써 놓고 조용히 원본으로 채워진다.

const SOURCE_BAR_COLORS: Record<VocabRatioSource, string> = {
  word: 'bg-blue-600',
  synonym: 'bg-sky-400',
  antonym: 'bg-amber-400',
  derivative: 'bg-violet-400',
  example_meaning: 'bg-emerald-500',
  example: 'bg-rose-400',
  example_choice: 'bg-teal-500',
}

const EXAMPLE_SOURCES: VocabRatioSource[] = ['example_meaning', 'example', 'example_choice']

export function VocabSourceRatioPanel({
  ratio,
  targets,
  candidateCounts,
  onChangeRatio,
  onSelectPreset,
}: {
  /** 실효 비율 (후보 없는 유형은 0으로 접힌 값) */
  ratio: VocabSourceRatio
  /** 현재 문항 수 기준 예상 배분 (allocatePromptTargets 결과) */
  targets: VocabSourceRatio
  /** 유형별 출제 가능한 단어 수. 없으면(undefined) 전부 가능으로 본다 */
  candidateCounts?: Partial<Record<VocabRatioSource, number>>
  onChangeRatio: (source: VocabRatioSource, value: number) => void
  onSelectPreset: (ratio: VocabSourceRatio) => void
}) {
  const isAvailable = (source: VocabRatioSource) => !candidateCounts || (candidateCounts[source] ?? 0) > 0
  const unavailableReason = (source: VocabRatioSource) =>
    EXAMPLE_SOURCES.includes(source) ? '예문 생성 필요' : '후보 없음'

  return (
    <div className="border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-bold text-gray-800">출제 비율</span>
          <span className="text-[10px] text-gray-400">랜덤 출제에만 쓰입니다</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {SOURCE_RATIO_PRESETS.map((preset) => {
            const active = RATIO_SOURCES.every((source) => ratio[source] === preset.ratio[source])
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => onSelectPreset(preset.ratio)}
                className={`rounded-full px-2 py-1 text-[11px] font-bold transition-colors ${
                  active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        {RATIO_SOURCES.filter((source) => ratio[source] > 0).map((source) => (
          <div
            key={source}
            className={`${SOURCE_BAR_COLORS[source]} transition-all`}
            style={{ width: `${ratio[source]}%` }}
            title={`${ratioSourceLabel(source)} ${ratio[source]}%`}
          />
        ))}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {RATIO_SOURCES.map((source) => {
          const available = isAvailable(source)
          const on = available && ratio[source] > 0
          return (
            <label
              key={source}
              title={available ? undefined : `${ratioSourceLabel(source)} — ${unavailableReason(source)}`}
              className={`min-w-0 rounded-lg border px-2 py-1.5 ${
                on ? 'border-gray-200 bg-white' : 'border-transparent bg-gray-50'
              } ${available ? '' : 'opacity-60'}`}
            >
              <span className="flex items-center justify-between gap-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_BAR_COLORS[source]} ${on ? '' : 'opacity-30'}`} />
                  <span className={`truncate text-[11px] font-bold ${on ? 'text-gray-700' : 'text-gray-400'}`}>
                    {ratioSourceLabel(source)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={available ? ratio[source] : 0}
                    disabled={!available}
                    onChange={(e) => onChangeRatio(source, Number(e.target.value))}
                    className="h-6 w-11 px-1 text-center text-[11px] font-bold disabled:bg-transparent"
                  />
                  <span className="text-[10px] font-semibold text-gray-400">%</span>
                </span>
              </span>
              <span className={`mt-0.5 block truncate pl-3.5 text-[10px] font-semibold ${
                !available ? 'text-amber-600' : on ? 'text-gray-400' : 'text-gray-300'
              }`}>
                {available
                  ? `예상 ${targets[source]}문항${candidateCounts ? ` · 후보 ${candidateCounts[source]}` : ''}`
                  : unavailableReason(source)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
