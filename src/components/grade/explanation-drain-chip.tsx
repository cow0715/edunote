'use client'

import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useExamQuestions } from '@/hooks/use-weeks'

/**
 * 해설 미생성 복구 칩 — 업로드 도중 탭이 닫혀 AI 해설 드레인이 끊긴 경우의 진입점.
 * 빈 해설 문항이 있을 때만 나타난다 (조회는 DB 뿐, LLM 0콜). 클릭 시 남은 문항만 이어서 생성.
 */
export function ExplanationDrainChip({ weekId }: { weekId: string }) {
  const { data: questions } = useExamQuestions(weekId)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const qc = useQueryClient()

  const missing = (questions ?? []).filter((question) => !question.explanation?.trim()).length
  if (!missing || (!running && missing === 0)) return null

  async function run() {
    setRunning(true)
    setProgress(0)
    let generated = 0
    let failed = false
    try {
      for (let guard = 0; guard < 20; guard += 1) {
        const response = await fetch(`/api/weeks/${weekId}/explanations-drain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeExisting: false }),
        })
        if (!response.ok) { failed = true; break }
        const drain = await response.json() as { generated?: number; remaining?: number; failed_batches?: number }
        generated += Number(drain.generated ?? 0)
        setProgress(generated)
        if (Number(drain.failed_batches ?? 0) > 0) failed = true
        if (Number(drain.remaining ?? 0) <= 0) break
      }
    } catch {
      failed = true
    }
    setRunning(false)
    qc.invalidateQueries({ queryKey: ['exam-questions', weekId] })
    if (generated > 0) toast.success(`AI 해설 ${generated}문항을 채웠습니다.`)
    if (failed) toast.warning('일부 해설 생성에 실패했습니다. 잠시 후 다시 시도해주세요.')
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      className="mb-3 flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 shadow-[0_6px_20px_rgba(180,120,0,0.08)] transition hover:bg-amber-100 disabled:opacity-70 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15"
    >
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {running
        ? `AI 해설을 채우고 있습니다… (${progress}/${missing}문항)`
        : `해설이 비어 있는 문항 ${missing}건 — 눌러서 AI로 채우기`}
    </button>
  )
}
