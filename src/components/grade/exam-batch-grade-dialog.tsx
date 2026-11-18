'use client'

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
import { useCaptureRuntime } from './capture-runtime'
import type { ExamOcrResult } from './exam-photo-button'
import { requireExamPhotoPath } from '@/lib/exam-photo'
import { packExamPhotos } from '@/lib/exam-photo-upload'
import { BatchGradePanel } from './batch-grade-panel'
import { duplicateExamStudents, isExamStudentConfirmed } from '@/lib/exam-student-confirmation'

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
  confirmedStudentId: string | null
  confidence: Confidence
  rawName: string | null
  /** 동명이인이라 자동 매칭이 거부된 경우 */
  duplicateName: boolean
  codeMatch?: 'matched' | 'unmatched'
  sheetPage?: number
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

export function ExamBatchGradeDialog({ open, onOpenChange, weekId, students, questionCount, onApplied, onContinue, continueDisabled }: {
  onContinue?: (studentIds: string[]) => Promise<void>
  continueDisabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  weekId: string
  students: Student[]
  /** 채점 대상 문항 수 (무효 제외) — 판독 결과 요약 표시용 */
  questionCount: number
  /** 학생 한 명 판독 완료마다 호출 — 그리드 답안 반영 + 임시저장. 반영된 문항 수를 돌려준다 */
  onApplied: (studentId: string, results: ExamOcrResult[], photoPath: string) => number
}) {
  const { request, compress } = useCaptureRuntime()
  const [phase, setPhase] = useState<Phase>('pick')
  const [items, setItems] = useState<Item[]>([])
  const [captureBusy, setCaptureBusy] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)

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
      setContinueError(null)
    }
  }
  // 언마운트 시 남은 URL 해제 (vocab 다이얼로그와 같은 이유로 ref 경유)
  const itemsRef = useRef<Item[]>([])
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => () => { itemsRef.current.forEach((it) => URL.revokeObjectURL(it.previewUrl)) }, [])


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
      confirmedStudentId: null,
      confidence: 'none',
      rawName: null,
      duplicateName: false,
      status: 'idle',
    }))
    items.forEach(item => URL.revokeObjectURL(item.previewUrl))
    setItems(fresh)
    setPhase('matching')

    // base64 인코딩 + 이름 판독 (병렬)
    await runPool(fresh, CONCURRENCY, async (it) => {
      patch(it.id, { status: 'reading-name' })
      await runOrReport(async () => {
        const { base64: b64, mimeType } = await compress(it.file, { forceJpeg: true })
        patch(it.id, { b64, mimeType })
        const resp = await request(`/api/weeks/${weekId}/vocab-photo-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: b64, mimeType, kind: 'reading' }),
        })
        const data = await resp.json() as { studentId: string | null; rawName: string | null; confidence: Confidence; duplicate?: boolean; codeMatch?: Item['codeMatch']; sheetPage?: number }
        const ok = data.studentId && students.some((s) => s.student_id === data.studentId)
        patch(it.id, {
          studentId: ok ? data.studentId : null,
          confidence: ok ? data.confidence : 'none',
          rawName: data.rawName ?? null,
          duplicateName: data.duplicate ?? false,
          codeMatch: data.codeMatch === 'matched' && !ok ? 'unmatched' : data.codeMatch,
          sheetPage: data.sheetPage,
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

  // 여러 장은 판독 전에 묶고, 결과 화면의 재배정에는 중복 학생 검사를 유지한다.
  const duplicateStudentIds = useMemo(() => phase === 'done' ? duplicateExamStudents(items) : new Set<string>(), [items, phase])

  const readyToRead = items.filter((it) => it.studentId && it.b64)
  const photosByStudent = new Map<string, Item[]>()
  for (const item of readyToRead) {
    const pages = photosByStudent.get(item.studentId!)
    if (pages) pages.push(item)
    else photosByStudent.set(item.studentId!, [item])
  }
  const confirmedCount = items.filter((it) => isExamStudentConfirmed(it, duplicateStudentIds)).length
  const allConfirmed = items.length > 0 && confirmedCount === items.length && readyToRead.length === items.length

  const readOne = useCallback(async (it: Item) => {
    patch(it.id, { status: 'reading', error: undefined })
    await runOrReport(async () => {
      const resp = await request(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: it.b64, mimeType: it.mimeType, studentId: it.studentId }),
      })
      const data = await resp.json()
      if (resp.ok && data.ok) {
        let photoPath: string
        try {
          photoPath = requireExamPhotoPath(weekId, it.studentId!, data.photoPath)
        } catch (error) {
          patch(it.id, { status: 'error', error: error instanceof Error ? error.message : '사진 저장 확인 실패' })
          return
        }
        const applied = onApplied(it.studentId!, data.results as ExamOcrResult[], photoPath)
        patch(it.id, { status: 'done', result: { applied, total: questionCount } })
      } else {
        patch(it.id, { status: 'error', error: data.error ?? 'OCR 실패' })
      }
    }, () => patch(it.id, { status: 'error', error: '네트워크 오류' }))
  }, [weekId, questionCount, onApplied, patch, request])

  async function startReading() {
    if (phase !== 'review' || !allConfirmed) return
    setContinueError(null)
    setPhase('reading')
    try {
      const groups = [...photosByStudent.values()]
      const uploads = await Promise.all(groups.map(async (pages) => {
        const first = pages[0]
        if (pages.length === 1) return first
        const pageNumbers = new Set(pages.map((page) => page.sheetPage))
        const ordered = pageNumbers.size === pages.length && !pageNumbers.has(undefined)
          ? [...pages].sort((a, b) => a.sheetPage! - b.sheetPage!) : pages
        const { base64, mimeType } = await packExamPhotos(ordered.map((page) => ({ base64: page.b64!, mimeType: page.mimeType })))
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        const file = new File([bytes], 'answer-sheet.pdf', { type: mimeType })
        return { ...first, id: `${first.id}:pdf`, b64: base64, mimeType, file, previewUrl: '' }
      }))
      const targets = uploads.map((item) => item.previewUrl ? item : { ...item, previewUrl: URL.createObjectURL(item.file) })
      const targetIds = new Set(targets.map((item) => item.id))
      for (const item of items) if (!targetIds.has(item.id)) URL.revokeObjectURL(item.previewUrl)
      setItems(targets)
      await runPool(targets, CONCURRENCY, readOne)
      setPhase('done')
    } catch (error) {
      setContinueError(error instanceof Error ? error.message : '답안지 파일을 합치지 못했습니다.')
      setPhase('review')
    }
  }

  async function retryFailed() {
    if (!allConfirmed) return
    const failed = items.filter((it) => it.status === 'error' && it.b64 && isExamStudentConfirmed(it, duplicateStudentIds))
    if (failed.length === 0) return
    setPhase('reading')
    await runPool(failed, CONCURRENCY, readOne)
    setPhase('done')
  }

  const doneCount = items.filter((it) => it.status === 'done').length
  const errorCount = items.filter((it) => it.status === 'error').length
  const isBusy = continuing || captureBusy || phase === 'matching' || phase === 'reading'

  /** 닫기 요청 처리 — vocab 다이얼로그와 같은 규칙 */
  function requestClose() {
    if (isBusy) return
    const pendingCount = items.filter((it) => it.status !== 'done').length
    if (items.length > 0 && pendingCount > 0) {
      const msg = phase === 'done'
        ? `인식하지 못한 답안지 ${errorCount}장이 있습니다. 완료된 ${doneCount}명의 답안은 유지됩니다.\n창을 닫으시겠습니까?`
        : `창을 닫으면 답안지 ${items.length}장의 학생 확인이 초기화됩니다.\n닫으시겠습니까?`
      if (!window.confirm(msg)) return
    }
    onOpenChange(false)
  }

  return <BatchGradePanel open={open} kind="exam" draftKey={`exam:${weekId}`} phase={phase === 'reading' ? 'processing' : phase}
    continueDisabled={continueDisabled} continueError={continueError} continuing={continuing}
    onContinue={onContinue ? async () => {
      if (continuing || continueDisabled || errorCount || !doneCount) return
      setContinuing(true)
      setContinueError(null)
      try {
        await onContinue(items.filter(item => item.status === 'done' && item.studentId).map(item => item.studentId!))
        onOpenChange(false)
      } catch (error) {
        setContinueError(error instanceof Error ? error.message : '채점하지 못했습니다. 다시 시도해 주세요.')
      } finally { setContinuing(false) }
    } : undefined}
    items={items.map(item => ({...item, status: item.status === 'reading-name' || item.status === 'idle' ? 'matching' : item.status === 'reading' ? 'processing' : item.status, message: item.error ?? (item.result ? `${item.result.applied}/${item.result.total}문항 반영` : undefined)}))}
    students={students} busy={isBusy || captureBusy} readyCount={photosByStudent.size} duplicateIds={duplicateStudentIds} canStart={allConfirmed}
    onClose={requestClose} onBack={()=>setPhase('pick')} onConfirm={addFiles} onCaptureBusy={setCaptureBusy}
    onConfirmCodeMatches={() => setItems((current) => current.map((item) =>
      item.studentId && item.codeMatch === 'matched' && item.b64 ? { ...item, confirmedStudentId: item.studentId } : item))}
    onAttachPrevious={(id, studentId) => patch(id, { studentId, confirmedStudentId: studentId })}
    onSelect={(id,studentId)=>patch(id,{studentId,confirmedStudentId:null,codeMatch:undefined})} onRemove={removeItem} onStart={startReading} onRetry={retryFailed}
    onConfirmStudent={id=>{ const item=items.find(item=>item.id===id); if ((phase==='review'||phase==='done') && item?.studentId && !duplicateStudentIds.has(item.studentId)) patch(id,{confirmedStudentId:item.studentId}) }}/>
}
