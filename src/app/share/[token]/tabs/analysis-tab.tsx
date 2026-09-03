'use client'

// 분석 탭 — "영역별 정답률 → 유형별 오답률 → 약점 패턴".
//
// design_handoff_share_report/README.md "3. 분석" 이 원본이다.
// 레이더·도넛을 Recharts 로 그리던 것을 인라인 SVG 로 바꿨다 — 카테고리마다 색을
// 배정하던 팔레트를 없애고 파랑/빨강 두 색만 쓰기 위해서다.

import { useState } from 'react'
import { EmptyNote, Card } from '../share-components'
import { PatternCard } from '../share-pattern'
import { PRESS, T } from '../share-tokens'
import { ShareModel } from '../use-share-model'
import { SMALL_SAMPLE_MAX, sortByWeakness } from '@/lib/wrong-rate'

export function AnalysisTab({
  model,
  periodLabel,
  onTagClick,
}: {
  model: ShareModel
  periodLabel?: string
  onTagClick: (id: string, name: string) => void
}) {
  const { radarData, radarLegend, expandToDomains, typeData, repeatPatterns, scoredWeeks, studentAnswers } = model

  const scope = periodLabel ?? '전체 기간'
  const readingCount = studentAnswers.filter((a) => a.exam_question?.exam_type === 'reading').length
  const allWeekNumbers = scoredWeeks.map((w) => w.week_number)

  return (
    <>
      <div className="px-1.5 pt-1">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">분석</h1>
        <p className="mt-0.5 text-[13px] text-[#8B95A1] tabular-nums">
          {readingCount > 0
            ? `${scope} ${scoredWeeks.length}회차 누적 · ${readingCount}문항`
            : `${scope}엔 진단평가가 없어요`}
        </p>
      </div>

      {radarData.length >= 3 && (
        <Card
          title="영역별 정답률"
          subtitle={expandToDomains ? '수능 유형 영역별 누적' : '카테고리별 누적'}
        >
          <div className="flex items-center gap-4">
            <AreaRadar data={radarData} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {radarLegend.map((d) => <AreaRow key={d.name} item={d} />)}
            </div>
          </div>
        </Card>
      )}

      {typeData.length > 0 && (
        <Card title="유형별 오답률" subtitle={`${scope} 누적 · 탭하면 문제 확인`}>
          <WrongTypeList typeData={typeData} onTagClick={onTagClick} />
        </Card>
      )}

      {repeatPatterns.length > 0 && (
        <Card
          title="약점 패턴"
          subtitle="빨강은 계속 틀리거나 내려가는 유형, 파랑은 올라오는 유형이에요."
        >
          <div className="flex flex-col gap-2">
            {repeatPatterns.map((p) => (
              <PatternCard key={p.id} pattern={p} allWeekNumbers={allWeekNumbers} onTagClick={onTagClick} />
            ))}
          </div>
        </Card>
      )}

      {typeData.length === 0 && repeatPatterns.length === 0 && (
        <EmptyNote
          title="아직 분석할 시험이 부족해요"
          hint="유형이 2회 이상 출제되면 약점 패턴이 여기 표시됩니다."
        />
      )}
    </>
  )
}

// ── 레이더 ─────────────────────────────────────────────────────────────────
const RADAR_W = 170
const RADAR_H = 150

