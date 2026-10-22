'use client'

import { BatchGradePanel, type BatchPhotoView } from './batch-grade-panel'

// 일괄 사진 채점 — 학생 수만큼 사진을 한 번에 넣고, 이름 자동 매칭을 확인한 뒤, 병렬로 채점한다.
//
// 흐름:  파일 드롭/선택 → (이름란 판독, 병렬) → 매칭 표에서 확인·수정 → 채점 시작 (병렬) → 진행/결과
// 설계 메모:
// - 채점은 학생당 별도 요청. Vercel Hobby 60초 제한(요청당)을 피하고, 하나 실패해도 나머지는 계속.
// - 이름 매칭은 잘못 매칭보다 미매칭이 낫다 — 자동 매칭은 확신도와 함께 보여주고 반드시 강사가 확인.
// - 같은 학생에 사진 2장이 붙으면 경고 (뒤 사진이 앞 사진 결과를 덮어쓴다).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { formatNumberRanges } from '@/lib/utils'
import { compressImageForUpload } from '@/lib/image-compress'
import type { VocabResult } from './vocab-photo-button'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'grading' | 'done'

type Item = {
  id: string
  file: File
  previewUrl: string
  /** 압축된 base64 + mime (원본이 아니라 압축본을 보낸다) */
  b64: string | null
  mimeType: string
  studentId: string | null
  confidence: Confidence
  rawName: string | null
  status: 'idle' | 'reading' | 'ready' | 'grading' | 'done' | 'error'
  error?: string
  result?: { vocab_correct: number; vocab_total: number; missing: number[] }
}

// 반 정원이 15명 이하라 전 학생 동시 실행 — 학생당 별도 서버 요청이라 서로 안 막힌다.
// LLM 요청 한도에 걸려 개별 실패하면 항목별 오류 + 재시도 버튼으로 복구.
const CONCURRENCY = 15

/** 동시 실행 수를 제한하며 순서대로 작업을 돌린다 */
async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

export function VocabBatchGradeDialog({ open, onOpenChange, weekId, students, onGraded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 학생 한 명 채점 완료마다 호출 — 그리드의 점수 갱신용 */
  onGraded: (studentId: string, vocabCorrect: number, total: number, results: VocabResult[]) => void
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [captureBusy, setCaptureBusy] = useState(false)

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  // 닫힐 때 초기화 — effect 안 setState 대신 렌더 중 조정 (AGENTS.md 패턴).
  // object URL 해제(revokeObjectURL)는 멱등이라 렌더 재실행에도 안전하다.
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (syncedOpen !== open) {
    setSyncedOpen(open)
    if (!open) {
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl))
      setItems([])
      setPhase('pick')
    }
  }
  // 언마운트 시 남은 URL 해제. deps 를 [items] 로 두면 items 가 바뀔 때마다(채점 진행 patch 등)
  // 이전 썸네일 URL 이 해제돼 이미지가 깨진다 → 최신 items 를 ref 로 들고 언마운트 때만 해제
  const itemsRef = useRef<Item[]>([])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)) }, [])

  const presentStudents = useMemo(() => students.filter((s) => s.present), [students])

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (list.length === 0) return
    const fresh: Item[] = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      b64: null,
      mimeType: file.type,
      studentId: null,
      confidence: 'none',
      rawName: null,
      status: 'idle',
    }))
    setItems(fresh)
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading' })
      await runOrReport(async () => {
        // 압축본을 이름 판독·채점 양쪽에 재사용
        const { base64: b64, mimeType } = await compressImageForUpload(it.file)
        patch(it.id, { b64, mimeType })
        const resp = await fetch(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence }
        // 자동 매칭은 present 학생으로만
        const ok = data.studentId && presentStudents.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          status: 'ready',
        })
      }, () => patch(it.id, { status: 'ready', confidence: 'none' }))
    })
    setPhase('review')
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((it) => it.id !== id)
    })
  }

  // 같은 학생에 사진이 2장 이상 붙었는지
  const duplicateStudentIds = useMemo(() => {
    const count = new Map<string, number>()
    for (const it of items) if (it.studentId) count.set(it.studentId, (count.get(it.studentId) ?? 0) + 1)
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [items])

  const readyToGrade = items.filter((it) => it.studentId && it.b64)
  const overwriteCount = readyToGrade.filter((it) => students.find((s) => s.student_id === it.studentId)?.hasExisting).length

  async function startGrading() {
    if (readyToGrade.length === 0 || duplicateStudentIds.size > 0) return
    if (overwriteCount > 0) {
      const ok = window.confirm(`${overwriteCount}명은 이미 채점된 데이터가 있습니다.\n교사 확정(잠금) 항목을 제외한 기존 결과가 덮어씌워집니다.\n계속하시겠습니까?`)
      if (!ok) return
    }
    setPhase('grading')
    await runPool(readyToGrade, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      await runOrReport(async () => {
        const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.mimeType }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total, missing: data.missing_numbers ?? [] } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else {
          patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
        }
      }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
    })
    setPhase('done')
  }

  async function retryFailed() {
    const failed = items.filter((it) => it.status === 'error' && it.studentId && it.b64)
    if (failed.length === 0) return
    setPhase('grading')
    await runPool(failed, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'grading', error: undefined })
      await runOrReport(async () => {
        const resp = await fetch(`/api/weeks/${weekId}/grade-vocab-photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: it.studentId, fileData: it.b64, mimeType: it.mimeType }),
        })
        const data = await resp.json()
        if (data.ok) {
          patch(it.id, { status: 'done', result: { vocab_correct: data.vocab_correct, vocab_total: data.vocab_total, missing: data.missing_numbers ?? [] } })
          onGraded(it.studentId!, data.vocab_correct, data.vocab_total, data.results)
        } else patch(it.id, { status: 'error', error: data.error ?? '채점 실패' })
      }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
    })
    setPhase('done')
  }

  const isBusy = captureBusy || phase === 'matching' || phase === 'grading'

  // Every intake path is now backed by the same local draft; closing keeps the photos.
  function requestClose() {
    if (!isBusy) onOpenChange(false)
  }

  return (
    <BatchGradePanel
      open={open} kind="vocab" draftKey={'vocab:' + weekId}
      phase={phase === 'grading' ? 'processing' : phase}
      items={items.map<BatchPhotoView>((item) => ({ ...item, status: item.status === 'idle' || item.status === 'reading' ? 'matching' : item.status === 'grading' ? 'processing' : item.status, message: item.error ?? (item.result ? `정답 ${item.result.vocab_correct}/${item.result.vocab_total}${item.result.missing.length ? ` · 읽지 못한 문항: ${formatNumberRanges(item.result.missing)}` : ''}` : undefined) }))}
      students={students} busy={isBusy} readyCount={readyToGrade.length} duplicateIds={duplicateStudentIds}
      onClose={requestClose} onBack={() => setPhase('pick')} onConfirm={addFiles} onCaptureBusy={setCaptureBusy}
      onSelect={(id, studentId) => patch(id, { studentId, confidence: studentId ? 'high' : 'none' })}
      onRemove={removeItem} onStart={startGrading} onRetry={retryFailed}
    />
  )
}
