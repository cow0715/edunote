'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2, CheckCircle2, AlertTriangle, RotateCcw, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQueryClient } from '@tanstack/react-query'

type VocabEntry = {
  number: number
  english_word: string
  correct_answer: string | null
  synonyms: string[]
  antonyms: string[]
}

type Status =
  | { type: 'idle' }
  | { type: 'file-selected'; file: File }
  | { type: 'loading'; step: string }
  | { type: 'preview'; words: VocabEntry[] }
  | { type: 'saving' }
  | { type: 'done'; saved: number }
  | { type: 'error'; message: string }

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function VocabWordSetup({ weekId }: { weekId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [editWords, setEditWords] = useState<VocabEntry[]>([])
  const qc = useQueryClient()

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setStatus({ type: 'file-selected', file })
  }

  async function handleUpload() {
    if (status.type !== 'file-selected') return
    const file = status.file

    setStatus({ type: 'loading', step: 'Claude가 단어를 분석 중...' })
    try {
      const base64 = await readFileAsBase64(file)
      const res = await fetch(`/api/weeks/${weekId}/parse-vocab-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, mimeType: file.type }),
      })
      const data = await res.json()
      if (!res.ok) { setStatus({ type: 'error', message: data.error ?? '파싱 실패' }); return }
      setEditWords(data.words)
      setStatus({ type: 'preview', words: data.words })
    } catch {
      setStatus({ type: 'error', message: '파일 처리 중 오류가 발생했습니다' })
    }
  }

  async function handleSave() {
    setStatus({ type: 'saving' })
    try {
      const res = await fetch(`/api/weeks/${weekId}/vocab-words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: editWords }),
      })
      const data = await res.json()
      if (!res.ok) { setStatus({ type: 'error', message: data.error ?? '저장 실패' }); return }
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      setStatus({ type: 'done', saved: data.saved })
    } catch {
      setStatus({ type: 'error', message: '저장 중 오류가 발생했습니다' })
    }
  }

  function updateWord(index: number, field: keyof VocabEntry, value: string) {
    setEditWords((prev) => prev.map((w, i) => {
      if (i !== index) return w
      if (field === 'synonyms' || field === 'antonyms') {
        return { ...w, [field]: value.split(',').map((s) => s.trim()).filter(Boolean) }
      }
      return { ...w, [field]: value || null }
    }))
  }

  // ── 유휴 상태 ─────────────────────────────────────────────────────────────
  if (status.type === 'idle' || status.type === 'error') return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">단어 시험지 PDF를 업로드하면 Claude가 단어와 뜻을 자동으로 추출합니다.</p>
      <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileSelect} />
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-primary/50 hover:bg-gray-50"
      >
        <Upload className="h-8 w-8 text-gray-300" />
        <p className="text-sm text-gray-400">클릭하여 파일 선택 (PDF / 이미지)</p>
      </div>
      {status.type === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{status.message}</p>
        </div>
      )}
    </div>
  )

  // ── 파일 선택됨 — 등록 버튼 대기 ─────────────────────────────────────────
  if (status.type === 'file-selected') return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">단어 시험지 PDF를 업로드하면 Claude가 단어와 뜻을 자동으로 추출합니다.</p>
      <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileSelect} />
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-primary/50 hover:bg-gray-50"
      >
        <FileText className="h-8 w-8 text-primary" />
        <p className="text-sm font-medium text-gray-700">{status.file.name}</p>
        <p className="text-xs text-gray-400">다른 파일로 변경하려면 클릭</p>
      </div>
      <Button className="w-full" onClick={handleUpload}>
        <Upload className="mr-2 h-4 w-4" />
        등록하기
      </Button>
    </div>
  )

  // ── 로딩 상태 ─────────────────────────────────────────────────────────────
  if (status.type === 'loading') return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8">
        <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-gray-500">{status.step}</p>
      </div>
    </div>
  )

  // ── 저장 완료 ─────────────────────────────────────────────────────────────
  if (status.type === 'done') return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          완료
        </div>
        <p className="text-xs text-green-700">단어 {status.saved}개 저장됨 · 단어시험 총 개수 자동 업데이트</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => setStatus({ type: 'idle' })}
        >
          다른 파일 업로드
        </Button>
      </div>
    </div>
  )

  // ── 저장 중 ───────────────────────────────────────────────────────────────
  if (status.type === 'saving') return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8">
        <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-gray-500">저장 중...</p>
      </div>
    </div>
  )

  // ── 미리보기 (편집 가능) ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{editWords.length}개</span> 단어 추출됨 · 뜻이 틀렸다면 수정 후 저장하세요
        </p>
        <Button variant="outline" size="sm" onClick={() => setStatus({ type: 'idle' })}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          다시 올리기
        </Button>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-[3rem_1fr_1fr_1fr_1fr] gap-0 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-200">
          <span>#</span>
          <span>영단어</span>
          <span>한글 뜻</span>
          <span>유의어</span>
          <span>반의어</span>
        </div>
        <div className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
          {editWords.map((w, i) => (
            <div key={w.number} className="grid grid-cols-[3rem_1fr_1fr_1fr_1fr] items-center gap-2 px-3 py-2">
              <span className="text-xs text-gray-400">{w.number}</span>
              <span className="text-sm font-medium text-gray-800 truncate">{w.english_word}</span>
              <Input
                value={w.correct_answer ?? ''}
                placeholder={w.correct_answer === null ? '선택형' : '뜻 입력'}
                disabled={w.correct_answer === null && w.english_word.includes('/')}
                className="h-7 text-xs px-2"
                onChange={(e) => updateWord(i, 'correct_answer', e.target.value)}
              />
              <Input
                value={w.synonyms.join(', ')}
                placeholder="유의어 (쉼표 구분)"
                className="h-7 text-xs px-2"
                onChange={(e) => updateWord(i, 'synonyms', e.target.value)}
              />
              <Input
                value={w.antonyms.join(', ')}
                placeholder="반의어 (쉼표 구분)"
                className="h-7 text-xs px-2"
                onChange={(e) => updateWord(i, 'antonyms', e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave}>저장</Button>
      </div>
    </div>
  )
}
