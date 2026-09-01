'use client'

import dynamic from 'next/dynamic'
import { statusColor } from '@/lib/chart-colors'
import { Card } from '../share-components'
import { PatternCard } from '../share-pattern'
import { ShareModel } from '../use-share-model'

const WrongTypeChart = dynamic(
  () => import('@/components/share/wrong-type-chart').then((m) => m.WrongTypeChart),
  { ssr: false }
)
const ConceptRadarChart = dynamic(
  () => import('@/components/share/concept-radar-chart').then((m) => m.ConceptRadarChart),
  { ssr: false }
)

const PATTERN_LEGEND = [
  { label: '고착', accent: '#f43f5e', color: 'text-rose-500 dark:text-rose-400', desc: '반복 출제에도 오답이 지속 — 개념 보완 필요' },
  { label: '악화', accent: '#f97316', color: 'text-orange-500 dark:text-orange-400', desc: '최근으로 갈수록 정답률 하락 추세' },
  { label: '기복', accent: '#a855f7', color: 'text-purple-500 dark:text-purple-400', desc: '맞을 때도 있고 틀릴 때도 있어 불안정' },
  { label: '개선', accent: '#10b981', color: 'text-emerald-500 dark:text-emerald-400', desc: '최근 회차에서 정답률 상승세 확인' },
]

export function AnalysisTab({
  model,
  isDark,
  onTagClick,
}: {
  model: ShareModel
  isDark: boolean
  onTagClick: (id: string, name: string) => void
}) {
  const { radarData, radarLegend, expandToDomains, typeData, repeatPatterns } = model

  return (
    <>
      {radarData.length >= 3 && (
        <Card
          title="영역별 정답률"
          subtitle={expandToDomains ? '수능 유형 영역별 누적 정답률' : '카테고리별 누적 정답률'}
          infoNode={
            <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-white/[0.07]">
              {radarLegend.map((d, i, arr) => (
                <div
                  key={d.name}
                  className={`bg-white px-3 py-2 dark:bg-[#0F172A] ${i < arr.length - 1 ? 'border-b border-gray-100 dark:border-white/[0.06]' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: statusColor(d.rate, isDark) }} />
                    <span className="text-[11px] font-bold text-[#1A1C1E] dark:text-[#F8FAFC]">{d.name}</span>
                  </div>
                  {d.desc && (
                    <p className="mt-1 pl-[11px] text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{d.desc}</p>
                  )}
                  {d.tags.length > 0 && (
                    <p className="mt-0.5 pl-[11px] text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                      출제된 유형 · {d.tags.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          }
        >
          <ConceptRadarChart data={radarData} isDark={isDark} />
        </Card>
      )}

      {typeData.length > 0 && (
        <Card title="유형별 오답률" subtitle="전체 누적 · 탭하면 문제 확인" info="유형마다 출제 수가 달라서, 출제가 적은 유형은 오답률이 100% 여도 아직 판단하기 이릅니다. 순서는 출제 수를 함께 반영해 정합니다.">
          <WrongTypeChart data={typeData} onTagClick={onTagClick} isDark={isDark} />
        </Card>
      )}

      {repeatPatterns.length > 0 && (
        <Card
          title="약점 패턴 분석"
          subtitle="2회 이상 출제된 유형 분석 · 탭하면 문제 확인"
          infoNode={
            <div className="overflow-hidden rounded-lg border border-gray-100 dark:border-white/[0.07]">
              {PATTERN_LEGEND.map(({ label, accent, color, desc }, i, arr) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 bg-white px-3 py-2 dark:bg-[#0F172A] ${i < arr.length - 1 ? 'border-b border-gray-100 dark:border-white/[0.06]' : ''}`}
                >
                  <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: accent }} />
                  <span className={`w-7 shrink-0 text-[11px] font-bold ${color}`}>{label}</span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{desc}</span>
                </div>
              ))}
            </div>
          }
        >
          <div className="space-y-2">
            {repeatPatterns.map((p) => (
              <PatternCard key={p.id} pattern={p} onTagClick={onTagClick} />
            ))}
          </div>
        </Card>
      )}

      {typeData.length === 0 && repeatPatterns.length === 0 && (
        <div className="rounded-3xl bg-white p-10 text-center text-sm text-[#8B95A1] shadow-[0_10px_40px_rgba(0,75,198,0.03)] dark:bg-[#1E293B] dark:text-[#94A3B8] dark:shadow-none">
          분석 데이터가 없습니다
        </div>
      )}
    </>
  )
}
