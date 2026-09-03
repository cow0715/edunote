'use client'

// 홈 "기간 요약" 카드의 라인 차트.
//
// 330×130 viewBox 한 장에 격자 3줄 · 영역 채움 · 반 평균 점선 · 회차 점을 그린다.
// Recharts 를 쓰지 않는 이유: 점/라벨을 눌러 기록 탭으로 보내야 하고, draw 모션을
// stroke-dashoffset 으로 직접 제어해야 해서 SVG 를 그대로 다루는 편이 짧다.

import { PRESS, T } from './share-tokens'
import type { SummaryPoint } from './use-share-model'

const W = 330
const H = 130
const PAD_X = 10
const PAD_Y = 12

export function SummaryChart({ points, caption, onSelectWeek }: {
  points: SummaryPoint[]
  caption: string
  onSelectWeek: (weekId: string) => void
}) {
  const x = (i: number) => PAD_X + (points.length === 1 ? (W - PAD_X * 2) / 2 : (i / (points.length - 1)) * (W - PAD_X * 2))
  const y = (rate: number) => PAD_Y + (1 - Math.max(0, Math.min(100, rate)) / 100) * (H - PAD_Y * 2)

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - PAD_Y} L${x(0).toFixed(1)} ${H - PAD_Y} Z`

  const classPoints = points.filter((p) => p.classAvg !== null)
  const classLine = classPoints.length >= 2
    ? points
      .map((p, i) => (p.classAvg === null ? null : `${x(i).toFixed(1)} ${y(p.classAvg).toFixed(1)}`))
      .filter((v): v is string => v !== null)
      .map((v, i) => `${i ? 'L' : 'M'}${v}`)
      .join(' ')
    : null

  const lastIndex = points.length - 1

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        {/* 격자 3줄 */}
        {[0, 50, 100].map((v) => (
          <line key={v} x1={PAD_X} x2={W - PAD_X} y1={y(v)} y2={y(v)} stroke={T.lineStrong} strokeWidth="1" />
        ))}

        {/* 영역 채움 — opacity 가 아니라 fill-opacity 로 애니메이션해야 끝값이 안 덮인다 */}
        <path
          d={area}
          fill={T.blue}
          fillOpacity={0.08}
          style={{ animation: 'share-area-in .8s ease both' }}
        />

        {/* 본선 */}
        <path
          d={line}
          fill="none"
          stroke={T.blue}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          style={{ animation: 'share-draw .8s cubic-bezier(.4,0,.2,1) both' }}
        />

        {/* 반 평균 점선은 본선 위에. 흰 후광을 깔아야 겹쳐도 읽힌다 */}
        {classLine && (
          <>
            <path d={classLine} fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
            <path d={classLine} fill="none" stroke={T.body2} strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />
          </>
        )}

        {/* 회차 점 — 최신만 채움. 등장은 x 위치에 비례해 늦춘다 */}
        {points.map((p, i) => {
          const last = i === lastIndex
          return (
            <circle
              key={p.weekId}
              cx={x(i)}
              cy={y(p.rate)}
              r={last ? 5.5 : 3.5}
              fill={last ? T.blue : '#FFFFFF'}
              stroke={T.blue}
              strokeWidth={last ? 0 : 2}
              style={{
                animation: 'share-fade-in .3s ease both',
                animationDelay: `${points.length > 1 ? (i / lastIndex) * 800 : 0}ms`,
              }}
            />
          )
        })}
      </svg>

      {/* x축 라벨 — 눌러서 기록 탭 해당 회차로 */}
      <div className="mt-1 flex">
        {points.map((p, i) => (
          <button
            key={p.weekId}
            type="button"
            onClick={() => onSelectWeek(p.weekId)}
            className={`${PRESS} flex flex-1 flex-col items-center gap-0.5`}
          >
            <span
              className="text-[12px] font-bold tabular-nums"
              style={{ color: i === lastIndex ? T.blue : T.ink }}
            >
              {p.rate}
            </span>
            <span className="text-[10px] tabular-nums text-[#8B95A1]">{p.date}</span>
          </button>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-[#8B95A1]">{caption}</p>
    </div>
  )
}
