'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileSpreadsheet, FileText, Loader2, RotateCcw, Save, Sparkles, Upload } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { usePrompt, useSavePrompt } from '@/hooks/use-prompts'
import { VOCAB_GRADING_RULES } from '@/lib/prompts'
import { useUploadStore, VocabEntry } from '@/store/upload-store'

const PROMPT_KEY = 'vocab_grading_rules'
const EMPTY_VOCAB_ENTRIES: VocabEntry[] = []

type SourceMeta = {
  sourceType: 'xlsx' | 'legacy_ai'
  sourceFileName: string
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function splitList(value: string) {
  return value.split(/[,/]+/).map((s) => s.trim()).filter(Boolean)
}

export function VocabWordSetup({ weekId }: { weekId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const legacyInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadMode, setUploadMode] = useState<'xlsx' | 'legacy_ai'>('xlsx')
  const [elapsed, setElapsed] = useState(0)
  const [regenLoading, setRegenLoading] = useState(false)
  const [editWords, setEditWords] = useState<VocabEntry[]>([])
  const [promptText, setPromptText] = useState(VOCAB_GRADING_RULES)
  const [promptOpen, setPromptOpen] = useState(false)

  const qc = useQueryClient()
  const vocabState = useUploadStore((s) => s.vocab[weekId])
  const status = vocabState?.status ?? { type: 'idle' }
  const savedWords = vocabState?.savedWords ?? EMPTY_VOCAB_ENTRIES
  const setVocabStatus = useUploadStore((s) => s.setVocabStatus)
  const setVocabSaved = useUploadStore((s) => s.setVocabSaved)

  const { data: savedPrompt } = usePrompt(PROMPT_KEY)
  const savePrompt = useSavePrompt(PROMPT_KEY)
  const activePrompt = savedPrompt ?? VOCAB_GRADING_RULES
  const isPromptModified = promptText !== activePrompt
  const isDirty = JSON.stringify(editWords) !== JSON.stringify(savedWords)

  useEffect(() => { if (savedPrompt) setPromptText(savedPrompt) }, [savedPrompt])

  useEffect(() => {
    if (status.type !== 'loading') return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [status.type])

  const loadSavedWords = useCallback(async () => {
    const res = await fetch(`/api/weeks/${weekId}/vocab-words`)
    if (!res.ok) return
    const data = await res.json() as VocabEntry[]
    if (data?.length > 0) {
      setEditWords(data)
      setVocabSaved(weekId, data, { type: 'ready', savedCount: data.length })
    }
  }, [setVocabSaved, weekId])

  useEffect(() => {
    if (savedWords.length > 0) {
      setEditWords(savedWords)
      return
    }
    if (status.type !== 'idle') return
    loadSavedWords().catch(() => {})
  }, [loadSavedWords, savedWords, status.type])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, mode: 'xlsx' | 'legacy_ai') {
    const selected = e.target.files?.[0]
    if (!selected) return
    e.target.value = ''
    setFile(selected)
    setUploadMode(mode)
    setVocabStatus(weekId, { type: 'file-selected', fileName: selected.name })
  }

  async function saveWords(words: VocabEntry[], source?: SourceMeta) {
    setVocabStatus(weekId, { type: 'saving' })
    try {
      const res = await fetch(`/api/weeks/${weekId}/vocab-words`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words,
          sourceType: source?.sourceType,
          sourceFileName: source?.sourceFileName,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVocabStatus(weekId, { type: 'error', message: data.error ?? '저장 실패' })
        return
      }
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      setVocabSaved(weekId, words, { type: 'ready', savedCount: data.saved })
      toast.success(`단어 ${data.saved}개 저장 완료`)
    } catch {
      setVocabStatus(weekId, { type: 'error', message: '저장 중 오류가 발생했습니다' })
    }
  }

  async function handleUpload() {
    if (!file) return
    setVocabStatus(weekId, {
      type: 'loading',
      step: uploadMode === 'xlsx' ? '엑셀 단어장을 읽는 중...' : 'AI가 단어장을 분석 중...',
    })

    try {
      const base64 = await readFileAsBase64(file)
      const endpoint = uploadMode === 'xlsx'
        ? `/api/weeks/${weekId}/parse-vocab-xlsx`
        : `/api/weeks/${weekId}/parse-vocab-pdf`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64, mimeType: file.type, fileName: file.name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVocabStatus(weekId, { type: 'error', message: data.error ?? '파싱 실패' })
        return
      }

      setEditWords(data.words)
      await saveWords(data.words, { sourceType: uploadMode, sourceFileName: file.name })
    } catch {
      setVocabStatus(weekId, { type: 'error', message: '파일 처리 중 오류가 발생했습니다' })
    }
  }

  async function handleRegenExamples() {
    setRegenLoading(true)
    try {
      const res = await fetch(`/api/weeks/${weekId}/vocab-words/regen-examples`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? '예문 생성 실패')
        return
      }
      if (data.generated === 0) toast.success('비어 있는 예문이 없습니다')
      else toast.success(`${data.saved ?? data.generated}개 예문 생성 완료`)
      await loadSavedWords()
    } catch {
      toast.error('예문 생성 중 오류가 발생했습니다')
    } finally {
      setRegenLoading(false)
    }
  }

  function updateWord(index: number, field: keyof VocabEntry, value: string) {
    setEditWords((prev) => prev.map((word, i) => {
      if (i !== index) return word
      if (field === 'synonyms' || field === 'antonyms') {
        return { ...word, [field]: splitList(value) }
      }
      if (field === 'number' || field === 'source_row_index') {
        const parsed = Number(value)
        return { ...word, [field]: Number.isFinite(parsed) ? parsed : word[field] }
      }
      if (field === 'english_word') {
        return { ...word, english_word: value }
      }
      return { ...word, [field]: value.trim() || null }
    }))
  }

  if (status.type === 'idle' || status.type === 'error') return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
        <p className="text-sm font-semibold text-blue-900">엑셀 단어장을 원본으로 등록합니다.</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-700">
          지문, 본문 단어, 품사, 본문 의미, 문맥 동의어, 파생어/변형 주의, 반의어 컬럼을 그대로 저장합니다.
          저장된 값만 학생 share 단어장과 오답/재시험에 표시됩니다.
        </p>
      </div>

      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => handleFileSelect(e, 'xlsx')} />
      <input ref={legacyInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileSelect(e, 'legacy_ai')} />

      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-white py-8 transition-colors hover:border-blue-400 hover:bg-blue-50/50"
      >
        <FileSpreadsheet className="h-8 w-8 text-blue-500" />
        <p className="text-sm font-medium text-gray-700">엑셀 단어장 업로드 (.xlsx)</p>
        <p className="text-xs text-gray-400">샘플처럼 컬럼명이 있는 첫 단어장 시트를 읽습니다.</p>
      </div>

      <button
        type="button"
        onClick={() => legacyInputRef.current?.click()}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
      >
        <FileText className="h-3.5 w-3.5" />
        PDF/이미지 AI 추출은 보조 기능으로 사용
      </button>

      {status.type === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-xs text-red-700">{status.message}</p>
        </div>
      )}
    </div>
  )

  if (status.type === 'file-selected') return (
    <div className="space-y-4">
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => handleFileSelect(e, 'xlsx')} />
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 transition-colors hover:border-blue-300 hover:bg-gray-50"
      >
        {uploadMode === 'xlsx'
          ? <FileSpreadsheet className="h-8 w-8 text-blue-500" />
          : <FileText className="h-8 w-8 text-indigo-500" />}
        <p className="text-sm font-medium text-gray-700">{status.fileName}</p>
        <p className="text-xs text-gray-400">다른 파일로 바꾸려면 클릭</p>
      </div>
      <Button className="w-full" onClick={handleUpload}>
        <Upload className="mr-2 h-4 w-4" />
        원본 단어장 등록
      </Button>
    </div>
  )

  if (status.type === 'loading' || status.type === 'saving') return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">{status.type === 'saving' ? '저장 중...' : status.step}</p>
          {status.type === 'loading' && <p className="mt-1 text-xs text-gray-400">{elapsed}초 경과</p>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRegenExamples} disabled={regenLoading}>
            {regenLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            예문 생성
          </Button>
          <Button variant="outline" size="sm" onClick={() => setVocabStatus(weekId, { type: 'idle' })}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            다시 올리기
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <div className="min-w-[1120px]">
            <div className="grid grid-cols-[4rem_5rem_minmax(11rem,1fr)_5rem_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(13rem,1.2fr)] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <span>#</span>
              <span>지문</span>
              <span>본문 단어</span>
              <span>품사</span>
              <span>본문 의미</span>
              <span>문맥 동의어</span>
              <span>반의어</span>
              <span>파생어 / 변형 주의</span>
            </div>
            <div className="max-h-[52vh] divide-y divide-gray-100 overflow-y-auto">
              {editWords.map((word, index) => (
                <div key={`${word.number}-${index}`} className="grid grid-cols-[4rem_5rem_minmax(11rem,1fr)_5rem_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(13rem,1.2fr)] items-center gap-2 px-3 py-2">
                  <Input
                    value={word.number}
                    type="number"
                    min={1}
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'number', e.target.value)}
                  />
                  <Input
                    value={word.passage_label ?? ''}
                    placeholder="20"
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'passage_label', e.target.value)}
                  />
                  <Input
                    value={word.english_word}
                    className="h-8 px-2 text-xs font-medium"
                    onChange={(e) => updateWord(index, 'english_word', e.target.value)}
                  />
                  <Input
                    value={word.part_of_speech ?? ''}
                    placeholder="v."
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'part_of_speech', e.target.value)}
                  />
                  <Input
                    value={word.correct_answer ?? ''}
                    placeholder="뜻 입력"
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'correct_answer', e.target.value)}
                  />
                  <Input
                    value={(word.synonyms ?? []).join(', ')}
                    placeholder="쉼표로 구분"
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'synonyms', e.target.value)}
                  />
                  <Input
                    value={(word.antonyms ?? []).join(', ')}
                    placeholder="쉼표로 구분"
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'antonyms', e.target.value)}
                  />
                  <Input
                    value={word.derivatives ?? ''}
                    placeholder="파생어 / 변형"
                    className="h-8 px-2 text-xs"
                    onChange={(e) => updateWord(index, 'derivatives', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveWords(editWords)} disabled={!isDirty}>
          변경사항 저장
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50"
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
          <div className="space-y-2 border-t border-gray-200 p-3">
            <p className="text-[11px] text-gray-400">다음 채점부터 적용됩니다. 저장하지 않으면 기본값이 사용됩니다.</p>
            <Textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={6}
              className="resize-none font-mono text-xs"
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
