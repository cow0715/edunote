'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import { ShareLoadState, ShareReport, useShareData, type ShareAnalysisRenderProps } from '@/app/share/[token]/share-client'
import type { TabId } from '@/app/share/[token]/share-types'
import { getShareDesign, parseShareDesignContext, SHARE_DESIGN_CONTEXT_MESSAGE, type ShareDesignId } from '@/components/dev/share-design-registry'
import { getShareDesignSample } from '@/components/dev/share-design-samples'
import { ShareAnalysisHistory } from '@/components/dev/share-analysis-versions'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

export default function ShareDesignFrame() {
  const params = useSearchParams()
  const { setTheme } = useTheme()
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const design = getShareDesign(params.get('design')).id
  const token = params.get('token')
  const scenario = params.get('scenario') ?? 'default'
  const periodId = params.get('periodId')
  const initialTab = parseShareDesignContext({ type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId, tab: params.get('tab') })?.tab ?? 'analysis'
  useEffect(() => { setTheme(theme) }, [setTheme, theme])
  return token
    ? <LiveReport key={token} token={token} initialPeriod={periodId} initialTab={initialTab} design={design} />
    : <SampleReport key={scenario} scenario={scenario} initialPeriod={periodId} initialTab={initialTab} design={design} />
}

function historyRenderer(design: ShareDesignId) {
  return design === 'latest' ? undefined : (props: ShareAnalysisRenderProps) => <ShareAnalysisHistory version={design} {...props} />
}

function useReportContext(periodId: string | null, tab: TabId) {
  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId, tab }, window.location.origin)
  }, [periodId, tab])
}

function LiveReport({ token, initialPeriod, initialTab, design }: { token: string; initialPeriod: string | null; initialTab: TabId; design: ShareDesignId }) {
  const router = useRouter()
  const [period, setPeriod] = useState(initialPeriod)
  const [tab, setTab] = useState<TabId>(initialTab)
  useReportContext(period, tab)
  const { data, isLoading, error, refetch, isFetching, isPlaceholderData } = useShareData(token, period)
  if (isLoading || error || !data) return <ShareLoadState loading={isLoading} status={error?.status} retry={() => void refetch()} retrying={isFetching} />
  return <ShareReport data={data} loading={isPlaceholderData} token={token} selectedPeriodId={period} activeTab={tab} onTabChange={setTab} onSelectPeriod={setPeriod} onStartRetake={(weekId) => router.push(`/share/${token}/retake/${weekId}`)} renderAnalysis={historyRenderer(design)} />
}

function SampleReport({ scenario, initialPeriod, initialTab, design }: { scenario: string; initialPeriod: string | null; initialTab: TabId; design: ShareDesignId }) {
  const [period, setPeriod] = useState(initialPeriod ?? 'semester')
  const [tab, setTab] = useState<TabId>(initialTab)
  useReportContext(period, tab)
  const [retakeNotice, setRetakeNotice] = useState(false)
  const data = useMemo(() => getShareDesignSample(period, scenario), [period, scenario])
  const allData = useMemo(() => getShareDesignSample('semester', scenario), [scenario])
  return (
    <>
      <ShareReport data={data} token="share-design-preview" selectedPeriodId={period} activeTab={tab} onTabChange={setTab} onSelectPeriod={(id) => setPeriod(id ?? 'semester')} onStartRetake={() => setRetakeNotice(true)} renderAnalysis={historyRenderer(design)} historyAllData={allData} />
      <Dialog open={retakeNotice} onOpenChange={setRetakeNotice}>
        <DialogContent showCloseButton={false} className="max-w-[calc(100%-2.5rem)] rounded-[20px] border-0 bg-[var(--share-card)] p-5 text-[var(--share-ink)] shadow-none sm:max-w-sm">
          <DialogTitle className="text-base leading-relaxed font-extrabold">재시험은 학생 기록에서 시작해 주세요</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[var(--share-muted)]">지금은 미리보기 전용 기록입니다. 디자인 이력 화면에서 실제 학생 공유 링크를 불러오면 재시험 화면까지 사용할 수 있어요.</DialogDescription>
          <button type="button" onClick={() => setRetakeNotice(false)} className="min-h-11 w-full rounded-xl bg-[var(--share-box)] text-sm font-bold">확인</button>
        </DialogContent>
      </Dialog>
    </>
  )
}
