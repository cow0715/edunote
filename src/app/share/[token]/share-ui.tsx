'use client'

// share 리포트 공용 UI 프리미티브.
// 색·간격·모션은 share-tokens.ts 의 토큰만 쓴다. 탭 파일은 여기 있는 것만 조합한다.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { PRESS, PRESS_STRONG, T } from './share-tokens'

// ── 세그먼트 컨트롤 ────────────────────────────────────────────────────────
export function Segmented<V extends string>({ value, options, onChange, size = 'md' }: {
  value: V
  options: { value: V; label: ReactNode }[]
  onChange: (v: V) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-[18px] bg-[#F2F4F6] p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`${PRESS_STRONG} rounded-[14px] font-extrabold transition-colors ${
              size === 'sm' ? 'px-3 py-1.5 text-[11px]' : 'px-3.5 py-2 text-[12px]'
            } ${active ? 'bg-[#3182F6] text-white' : 'text-[#4E5968]'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── 칩 ────────────────────────────────────────────────────────────────────
export function Chip({ children, tone = 'gray', onClick }: {
  children: ReactNode
  tone?: 'gray' | 'blue' | 'red'
  onClick?: () => void
}) {
  const style: CSSProperties =
    tone === 'blue' ? { background: T.blueBg, color: T.blue }
      : tone === 'red' ? { background: T.redBg, color: T.red }
        : { background: T.box, color: T.body2 }
  const cls = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} ${PRESS}`} style={style}>{children}</button>
    : <span className={cls} style={style}>{children}</span>
}

// ── 아코디언 chevron ───────────────────────────────────────────────────────
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 12 12" aria-hidden
      className="shrink-0 transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : undefined, color: T.disabled }}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── countUp ───────────────────────────────────────────────────────────────
/** 숨은 탭·모션 최소화 설정에서는 세지 않고 최종값만 그린다 */
function shouldAnimateCount() {
  if (typeof window === 'undefined') return false
  if (document.visibilityState === 'hidden') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** 0 → value 로 700ms 세는 숫자 (ease-out cubic) */
export function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value)

  // 값이 바뀐 순간 0 으로 되돌리는 건 렌더 중 조정으로 처리한다 (effect 안 setState 금지).
  // sentinel 을 null 로 두는 이유는 AGENTS.md 참고 — 캐시가 찬 채 재마운트돼도 한 번은 돈다.
  const [syncedValue, setSyncedValue] = useState<number | null>(null)
  if (syncedValue !== value) {
    setSyncedValue(value)
    setShown(shouldAnimateCount() ? 0 : value)
  }

  useEffect(() => {
    if (!shouldAnimateCount()) return
    let raf = 0
    const startedAt = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - startedAt) / 700)
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    // rAF 가 안 도는 상황(백그라운드 탭 전환 등)에도 0 에 멈추지 않게 하는 폴백
    const fallback = window.setTimeout(() => setShown(value), 800)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(fallback) }
  }, [value])

  return <>{shown}{suffix}</>
}

// ── 아코디언 행 ────────────────────────────────────────────────────────────
export function AccordionRow({ id, header, open, onToggle, children }: {
  id?: string
  header: ReactNode
  open: boolean
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div id={id} className="scroll-mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`${PRESS} flex w-full items-start gap-3 px-4 py-3.5 text-left`}
      >
        <span className="min-w-0 flex-1">{header}</span>
        <span className="pt-1"><Chevron open={open} /></span>
      </button>
      {open && children && (
        <div className="px-4 pb-4" style={{ animation: 'share-rise .25s cubic-bezier(.2,.8,.2,1) both' }}>
          {children}
        </div>
      )}
    </div>
  )
}