/** 축 개수만큼 꼭짓점을 가지는 다각형 레이더 (기본 3축 삼각형) */
function AreaRadar({ data }: { data: ShareModel['radarData'] }) {
  const cx = RADAR_W / 2
  const cy = RADAR_H / 2 + 4
  const r = Math.min(RADAR_W, RADAR_H) / 2 - 22

  const point = (i: number, ratio: number) => {
    // 첫 축을 12시에 두면 삼각형이 똑바로 선다
    const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2
    return [cx + Math.cos(angle) * r * ratio, cy + Math.sin(angle) * r * ratio] as const
  }
  const polygon = (ratio: number) =>
    data.map((_, i) => point(i, ratio).map((v) => v.toFixed(1)).join(',')).join(' ')

  return (
    <svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`} className="shrink-0" aria-hidden>
      {[0.34, 0.67, 1].map((ratio) => (
        <polygon key={ratio} points={polygon(ratio)} fill="none" stroke={T.lineStrong} strokeWidth="1" />
      ))}
      {data.map((_, i) => {
        const [x, y] = point(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={T.lineStrong} strokeWidth="1" />
      })}
      <polygon
        points={data.map((d, i) => point(i, Math.max(0, Math.min(100, d.rate)) / 100).map((v) => v.toFixed(1)).join(',')).join(' ')}
        fill={T.blue}
        fillOpacity={0.15}
        stroke={T.blue}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const [x, y] = point(i, 1.16)
        return (
          <text
            key={d.name}
            x={x}
            y={y}
            fontSize="9"
            fontWeight="700"
            fill={T.muted2}
            textAnchor={Math.abs(x - cx) < 2 ? 'middle' : x > cx ? 'end' : 'start'}
            dominantBaseline="middle"
          >
            {d.name.length > 6 ? `${d.name.slice(0, 6)}…` : d.name}
          </text>
        )
      })}
    </svg>
  )
}

function AreaRow({ item }: { item: ShareModel['radarLegend'][number] }) {
  const warn = item.rate < 60
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-bold">{item.name}</span>
        <span className="shrink-0 text-[12px] font-extrabold tabular-nums" style={{ color: warn ? T.red : T.ink }}>
          {item.rate}%
        </span>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-[#F2F4F6]">
        <div className="h-full rounded-full" style={{ width: `${item.rate}%`, background: T.blue }} />
      </div>
      {item.tags.length > 0 && (
        <p className="mt-1 truncate text-[10px] text-[#8B95A1]">{item.tags.join(', ')}</p>
      )}
    </div>
  )
}

// ── 유형별 오답률 ──────────────────────────────────────────────────────────
/** 한 학생의 태그가 30개까지 나온다. 다 펼치면 목록이 화면을 잡아먹어 상위만 먼저 보여준다 */
const VISIBLE_TYPE_COUNT = 8

function WrongTypeList({ typeData, onTagClick }: {
  typeData: ShareModel['typeData']
  onTagClick: (id: string, name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sorted = sortByWeakness(typeData)
  const shown = expanded ? sorted : sorted.slice(0, VISIBLE_TYPE_COUNT)

  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((d) => (
        <WrongTypeRow key={d.id} stat={d} onClick={() => onTagClick(d.id, d.name)} />
      ))}
      {sorted.length > VISIBLE_TYPE_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={`${PRESS} mt-1 self-start text-[12px] font-bold text-[#3182F6]`}
        >
          {expanded ? '접기' : `${sorted.length - VISIBLE_TYPE_COUNT}개 더 보기`}
        </button>
      )}
    </div>
  )
}

function WrongTypeRow({ stat, onClick }: {
  stat: { id: string; name: string; wrong: number; total: number }
  onClick: () => void
}) {
  const rate = stat.total > 0 ? Math.round((stat.wrong / stat.total) * 100) : 0
  // 표본이 적은 유형은 오답률이 100% 여도 판단 근거가 못 된다 — 강조하지 않는다
  const small = stat.total <= SMALL_SAMPLE_MAX
  const barColor = !small && rate >= 50 ? T.red : T.disabled

  return (
    <button type="button" onClick={onClick} className={`${PRESS} flex items-center gap-2.5 text-left`}>
      <span className="w-[76px] shrink-0 truncate text-[12px] font-bold">{stat.name}</span>
      <span className="h-[18px] flex-1 overflow-hidden rounded-[4px] bg-[#F2F4F6]">
        <span className="block h-full rounded-[4px]" style={{ width: `${rate}%`, background: barColor }} />
      </span>
      <span className="shrink-0 text-right text-[11px] tabular-nums">
        <strong className="font-extrabold" style={{ color: barColor === T.red ? T.red : T.ink }}>{rate}%</strong>
        <span className="ml-1 text-[#8B95A1]">{stat.wrong}/{stat.total}</span>
      </span>
    </button>
  )
}
