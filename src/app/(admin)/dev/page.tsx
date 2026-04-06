'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, Play, RotateCcw, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── 상수 ──────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', color: 'bg-emerald-500' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', color: 'bg-blue-500' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', color: 'bg-violet-500' },
] as const

type ModelId = (typeof MODELS)[number]['id']

const PRICES: Record<ModelId, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
}

const FUNCTIONS = [
  {
    id: 'parseAnswerSheet',
    label: '해설지 파싱',
    desc: '해설지 PDF/이미지 → 정답·유형 JSON',
    inputType: 'file' as const,
    accept: '.pdf,image/*',
  },
  {
    id: 'parseExamBankPage',
    label: '기출 문제 파싱',
    desc: '수능/모의고사 PDF/이미지 → 문제 JSON',
    inputType: 'file' as const,
    accept: '.pdf,image/*',
  },
  {
    id: 'parseVocabPdf',
    label: '단어장 파싱',
    desc: '단어 PDF/이미지 → 단어 목록 JSON',
    inputType: 'file' as const,
    accept: '.pdf,image/*',
  },
  {
    id: 'gradeVocabItems',
    label: '단어 채점',
    desc: '단어 목록 JSON → 채점 결과',
    inputType: 'json' as const,
    placeholder: `[
  { "number": 1, "english_word": "abandon", "student_answer": "포기하다", "correct_answer": "버리다" },
  { "number": 2, "english_word": "abundant", "student_answer": "풍부한", "correct_answer": "풍부한" }
]`,
  },
]

type FnId = (typeof FUNCTIONS)[number]['id']

const MAX_HISTORY = 30

// ── 타입 ──────────────────────────────────────────────────────────────────

type RunResult = {
  status: 'loading' | 'done' | 'error'
  result?: unknown
  error?: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
}

type HistoryEntry = {
  id: string
  timestamp: number
  fnId: FnId
  fnLabel: string
  fileName?: string
  results: Partial<Record<ModelId, RunResult>>
  note: string
}

// ── 유틸 ──────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const [header, data] = dataUrl.split(',')
      const mimeType = header.match(/:(.*?);/)?.[1] ?? file.type
      resolve({ data, mimeType })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatCost(cost: number | undefined) {
  if (!cost) return '-'
  if (cost < 0.001) return `$${cost.toFixed(6)}`
  return `$${cost.toFixed(4)}`
}

