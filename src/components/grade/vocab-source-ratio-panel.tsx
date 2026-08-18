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

// 출제 비율 패널. 유형이 5개라 카드+슬라이더 대신
// 한 줄 분포 바 + 유형별 % 입력의 컴팩트 레이아웃을 쓴다.

const SOURCE_BAR_COLORS: Record<VocabRatioSource, string> = {
  word: 'bg-blue-600',
  synonym: 'bg-sky-400',
  antonym: 'bg-amber-400',
  derivative: 'bg-violet-400',
  example_meaning: 'bg-emerald-500',
  example: 'bg-rose-400',
  example_choice: 'bg-teal-500',
}

export function VocabSourceRatioPanel({
  ratio,
  targets,
  onChangeRatio,
  onSelectPreset,
}: {
  ratio: VocabSourceRatio
  /** 현재 문항 수 기준 예상 배분 (allocatePromptTargets 결과) */
  targets: VocabSourceRatio
  onChangeRatio: (source: VocabRatioSource, value: number) => void
  onSelectPreset: (ratio: VocabSourceRatio) => void
}) {
  return (
    <div className="border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-xs font-bold text-gray-800">출제 비율</span>
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
        {RATIO_SOURCES.map((source) => (
          <label
            key={source}
            className={`min-w-0 rounded-lg border px-2 py-1.5 ${
              ratio[source] > 0 ? 'border-gray-200 bg-white' : 'border-transparent bg-gray-50'
            }`}
          >
            <span className="flex items-center justify-between gap-1.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_BAR_COLORS[source]} ${ratio[source] === 0 ? 'opacity-30' : ''}`} />
                <span className={`text-[11px] font-bold ${ratio[source] > 0 ? 'text-gray-700' : 'text-gray-400'}`}>
                  {ratioSourceLabel(source)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={ratio[source]}
                  onChange={(e) => onChangeRatio(source, Number(e.target.value))}
                  className="h-6 w-11 px-1 text-center text-[11px] font-bold"
                />
                <span className="text-[10px] font-semibold text-gray-400">%</span>
              </span>
            </span>
            <span className={`mt-0.5 block pl-3.5 text-[10px] font-semibold ${ratio[source] > 0 ? 'text-gray-400' : 'text-gray-300'}`}>
              예상 {targets[source]}문항
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
