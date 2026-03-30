'use client'

import { useRef, useState, useEffect } from 'react'
import { Upload, Loader2, CheckCircle2, AlertTriangle, RotateCcw, FileText, ChevronDown, ChevronUp, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useQueryClient } from '@tanstack/react-query'
import { useUploadStore, VocabEntry } from '@/store/upload-store'
import { usePrompt, useSavePrompt } from '@/hooks/use-prompts'
import { VOCAB_GRADING_RULES } from '@/lib/prompts'

const PROMPT_KEY = 'vocab_grading_rules'

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
  const [file, setFile] = useState<File | null>(null)
  const qc = useQueryClient()

  // 스토어: status + savedWords (로딩 지속 + 재마운트 시 초기화용)
  const vocabState = useUploadStore((s) => s.vocab[weekId])
  const status = vocabState?.status ?? { type: 'idle' }
  const savedWords = vocabState?.savedWords ?? []
  const setVocabStatus = useUploadStore((s) => s.setVocabStatus)
  const setVocabSaved = useUploadStore((s) => s.setVocabSaved)

  // editWords: 로컬 state (키입력 성능용)
  const [editWords, setEditWords] = useState<VocabEntry[]>([])

  // 마운트 시: 스토어에 데이터 있으면 사용, 없으면 DB에서 로드
  useEffect(() => {
    if (savedWords.length > 0) {
      setEditWords(savedWords)
      return
    }
    if (status.type !== 'idle') return

    fetch(`/api/weeks/${weekId}/vocab-words`)
      .then((r) => r.json())
      .then((data: VocabEntry[]) => {
        if (data?.length > 0) {
          setEditWords(data)
          setVocabSaved(weekId, data, { type: 'ready', savedCount: data.length })
        }
      })
      .catch(() => {/* 조회 실패는 무시 */})
  // weekId가 바뀔 때만 재실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekId])

  const isDirty = JSON.stringify(editWords) !== JSON.stringify(savedWords)

  const [promptText, setPromptText] = useState(VOCAB_GRADING_RULES)
  const [promptOpen, setPromptOpen] = useState(false)
  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const savePrompt = useSavePrompt(PROMPT_KEY)

  useEffect(() => { if (savedPrompt) setPromptText(savedPrompt) }, [savedPrompt])

  const activePrompt = savedPrompt ?? VOCAB_GRADING_RULES
  const isPromptModified = promptText !== activePrompt

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    e.target.value = ''
    setFile(f)
    setVocabStatus(weekId, { type: 'file-selected', fileName: f.name })
  }

  async function handleUpload() {
    if (!file) return
    setVocabStatus(weekId, { type: 'loading', step: 'Claude가 단어를 분석 중...' })
    try {
      const base64 = await readFileAsBase64(file)
      const res = await fetch(`/api/weeks/${weekId}/parse-vocab-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, mimeType: file.type }),
      })
      const data = await res.json()
      if (!res.ok) { setVocabStatus(weekId, { type: 'error', message: data.error ?? '파싱 실패' }); return }

      setEditWords(data.words)
      await saveWords(data.words)
    } catch {
      setVocabStatus(weekId, { type: 'error', message: '파일 처리 중 오류가 발생했습니다' })
    }
  }

  async function saveWords(words: VocabEntry[]) {
    setVocabStatus(weekId, { type: 'saving' })
    try {
      const res = await fetch(`/api/weeks/${weekId}/vocab-words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      })
      const data = await res.json()
      if (!res.ok) { setVocabStatus(weekId, { type: 'error', message: data.error ?? '저장 실패' }); return }
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      setVocabSaved(weekId, words, { type: 'ready', savedCount: data.saved })
    } catch {
      setVocabStatus(weekId, { type: 'error', message: '저장 중 오류가 발생했습니다' })
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

  // ── 유휴 / 에러 ───────────────────────────────────────────────────────────
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

  // ── 파일 선택됨 ───────────────────────────────────────────────────────────
  if (status.type === 'file-selected') return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">단어 시험지 PDF를 업로드하면 Claude가 단어와 뜻을 자동으로 추출합니다.</p>
      <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileSelect} />
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-primary/50 hover:bg-gray-50"
      >
        <FileText className="h-8 w-8 text-primary" />
        <p className="text-sm font-medium text-gray-700">{status.fileName}</p>
        <p className="text-xs text-gray-400">다른 파일로 변경하려면 클릭</p>
      </div>
      <Button className="w-full" onClick={handleUpload}>
        <Upload className="mr-2 h-4 w-4" />
        등록하기
      </Button>
    </div>
  )

  // ── 로딩 / 저장 중 ────────────────────────────────────────────────────────
  if (status.type === 'loading' || status.type === 'saving') return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 py-8">
        <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-gray-500">
          {status.type === 'loading' ? status.step : '저장 중...'}
        </p>
      </div>
    </div>
  )

  // ── 저장됨 + 편집 가능 ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{editWords.length}개</span> 단어
          </p>
          {isDirty ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">미저장</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              저장됨
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setVocabStatus(weekId, { type: 'idle' })}>
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
                value={(w.synonyms ?? []).join(', ')}
                placeholder="유의어 (쉼표 구분)"
                className="h-7 text-xs px-2"
                onChange={(e) => updateWord(i, 'synonyms', e.target.value)}
              />
              <Input
                value={(w.antonyms ?? []).join(', ')}
                placeholder="반의어 (쉼표 구분)"
                className="h-7 text-xs px-2"
                onChange={(e) => updateWord(i, 'antonyms', e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveWords(editWords)} disabled={!isDirty}>
          변경사항 저장
        </Button>
      </div>

      {/* 채점 규칙 편집 */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            채점 규칙 수정
            {isPromptModified && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">미저장</span>
            )}
          </span>
          {promptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {promptOpen && (
          <div className="border-t border-gray-200 p-3 space-y-2">
            <p className="text-[11px] text-gray-400">다음 채점부터 적용됩니다. 저장하지 않으면 기본값이 사용됩니다.</p>
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={6}
              className="font-mono text-xs resize-none"
              spellCheck={false}
            />
            <div className="flex justify-between">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPromptText(VOCAB_GRADING_RULES)}
                className="h-7 text-xs text-gray-400 hover:text-gray-600"
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                기본값으로 되돌리기
              </Button>
              <Button
                size="sm"
                onClick={() => savePrompt.mutate(promptText)}
                disabled={savePrompt.isPending || !isPromptModified}
                className="h-7 text-xs"
              >
                <Save className="mr-1 h-3 w-3" />
                저장
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