function formatDuration(ms: number | undefined) {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function fetchHistory(): Promise<HistoryEntry[]> {
  const res = await fetch('/api/dev/history')
  if (!res.ok) return []
  const data = await res.json()
  return data.map((row: {
    id: string; created_at: string; fn_id: string; fn_label: string;
    file_name?: string; results: Record<string, RunResult>; note: string
  }) => ({
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    fnId: row.fn_id as FnId,
    fnLabel: row.fn_label,
    fileName: row.file_name,
    results: row.results,
    note: row.note,
  }))
}

async function postHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): Promise<string | null> {
  const res = await fetch('/api/dev/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn_id: entry.fnId, fn_label: entry.fnLabel, file_name: entry.fileName, results: entry.results }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.id
}

async function patchNote(id: string, note: string) {
  await fetch(`/api/dev/history/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  })
}

async function deleteOne(id: string) {
  await fetch(`/api/dev/history/${id}`, { method: 'DELETE' })
}

async function deleteAll() {
  await fetch('/api/dev/history', { method: 'DELETE' })
}

// ── 모델 셀 ──────────────────────────────────────────────────────────────

function ModelCell({ r }: { r: RunResult | undefined }) {
  if (!r) return <span className="text-gray-300 dark:text-slate-600">-</span>
  if (r.status === 'loading') return <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
  if (r.status === 'error') return <XCircle className="h-3 w-3 text-red-400" />
  return (
    <div className="text-right">
      <p className="font-semibold text-blue-600 dark:text-blue-400">{formatCost(r.cost)}</p>
      <p className="text-[10px] text-gray-400">{formatDuration(r.durationMs)}</p>
    </div>
  )
}

// ── 히스토리 행 ──────────────────────────────────────────────────────────

function HistoryRow({
  entry,
  onDelete,
  onNoteChange,
}: {
  entry: HistoryEntry
  onDelete: () => void
  onNoteChange: (note: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal] = useState(entry.note)
  const noteRef = useRef<HTMLInputElement>(null)

  const doneResults = Object.entries(entry.results).filter(([, r]) => r?.status === 'done')

  const commitNote = () => {
    setEditingNote(false)
    onNoteChange(noteVal)
  }

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/5 dark:hover:bg-slate-700/50"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* 시간 */}
        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
          {formatTime(entry.timestamp)}
        </td>
        {/* 함수 */}
        <td className="px-4 py-3">
          <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {entry.fnLabel}
          </span>
        </td>
        {/* 파일명 */}
        <td className="max-w-[120px] truncate px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
          {entry.fileName ?? <span className="text-gray-300">-</span>}
        </td>
        {/* 모델별 비용 */}
        {MODELS.map((m) => (
          <td key={m.id} className="px-4 py-3 text-xs">
            <ModelCell r={entry.results[m.id]} />
          </td>
        ))}
        {/* 메모 */}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {editingNote ? (
            <input
              ref={noteRef}
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => e.key === 'Enter' && commitNote()}
              className="w-full rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs outline-none dark:bg-slate-700 dark:text-white"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setEditingNote(true); setTimeout(() => noteRef.current?.focus(), 0) }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              {entry.note || <span className="text-gray-300 dark:text-slate-600">메모 추가</span>}
              <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
            </button>
          )}
        </td>
        {/* 액션 */}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded((v) => !v)} className="rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <button onClick={onDelete} className="rounded p-1 text-gray-300 hover:text-red-500">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </td>
      </tr>

      {/* 펼쳐진 상세 */}
      {expanded && doneResults.length > 0 && (
        <tr className="border-b border-gray-50 dark:border-white/5">
          <td colSpan={8} className="bg-gray-50/50 px-4 py-3 dark:bg-slate-900/30">
            <div className="grid gap-3 sm:grid-cols-3">
              {MODELS.map((model) => {
                const r = entry.results[model.id]
                if (r?.status !== 'done') return null
                return (
                  <div key={model.id} className="rounded-xl bg-white p-3 dark:bg-slate-800">
                    <div className="mb-2 flex items-center gap-1.5">
                      <span className={cn('h-2 w-2 rounded-full', model.color)} />
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{model.label}</span>
                      <span className="ml-auto text-[10px] text-gray-400">
                        in {r.inputTokens.toLocaleString()} / out {r.outputTokens.toLocaleString()}
                      </span>
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] leading-relaxed text-gray-600 dark:bg-slate-900 dark:text-gray-300">
                      {JSON.stringify(r.result, null, 2)}
                    </pre>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────

export default function DevPage() {
  const [selectedFn, setSelectedFn] = useState<FnId>('parseAnswerSheet')
  const [selectedModels, setSelectedModels] = useState<Set<ModelId>>(
    new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'])
  )
  const [file, setFile] = useState<File | null>(null)
  const [jsonInput, setJsonInput] = useState('')
  const [results, setResults] = useState<Partial<Record<ModelId, RunResult>>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchHistory().then(setHistory)
  }, [])

  const currentFn = FUNCTIONS.find((f) => f.id === selectedFn)!

  const toggleModel = (id: ModelId) => {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }, [])

  const reset = () => {
    setResults({})
    setFile(null)
    setJsonInput('')
  }

  const run = async () => {
    if (selectedModels.size === 0) return
    if (currentFn.inputType === 'file' && !file) return
    if (currentFn.inputType === 'json' && !jsonInput.trim()) return

    setIsRunning(true)

    const loadingState: Partial<Record<ModelId, RunResult>> = {}
    for (const m of selectedModels) {
      loadingState[m] = { status: 'loading', inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 }
    }
    setResults(loadingState)

    let fileData: string | undefined
    let mimeType: string | undefined
    if (currentFn.inputType === 'file' && file) {
      const converted = await fileToBase64(file)
      fileData = converted.data
      mimeType = converted.mimeType
    }

    const finalResults: Partial<Record<ModelId, RunResult>> = {}

    const promises = [...selectedModels].map(async (modelId) => {
      try {
        const res = await fetch('/api/dev/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fn: selectedFn,
            model: modelId,
            fileData,
            mimeType,
            jsonInput: currentFn.inputType === 'json' ? jsonInput : undefined,
          }),
        })
        const json = await res.json()
        const data = json.data ?? json
        const r: RunResult = data.error
          ? { status: 'error', error: data.error, inputTokens: 0, outputTokens: 0, cost: 0, durationMs: data.durationMs ?? 0 }
          : { status: 'done', result: data.result, inputTokens: data.inputTokens, outputTokens: data.outputTokens, cost: data.cost, durationMs: data.durationMs }
        finalResults[modelId] = r
        setResults((prev) => ({ ...prev, [modelId]: r }))
      } catch (e: unknown) {
        const r: RunResult = { status: 'error', error: e instanceof Error ? e.message : '요청 실패', inputTokens: 0, outputTokens: 0, cost: 0, durationMs: 0 }
        finalResults[modelId] = r
        setResults((prev) => ({ ...prev, [modelId]: r }))
      }
    })

    await Promise.all(promises)
    setIsRunning(false)

    // 히스토리 저장 (완료된 결과가 하나라도 있을 때)
    const hasDone = Object.values(finalResults).some((r) => r?.status === 'done')
    if (hasDone) {
      const newId = await postHistory({
        fnId: selectedFn,
        fnLabel: currentFn.label,
        fileName: file?.name,
        results: finalResults,
        note: '',
      })
      if (newId) {
        const entry: HistoryEntry = {
          id: newId,
          timestamp: Date.now(),
          fnId: selectedFn,
          fnLabel: currentFn.label,
          fileName: file?.name,
          results: finalResults,
          note: '',
        }
        setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY))
      }
    }
  }

  const deleteEntry = (id: string) => {
    deleteOne(id)
    setHistory((prev) => prev.filter((e) => e.id !== id))
  }

  const updateNote = (id: string, note: string) => {
    patchNote(id, note)
    setHistory((prev) => prev.map((e) => e.id === id ? { ...e, note } : e))
  }

  const canRun =
    selectedModels.size > 0 &&
    !isRunning &&
    (currentFn.inputType === 'file' ? !!file : !!jsonInput.trim())

  return (
    <div className="min-h-screen p-6" style={{ background: 'linear-gradient(to bottom, #EBF3FF, #FFFFFF)' }}>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* 헤더 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">모델 비교 테스트</h1>
          <p className="mt-1 text-sm text-gray-500">같은 입력으로 모델별 결과와 비용을 비교합니다</p>
        </div>

        {/* 함수 선택 */}
        <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-800">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">API 함수</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FUNCTIONS.map((fn) => (
              <button
                key={fn.id}
                onClick={() => { setSelectedFn(fn.id as FnId); setResults({}) }}
                className={cn(
                  'rounded-xl px-3 py-3 text-left transition-all',
                  selectedFn === fn.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-slate-700 dark:text-gray-200 dark:hover:bg-slate-600'
                )}
              >
                <p className="text-sm font-semibold">{fn.label}</p>
                <p className={cn('mt-0.5 text-[10px] leading-tight', selectedFn === fn.id ? 'text-blue-100' : 'text-gray-400 dark:text-slate-400')}>
                  {fn.desc}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* 입력 + 모델 선택 */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 입력 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-800">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">입력</p>
            {currentFn.inputType === 'file' ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 transition-colors',
                  file
                    ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                    : 'border-gray-200 hover:border-blue-300 dark:border-slate-600 dark:hover:border-blue-600'
                )}
              >
                <Upload className={cn('h-6 w-6', file ? 'text-blue-500' : 'text-gray-300')} />
                {file ? (
                  <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{file.name}</p>
                ) : (
                  <p className="text-sm text-gray-400">PDF 또는 이미지를 드래그하거나 클릭</p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={currentFn.accept}
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                />
              </div>
            ) : (
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder={currentFn.placeholder}
                className="h-48 w-full resize-none rounded-xl bg-gray-50 p-3 font-mono text-xs text-gray-700 outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-700 dark:text-gray-200"
              />
            )}
          </div>

          {/* 모델 선택 */}
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-800">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">모델 선택</p>
            <div className="space-y-2">
              {MODELS.map((model) => {
                const selected = selectedModels.has(model.id)
                return (
                  <button
                    key={model.id}
                    onClick={() => toggleModel(model.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all',
                      selected ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 opacity-50 dark:bg-slate-700'
                    )}
                  >
                    <span className={cn('h-3 w-3 rounded-full', model.color)} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{model.label}</p>
                      <p className="text-[10px] text-gray-400">
                        in ${PRICES[model.id].input} / out ${PRICES[model.id].output} per 1M
                      </p>
                    </div>
                    <div className={cn('h-4 w-4 rounded border-2 transition-colors', selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-slate-500')}>
                      {selected && (
                        <svg viewBox="0 0 12 12" fill="none" className="h-full w-full p-0.5">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={run}
                disabled={!canRun}
                className="flex-1 gap-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:scale-95 disabled:opacity-40"
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                비교 실행
              </Button>
              <Button variant="outline" onClick={reset} disabled={isRunning} className="rounded-xl">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* 현재 실행 결과 (로딩 중에만 표시) */}
        {isRunning && Object.keys(results).length > 0 && (
          <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-slate-800">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">실행 중</p>
            <div className="flex gap-4">
              {MODELS.filter((m) => selectedModels.has(m.id)).map((model) => {
                const r = results[model.id]
                return (
                  <div key={model.id} className="flex items-center gap-2 text-sm">
                    <span className={cn('h-2 w-2 rounded-full', model.color)} />
                    <span className="text-gray-600 dark:text-gray-300">{model.label}</span>
                    {r?.status === 'loading' && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
                    {r?.status === 'done' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                    {r?.status === 'error' && <XCircle className="h-3 w-3 text-red-500" />}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 히스토리 테이블 */}
        {history.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">
                실행 히스토리 ({history.length})
              </p>
              <button
                onClick={() => { deleteAll(); setHistory([]) }}
                className="text-xs text-gray-400 hover:text-red-500"
              >
                전체 삭제
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-50 dark:border-white/5">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">시간</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">함수</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">파일</th>
                    {MODELS.map((m) => (
                      <th key={m.id} className="px-4 py-3 text-right text-xs font-semibold text-gray-400">
                        <div className="flex items-center justify-end gap-1">
                          <span className={cn('h-1.5 w-1.5 rounded-full', m.color)} />
                          {m.label}
                        </div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">메모</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onDelete={() => deleteEntry(entry.id)}
                      onNoteChange={(note) => updateNote(entry.id, note)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
