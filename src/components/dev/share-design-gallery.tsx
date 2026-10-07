'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, RotateCcw } from 'lucide-react'
import { SAMPLE_SCENARIOS } from './share-design-samples'
import { getShareDesign, parseShareDesignContext, parseShareInput, SHARE_DESIGNS, shareDesignFrameUrl, type ShareDesignContext, type ShareDesignId } from './share-design-registry'

const CONTROL = 'min-h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function ShareDesignGallery({ embedded = false }: { embedded?: boolean }) {
  const [designId, setDesignId] = useState<ShareDesignId>('latest')
  const [scenario, setScenario] = useState('default')
  const [width, setWidth] = useState(375)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [input, setInput] = useState('')
  const [liveSource, setLiveSource] = useState<{ token: string; periodId: string | null } | null>(null)
  const [inputError, setInputError] = useState('')
  const [revision, setRevision] = useState(0)
  const [frameContext, setFrameContext] = useState<ShareDesignContext>({ periodId: 'semester', tab: 'analysis' })
  const [currentContext, setCurrentContext] = useState(frameContext)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const design = getShareDesign(designId)
  const frameUrl = shareDesignFrameUrl({ design: designId, scenario, theme, token: liveSource?.token, ...frameContext })
  const fullScreenUrl = shareDesignFrameUrl({ design: designId, scenario, theme, token: liveSource?.token, ...currentContext })

  useEffect(() => {
    const receiveContext = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      const context = parseShareDesignContext(event.data)
      if (context) setCurrentContext(context)
    }
    window.addEventListener('message', receiveContext)
    return () => window.removeEventListener('message', receiveContext)
  }, [])

  // 프레임 탐색 때는 재로딩하지 않고, 시안을 바꿀 때만 최근 선택을 새 프레임에 전달한다.
  const keepContext = () => setFrameContext({ ...currentContext })
  const resetContext = (periodId: string | null) => {
    const context: ShareDesignContext = { periodId, tab: 'analysis' }
    setCurrentContext(context)
    setFrameContext(context)
  }

  const loadShare = (event: React.FormEvent) => {
    event.preventDefault()
    const source = parseShareInput(input)
    if (!source) {
      setInputError('학생 공유 링크 또는 공유 토큰을 입력해 주세요.')
      return
    }
    setInputError('')
    setLiveSource(source)
    resetContext(source.periodId)
    setRevision((value) => value + 1)
  }

  return (
    <div className={embedded ? 'text-foreground' : 'min-h-screen bg-background px-4 py-6 text-foreground sm:px-6'}>
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {!embedded && <Link href="/dev" className="mb-2 inline-block text-xs text-muted-foreground hover:text-foreground">← 개발자 도구</Link>}
            <h1 className="text-xl font-bold tracking-tight">Share 디자인 이력</h1>
            <p className="mt-1 text-sm text-muted-foreground">같은 기록으로 시안을 바꾸며 전체 공유 화면을 확인하세요.</p>
          </div>
          {embedded && <Link href="/dev/share-design" target="_blank" rel="noreferrer" className={`${CONTROL} inline-flex items-center gap-1.5`}>넓게 보기 <ArrowUpRight size={15} /></Link>}
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[268px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <fieldset className="rounded-[20px] bg-muted/40 p-3">
              <legend className="px-1 text-xs font-semibold text-muted-foreground">디자인 이력 · 3개</legend>
              <div className="grid gap-2">
                {SHARE_DESIGNS.map((item) => (
                  <label key={item.id} className={`relative flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${designId === item.id ? 'border-foreground/25 bg-background' : 'border-transparent hover:bg-muted/70'}`}>
                    <input type="radio" name="share-design" value={item.id} checked={designId === item.id} onChange={() => { keepContext(); setDesignId(item.id) }} className="sr-only peer" />
                    <span className="min-w-0 flex-1 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
                      <span className="flex items-center gap-2 text-sm font-semibold">{item.label}{item.id === 'latest' && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">현재</span>}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.summary}</span>
                      <span className="mt-1.5 block text-[11px] text-muted-foreground">{item.date}</span>
                    </span>
                    {designId === item.id && <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
                  </label>
                ))}
              </div>
            </fieldset>

            <section className="rounded-[20px] bg-muted/40 p-4">
              <h2 className="mb-3 text-sm font-semibold">확인할 기록</h2>
              <form onSubmit={loadShare} className="space-y-2">
                <label htmlFor="share-design-link" className="block text-xs text-muted-foreground">실제 학생 공유 링크</label>
                <input id="share-design-link" type="text" value={input} onChange={(event) => setInput(event.target.value)} placeholder="공유 링크 또는 토큰" className={`${CONTROL} w-full text-xs`} aria-invalid={Boolean(inputError)} aria-describedby={inputError ? 'share-design-error' : 'share-design-source-hint'} />
                <button type="submit" className="min-h-10 w-full rounded-xl bg-muted px-3 text-xs font-semibold hover:bg-muted/80">학생 기록 불러오기</button>
                {inputError && <p id="share-design-error" role="alert" className="text-xs text-destructive">{inputError}</p>}
                <p id="share-design-source-hint" className="text-[11px] leading-relaxed text-muted-foreground">현재 접속한 앱의 학생 기록을 불러옵니다.</p>
              </form>
              {liveSource ? (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold">실제 학생 기록으로 보는 중</p>
                  <button type="button" onClick={() => { setLiveSource(null); setInputError(''); resetContext('semester') }} className="mt-2 min-h-9 text-xs text-muted-foreground underline underline-offset-4">미리보기 기록으로 돌아가기</button>
                </div>
              ) : (
                <div className="mt-4 border-t border-border pt-3">
                  <label htmlFor="share-design-scenario" className="mb-2 block text-xs text-muted-foreground">학습 상황</label>
                  <select id="share-design-scenario" value={scenario} onChange={(event) => { keepContext(); setScenario(event.target.value) }} className={`${CONTROL} w-full text-xs`}>
                    {SAMPLE_SCENARIOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{SAMPLE_SCENARIOS.find((item) => item.id === scenario)?.description}. 학생·문항은 미리보기 전용 기록입니다.</p>
                </div>
              )}
            </section>

            <section className="px-1 text-xs leading-relaxed text-muted-foreground">
              <h2 className="mb-1.5 font-semibold text-foreground">이 시안에서 바뀐 점</h2>
              <ul className="space-y-1">{design.changes.map((change) => <li key={change}>· {change}</li>)}</ul>
              <p className="mt-3">이력은 분석 레이아웃을 보존합니다. 계산과 나머지 4개 탭은 현재 Share 화면과 같습니다.</p>
            </section>
          </aside>

          <section aria-label="Share 화면 미리보기" className="min-w-0 rounded-[20px] bg-muted/40 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">화면 폭
                  <select aria-label="미리보기 화면 폭" value={width} onChange={(event) => setWidth(Number(event.target.value))} className={`${CONTROL} min-h-9 text-xs`}>
                    {[320, 375, 430].map((value) => <option key={value} value={value}>{value}px</option>)}
                  </select>
                </label>
                <select aria-label="미리보기 화면 모드" value={theme} onChange={(event) => { keepContext(); setTheme(event.target.value as 'light' | 'dark') }} className={`${CONTROL} min-h-9 text-xs`}>
                  <option value="light">라이트</option><option value="dark">다크</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="리포트 처음부터 보기" title="리포트 처음부터 보기" onClick={() => { resetContext(currentContext.periodId); setRevision((value) => value + 1) }} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl hover:bg-muted"><RotateCcw size={15} /></button>
                <a href={fullScreenUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-xl px-2 text-xs hover:bg-muted">화면만 열기 <ArrowUpRight size={14} /></a>
              </div>
            </div>
            <div className="flex justify-center overflow-x-auto">
              <iframe ref={frameRef} key={`${frameUrl}-${revision}`} src={frameUrl} title={`Share ${design.label} 전체 화면`} style={{ width, maxWidth: '100%', height: 'min(760px, calc(100dvh - 260px))', minHeight: 560 }} className="shrink-0 rounded-[18px] border border-border bg-background" />
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">홈 · 기록 · 분석 · 오답 · 단어를 직접 눌러 보세요. 기간 선택과 오답 복습도 연결됩니다.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
