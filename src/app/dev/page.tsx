'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import Link from 'next/link'

const ModelCompare = dynamic(() => import('@/components/dev/model-compare'), { ssr: false })

const ScoreTrendChart  = dynamic(() => import('@/components/share/score-trend-chart').then((m) => m.ScoreTrendChart),  { ssr: false })
const WeeklyBarChart   = dynamic(() => import('@/components/share/weekly-bar-chart').then((m) => m.WeeklyBarChart),    { ssr: false })
const HomeworkBarChart = dynamic(() => import('@/components/share/homework-bar-chart').then((m) => m.HomeworkBarChart), { ssr: false })
const ConceptWeakChart = dynamic(() => import('@/components/share/concept-weak-chart').then((m) => m.ConceptWeakChart), { ssr: false })
const WrongTypePieChart = dynamic(() => import('@/components/share/wrong-type-pie-chart').then((m) => m.WrongTypePieChart), { ssr: false })
const ConceptRadarChart = dynamic(() => import('@/components/share/concept-radar-chart').then((m) => m.ConceptRadarChart), { ssr: false })

// ── 샘플 데이터 ──────────────────────────────────────────────────────────
const TREND_DATA = [
  { label: '1주', readingRate: 60, vocabRate: 70, classReadingRate: 65, classVocabRate: 72 },
  { label: '2주', readingRate: 68, vocabRate: 75, classReadingRate: 66, classVocabRate: 73 },
  { label: '3주', readingRate: 72, vocabRate: 80, classReadingRate: 67, classVocabRate: 74 },
  { label: '4주', readingRate: 78, vocabRate: 85, classReadingRate: 70, classVocabRate: 76 },
  { label: '5주', readingRate: 82, vocabRate: 88, classReadingRate: 72, classVocabRate: 78 },
]
const WEEKLY_DATA = [
  { label: '1주', 단어: 80, 숙제: 90 },
  { label: '2주', 단어: 65, 숙제: 75 },
  { label: '3주', 단어: 90, 숙제: 60 },
  { label: '4주', 단어: 70, 숙제: 85 },
]
const HOMEWORK_DATA = [
  { label: '1주', rate: 90, done: 9,  total: 10 },
  { label: '2주', rate: 60, done: 6,  total: 10 },
  { label: '3주', rate: 40, done: 4,  total: 10 },
  { label: '4주', rate: 80, done: 8,  total: 10 },
  { label: '5주', rate: 70, done: 7,  total: 10 },
]
const WEAK_DATA = [
  { name: '어휘 추론',   rate: 72, wrong: 8,  total: 11 },
  { name: '빈칸 완성',   rate: 65, wrong: 13, total: 20 },
  { name: '주제 파악',   rate: 55, wrong: 11, total: 20 },
  { name: '문법 오류',   rate: 40, wrong: 8,  total: 20 },
  { name: '동의어 찾기', rate: 30, wrong: 6,  total: 20 },
]
const PIE_DATA = [
  { id: '1', name: '어휘 추론',   wrong: 8,  total: 11 },
  { id: '2', name: '빈칸 완성',   wrong: 13, total: 20 },
  { id: '3', name: '주제 파악',   wrong: 11, total: 20 },
  { id: '4', name: '문법 오류',   wrong: 8,  total: 20 },
  { id: '5', name: '동의어 찾기', wrong: 6,  total: 20 },
]
const RADAR_DATA = [
  { name: '어휘',  rate: 82, correct: 9,  total: 11 },
  { name: '독해',  rate: 65, correct: 13, total: 20 },
  { name: '문법',  rate: 50, correct: 5,  total: 10 },
  { name: '듣기',  rate: 90, correct: 18, total: 20 },
  { name: '작문',  rate: 40, correct: 4,  total: 10 },
  { name: '회화',  rate: 75, correct: 15, total: 20 },
]

// ── DB 상태 ──────────────────────────────────────────────────────────────
type DbStatus = { ok: boolean; label: string; url: string; isProd: boolean; userEmail: string | null; tableCount: number | null }

async function fetchDbStatus(): Promise<DbStatus> {
  const supabase = createClient()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const isProd = !url.includes('otlyfjciikngdoazjusq')

  const [{ data: { user } }, { count }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('class').select('*', { count: 'exact', head: true }),
  ])

  return {
    ok: true,
    label: isProd ? '🔴 운영 DB' : '🟢 개발 DB',
    url,
    isProd,
    userEmail: user?.email ?? null,
    tableCount: count,
  }
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  )
}

