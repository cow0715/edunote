'use client'

import { BatchGradePanel, type BatchPhotoView } from './batch-grade-panel'

// 진단평가 답안지 일괄 판독 — 반 전체 답안지 사진을 한 번에 넣고, 이름 자동 매칭을 확인한 뒤,
// 병렬로 OCR 해 학생별 답안을 그리드에 채운다 (임시저장까지. AI 채점은 "채점 저장" 한 번으로).
//
// 흐름:  파일 드롭/선택 → (이름란 판독, 병렬) → 매칭 표에서 확인·수정 → 판독 시작 (병렬) → 진행/결과
// 설계 메모 (vocab-batch-grade-dialog 와 동일 패턴):
// - 판독은 학생당 별도 요청. 하나 실패해도 나머지는 계속.
// - 이름 매칭은 잘못 매칭보다 미매칭이 낫다 — 자동 매칭은 반드시 강사가 확인. 동명이인은 서버가
//   자동 매칭을 거부하고 수동 선택을 강제한다.
// - 단어 일괄 채점과 달리 여기선 저장을 확정하지 않는다 — OCR 결과는 손글씨 오독 여지가 있어
//   그리드에 채우고 임시저장까지만. 최종 정오는 "채점 저장"의 코드+AI 채점이 정한다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runOrReport } from '@/lib/async-ui'
import { compressImageForUpload } from '@/lib/image-compress'
import type { ExamOcrResult } from './exam-photo-button'

type Student = { student_id: string; student_name: string; present: boolean; hasExisting: boolean }

type Confidence = 'high' | 'low' | 'none'
type Phase = 'pick' | 'matching' | 'review' | 'reading' | 'done'

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
  /** 동명이인이라 자동 매칭이 거부된 경우 */
  duplicateName: boolean
  status: 'idle' | 'reading-name' | 'ready' | 'reading' | 'done' | 'error'
  error?: string
  result?: { applied: number; total: number }
}

// 반 정원이 15명 이하라 전 학생 동시 실행 — 학생당 별도 서버 요청이라 서로 안 막힌다.
// LLM 요청 한도에 걸려 개별 실패하면 항목별 오류 + 재시도 버튼으로 복구.
const CONCURRENCY = 15

/** 동시 실행 수를 제한하며 순서대로 작업을 돌린다 (worker 는 항목별로 오류를 삼킨다) */
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

export function ExamBatchGradeDialog({ open, onOpenChange, weekId, students, questionCount, onApplied }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 채점 대상 문항 수 (무효 제외) — 판독 결과 요약 표시용 */
  questionCount: number
  /** 학생 한 명 판독 완료마다 호출 — 그리드 답안 반영 + 임시저장. 반영된 문항 수를 돌려준다 */
  onApplied: (studentId: string, results: ExamOcrResult[]) => number
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [captureBusy, setCaptureBusy] = useState(false)

  const patch = useCallback((id: string, changes: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }, [])

  // 닫힐 때 초기화 — effect 안 setState 대신 렌더 중 조정 (AGENTS.md 패턴).
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (syncedOpen !== open) {
    setSyncedOpen(open)
    if (!open) {
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl))
      setItems([])
      setPhase('pick')
    }
  }
  // 언마운트 시 남은 URL 해제 (vocab 다이얼로그와 같은 이유로 ref 경유)
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
      duplicateName: false,
      status: 'idle',
    }))
    setItems(fresh)
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading-name' })
      await runOrReport(async () => {
        const { base64: b64, mimeType } = await compressImageForUpload(it.file)
        patch(it.id, { b64, mimeType })
        const resp = await fetch(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence; duplicate?: boolean }
        const ok = data.studentId && presentStudents.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          duplicateName: data.duplicate ?? false,
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

  const readyToRead = items.filter((it) => it.studentId && it.b64)
  const overwriteCount = readyToRead.filter((it) => students.find((s) => s.student_id === it.studentId)?.hasExisting).length

  const readOne = useCallback(async (it: Item) => {
    patch(it.id, { status: 'reading', error: undefined })
    await runOrReport(async () => {
      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: it.b64, mimeType: it.mimeType, studentId: it.studentId }),
      })
      const data = await resp.json()
      if (resp.ok && data.ok) {
        const applied = onApplied(it.studentId!, data.results as ExamOcrResult[])
        patch(it.id, { status: 'done', result: { applied, total: questionCount } })
      } else {
        patch(it.id, { status: 'error', error: data.error ?? 'OCR 실패' })
      }
    }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
  }, [weekId, questionCount, onApplied, patch])

  async function startReading() {
    if (readyToRead.length === 0 || duplicateStudentIds.size > 0) return
    if (overwriteCount > 0) {
      const ok = window.confirm(`${overwriteCount}명은 이미 입력된 답안이 있습니다.\n판독 결과로 화면의 답안이 덮어씌워집니다 (저장은 "채점 저장" 때 확정).\n계속하시겠습니까?`)
      if (!ok) return
    }
    setPhase('reading')
    await runPool(readyToRead, CONCURRENCY, readOne)
    setPhase('done')
  }

  async function retryFailed() {
    const failed = items.filter((it) => it.status === 'error' && it.studentId && it.b64)
    if (failed.length === 0) return
    setPhase('reading')
    await runPool(failed, CONCURRENCY, readOne)
    setPhase('done')
  }

  const isBusy = captureBusy || phase === 'matching' || phase === 'reading'

  // Every intake path is now backed by the same local draft; closing keeps the photos.
  function requestClose() {
    if (!isBusy) onOpenChange(false)
  }

  return (
    <BatchGradePanel
      open={open} kind="exam" draftKey={'exam:' + weekId}
      phase={phase === 'reading' ? 'processing' : phase}
      items={items.map<BatchPhotoView>((item) => ({ ...item, status: item.status === 'idle' || item.status === 'reading-name' ? 'matching' : item.status === 'reading' ? 'processing' : item.status, message: item.error ?? (item.result ? `판독 ${item.result.applied}/${item.result.total}문항` : undefined) }))}
      students={students} busy={isBusy} readyCount={readyToRead.length} duplicateIds={duplicateStudentIds}
      onClose={requestClose} onBack={() => setPhase('pick')} onConfirm={addFiles} onCaptureBusy={setCaptureBusy}
      onSelect={(id, studentId) => patch(id, { studentId, confidence: studentId ? 'high' : 'none', duplicateName: false })}
      onRemove={removeItem} onStart={startReading} onRetry={retryFailed}
    />
  )
}
