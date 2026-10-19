import type { TabId } from '@/app/share/[token]/share-types'

export type ShareDesignContext = { periodId: string | null; tab: TabId }
export const SHARE_DESIGN_CONTEXT_MESSAGE = 'edunote-share-design-context'
export function parseShareDesignContext(value: unknown): ShareDesignContext | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (message.type !== SHARE_DESIGN_CONTEXT_MESSAGE) return null
  if (message.periodId !== null && (typeof message.periodId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(message.periodId))) return null
  if (!['home', 'score', 'analysis', 'wrongnote', 'vocab'].includes(message.tab as string)) return null
  return { periodId: message.periodId as string | null, tab: message.tab as TabId }
}

/** 저장한 레이아웃 이력. 새 시안은 식별자를 추가하고 frame의 렌더러를 연결한다. */
export const SHARE_DESIGNS = [
  {
    id: 'list', label: '목록 중심', date: '2026.09.29',
    summary: '유형별 오답을 차례로 확인',
    changes: ['복습 제안 뒤에 유형별 오답률 목록', '회차 변화와 영역 요약은 펼쳐 보기'],
  },
  {
    id: 'trend', label: '추이 중심', date: '2026.10.01',
    summary: '유형을 선택해 변화 확인',
    changes: ['복습할 유형 3개와 정답률 선그래프', '검색·상태 필터로 전체 유형 탐색'],
  },
  {
    id: 'latest', label: '보완 중심', date: '2026.10.01',
    summary: '지금 보완할 유형을 먼저 확인',
    changes: ['누적 오답률 막대로 최대 3개 유형 비교', '최근 흐름은 접고 핵심 제안부터 표시'],
  },
] as const

export type ShareDesignId = typeof SHARE_DESIGNS[number]['id']
export function getShareDesign(id: string | null | undefined) {
  return SHARE_DESIGNS.find((design) => design.id === id) ?? SHARE_DESIGNS[2]
}

/** 입력한 링크의 경로만 사용한다. 미리보기는 항상 현재 앱의 API를 조회한다. */
export function parseShareInput(input: string): { token: string; periodId: string | null } | null {
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)) return { token: trimmed, periodId: null }
  try {
    const url = new URL(trimmed, 'http://share.local')
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const match = url.pathname.match(/^\/share\/([a-zA-Z0-9_-]{1,128})\/?$/)
    return match ? { token: match[1], periodId: url.searchParams.get('periodId') } : null
  } catch {
    return null
  }
}

export function shareDesignFrameUrl({ design, scenario, theme, token, periodId, tab }: {
  design: ShareDesignId
  scenario: string
  theme: 'light' | 'dark'
  token?: string
  periodId?: string | null
  tab?: TabId
}) {
  const params = new URLSearchParams({ design, theme })
  if (token) params.set('token', token)
  else params.set('scenario', scenario)
  if (periodId) params.set('periodId', periodId)
  if (tab) params.set('tab', tab)
  return `/dev/share-design/frame?${params.toString()}`
}