function Badge({ children, color }: { children: React.ReactNode; color: 'green' | 'red' | 'gray' }) {
  const cls = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    red:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    gray:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }[color]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}

const TABS = ['개발 도구', '모델 비교'] as const
type Tab = (typeof TABS)[number]

export default function DevPage() {
  const [isDark, setIsDark] = useState(false)
  const [db, setDb] = useState<DbStatus | null>(null)
  const [shareToken, setShareToken] = useState('')
  const [previewToken, setPreviewToken] = useState('')
  const [tab, setTab] = useState<Tab>('개발 도구')

  useEffect(() => {
    fetchDbStatus().then(setDb).catch(() => setDb({ ok: false, label: '연결 실패', url: '', isProd: false, userEmail: null, tableCount: null }))
  }, [])

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-background p-6 text-foreground">
        {/* 헤더 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">⚙ 개발자 도구</h1>
            <p className="text-xs text-muted-foreground">개발/운영 환경 확인 · 차트 미리보기 · Share 테스트</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dev/radar-compare" className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">차트 비교 →</Link>
            <button
              onClick={() => setIsDark(!isDark)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              {isDark ? '☀ 라이트' : '☾ 다크'}
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="mb-6 flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                tab === t
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '모델 비교' && <ModelCompare />}

        {tab === '개발 도구' && <div className="grid gap-5 lg:grid-cols-2">

          {/* DB 상태 */}
          <Section title="🗄 DB · 세션 상태">
            {db ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">환경</span>
                  <Badge color={db.isProd ? 'red' : 'green'}>{db.label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">URL</span>
                  <code className="max-w-[240px] truncate text-[11px] text-foreground">{db.url}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">로그인</span>
                  <span className="text-xs font-medium text-foreground">{db.userEmail ?? '미로그인'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">class 테이블</span>
                  <Badge color="gray">{db.tableCount ?? '-'}개</Badge>
                </div>
                {db.isProd && (
                  <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                    ⚠ 운영 DB에 연결되어 있습니다. 데이터 수정 시 주의하세요.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">연결 확인 중...</p>
            )}
          </Section>

          {/* Share 프리뷰 */}
          <Section title="🔗 Share 페이지 프리뷰">
            <div className="flex gap-2">
              <input
                value={shareToken}
                onChange={(e) => setShareToken(e.target.value)}
                placeholder="share 토큰 입력"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={() => setPreviewToken(shareToken.trim())}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
              >
                미리보기
              </button>
              {previewToken && (
                <a
                  href={`/share/${previewToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  새탭 ↗
                </a>
              )}
            </div>
            {previewToken && (
              <div className="mt-3 overflow-hidden rounded-xl border border-border">
                <iframe
                  src={`/share/${previewToken}`}
                  className="h-[320px] w-full"
                  title="share preview"
                />
              </div>
            )}
            {!previewToken && (
              <p className="mt-3 text-center text-xs text-muted-foreground">토큰을 입력하면 여기에 학부모 페이지가 표시됩니다</p>
            )}
          </Section>

          {/* 차트 갤러리 — 스코어 트렌드 */}
          <Section title="📈 성적 추이 (ScoreTrendChart)">
            <ScoreTrendChart data={TREND_DATA} isDark={isDark} />
          </Section>

          {/* 주간 바 */}
          <Section title="📊 주간 성적 (WeeklyBarChart)">
            <WeeklyBarChart data={WEEKLY_DATA} isDark={isDark} />
          </Section>

          {/* 과제 */}
          <Section title="📋 과제 완료율 (HomeworkBarChart)">
            <HomeworkBarChart data={HOMEWORK_DATA} isDark={isDark} />
          </Section>

          {/* 레이더 */}
          <Section title="🕸 영역별 정답률 (ConceptRadarChart)">
            <ConceptRadarChart data={RADAR_DATA} isDark={isDark} />
          </Section>

          {/* 오답 파이 */}
          <Section title="🥧 오답 유형 (WrongTypePieChart)">
            <WrongTypePieChart data={PIE_DATA} isDark={isDark} />
          </Section>

          {/* 취약 유형 */}
          <Section title="📉 취약 유형 (ConceptWeakChart)">
            <ConceptWeakChart data={WEAK_DATA} isDark={isDark} />
          </Section>

        </div>}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">/dev — 개발용 페이지 (프로덕션 배포 시 접근 제한 권장)</p>
      </div>
    </div>
  )
}
