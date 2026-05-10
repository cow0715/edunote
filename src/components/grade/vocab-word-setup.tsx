'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, Dice5, FileSpreadsheet, FileText, Loader2, Printer, RotateCcw, Save, Search, Sparkles, Upload, X } from 'lucide-react'
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

type VocabTestItem = {
  id: string
  vocab_word_id: string
  test_number: number
  sort_order: number
  prompt_source?: VocabTestPromptSource | null
  prompt_text?: string | null
  vocab_word: VocabEntry | null
}

type VocabTest = {
  id: string
  title: string
  item_count: number
  is_active: boolean
  items: VocabTestItem[]
}

type VocabTestPromptSource = 'word' | 'synonym' | 'derivative'

type SelectedPrompt = {
  prompt_source: VocabTestPromptSource
  prompt_text: string
}

type PromptOption = SelectedPrompt & {
  label: string
  raw_text: string
}

type RandomVocabSelection = {
  selected: Array<VocabEntry & { id: string }>
  prompts: Record<string, SelectedPrompt>
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

function normalizeSearch(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('ko-KR')
}

function formatWordList(value: string[] | null | undefined) {
  return (value ?? []).filter(Boolean).join(', ')
}

function splitVariantText(value: string | null | undefined) {
  return (value ?? '')
    .split(/[,/;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function randomItem(items: string[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function normalizePromptCandidate(value: string | null | undefined) {
  let text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  text = text.split('※')[0] ?? text
  text = text
    .replace(/\((?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.?\)/gi, ' ')
    .replace(/\b(?:n|v|a|ad|adj|adv|prep|conj|phr|phrase)\.\s*$/gi, ' ')
    .replace(/\[[^\]]*[가-힣][^\]]*\]/g, ' ')
    .replace(/\([^)]*[가-힣][^)]*\)/g, ' ')
    .replace(/^[=+@]+/, '')
    .replace(/[↔→←]/g, ' ')
    .replace(/["“”‘’]/g, ' ')
    .replace(/[^A-Za-z\s.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

function promptLabel(source: VocabTestPromptSource | null | undefined) {
  if (source === 'synonym') return '유의어'
  if (source === 'derivative') return '파생어'
  return '원본'
}

function makePromptOption(source: VocabTestPromptSource, rawText: string): PromptOption | null {
  const promptText = source === 'word' ? rawText.trim() : normalizePromptCandidate(rawText)
  if (!promptText) return null
  const note = rawText.trim() && rawText.trim() !== promptText ? ` (원문: ${rawText.trim()})` : ''
  return {
    prompt_source: source,
    prompt_text: promptText,
    raw_text: rawText,
    label: `${promptLabel(source)} · ${promptText}${note}`,
  }
}

function getPromptOptions(word: VocabEntry): PromptOption[] {
  const options: PromptOption[] = []
  const seen = new Set<string>()

  function addOption(source: VocabTestPromptSource, rawText: string) {
    const option = makePromptOption(source, rawText)
    if (!option) return
    const key = `${option.prompt_source}:${option.prompt_text.toLocaleLowerCase('en-US')}`
    if (seen.has(key)) return
    seen.add(key)
    options.push(option)
  }

  for (const variant of word.variants ?? []) {
    if (variant.exam_enabled === false || variant.relation_type === 'antonym') continue
    const source: VocabTestPromptSource = variant.relation_type === 'synonym'
      ? 'synonym'
      : variant.relation_type === 'derivative'
        ? 'derivative'
        : 'word'
    addOption(source, variant.word)
  }
  addOption('word', word.english_word)
  for (const synonym of word.synonyms ?? []) {
    addOption('synonym', synonym)
  }
  for (const derivative of splitVariantText(word.derivatives)) {
    addOption('derivative', derivative)
  }
  return options
}

function normalizeSelectedPrompt(word: VocabEntry | null | undefined, source: VocabTestPromptSource | null | undefined, text: string | null | undefined): SelectedPrompt {
  const promptSource = source ?? 'word'
  const option = makePromptOption(promptSource, text || word?.english_word || '')
  const fallback = word ? getPromptOptions(word)[0] : null
  return {
    prompt_source: option?.prompt_source ?? fallback?.prompt_source ?? 'word',
    prompt_text: option?.prompt_text ?? fallback?.prompt_text ?? word?.english_word ?? '',
  }
}

function buildRandomVocabSelection(words: Array<VocabEntry & { id: string }>, count: number): RandomVocabSelection {
  const selected: Array<VocabEntry & { id: string }> = []
  const prompts: Record<string, SelectedPrompt> = {}
  const usedIds = new Set<string>()
  const originalTarget = Math.round(count * 0.5)
  const synonymTarget = Math.round(count * 0.25)
  const derivativeTarget = count - originalTarget - synonymTarget

  function addWords(
    source: VocabTestPromptSource,
    target: number,
    candidates: Array<VocabEntry & { id: string }>,
    getPromptText: (word: VocabEntry & { id: string }) => string
  ) {
    for (const word of shuffle(candidates)) {
      if (selected.length >= count || target <= 0) break
      if (usedIds.has(word.id)) continue
      const promptText = getPromptText(word)
      if (!promptText) continue
      selected.push(word)
      usedIds.add(word.id)
      prompts[word.id] = { prompt_source: source, prompt_text: promptText }
      target -= 1
    }
  }

  addWords(
    'derivative',
    derivativeTarget,
    words.filter((word) => getPromptOptions(word).some((option) => option.prompt_source === 'derivative')),
    (word) => randomItem(getPromptOptions(word).filter((option) => option.prompt_source === 'derivative').map((option) => option.prompt_text))
  )
  addWords(
    'synonym',
    synonymTarget,
    words.filter((word) => getPromptOptions(word).some((option) => option.prompt_source === 'synonym')),
    (word) => randomItem(getPromptOptions(word).filter((option) => option.prompt_source === 'synonym').map((option) => option.prompt_text))
  )
  addWords('word', originalTarget, words, (word) => word.english_word)
  addWords('word', count - selected.length, words, (word) => word.english_word)

  return { selected, prompts }
}

export function VocabWordSetup({ weekId }: { weekId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const legacyInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadMode, setUploadMode] = useState<'xlsx' | 'legacy_ai'>('xlsx')
  const [elapsed, setElapsed] = useState(0)
  const [regenLoading, setRegenLoading] = useState(false)
  const [editWords, setEditWords] = useState<VocabEntry[]>([])
  const [activeTest, setActiveTest] = useState<VocabTest | null>(null)
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([])
  const [selectedPrompts, setSelectedPrompts] = useState<Record<string, SelectedPrompt>>({})
  const [testSearch, setTestSearch] = useState('')
  const [testPassageFilter, setTestPassageFilter] = useState('all')
  const [randomPickCount, setRandomPickCount] = useState(50)
  const [testSaving, setTestSaving] = useState(false)
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

  const loadActiveTest = useCallback(async () => {
    const res = await fetch(`/api/weeks/${weekId}/vocab-tests`)
    if (!res.ok) return
    const data = await res.json() as { activeTest: VocabTest | null }
    const test = data.activeTest ?? null
    const sortedItems = (test?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
    setActiveTest(test)
    setSelectedWordIds(sortedItems.map((item) => item.vocab_word_id))
    setSelectedPrompts(Object.fromEntries(sortedItems.map((item) => {
      return [
        item.vocab_word_id,
        normalizeSelectedPrompt(item.vocab_word, item.prompt_source, item.prompt_text),
      ]
    })))
  }, [weekId])

  useEffect(() => {
    if (savedWords.length > 0) {
      setEditWords(savedWords)
      return
    }
    if (status.type !== 'idle') return
    loadSavedWords().catch(() => {})
  }, [loadSavedWords, savedWords, status.type])

  useEffect(() => {
    if (status.type !== 'ready') return
    loadActiveTest().catch(() => {})
  }, [loadActiveTest, status.type])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, mode: 'xlsx' | 'legacy_ai') {
    const selected = e.target.files?.[0]
    if (!selected) return
    e.target.value = ''
    setFile(selected)
    setUploadMode(mode)
    setVocabStatus(weekId, { type: 'file-selected', fileName: selected.name })
  }

  async function enrichVariantMeanings() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      setVocabStatus(weekId, { type: 'saving', step: '단어 뜻 저장 중...' })
      const res = await fetch(`/api/weeks/${weekId}/vocab-words/enrich-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 80 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '단어 뜻 저장 실패')
      if (!data.remaining || data.processed === 0) return
    }
    throw new Error('단어 뜻 저장이 오래 걸리고 있습니다. 잠시 후 다시 시도해주세요.')
  }

  async function saveWords(words: VocabEntry[], source?: SourceMeta) {
    setVocabStatus(weekId, { type: 'saving', step: '단어 저장 중...' })
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
      if (source?.sourceType === 'xlsx') {
        await enrichVariantMeanings()
      }
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      toast.success(`단어 ${data.saved}개 저장 완료`)
      await loadSavedWords()
      await loadActiveTest()
    } catch {
      setVocabStatus(weekId, { type: 'error', message: '저장 중 오류가 발생했습니다' })
    }
  }

  async function handleUpload() {
    if (!file) return
    setVocabStatus(weekId, {
      type: 'loading',
      step: '업로드 파일 처리 중...',
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

  async function saveVocabTest() {
    if (selectedWordIds.length === 0) {
      toast.error('시험에 넣을 단어를 선택해주세요')
      return
    }
    setTestSaving(true)
    try {
      const res = await fetch(`/api/weeks/${weekId}/vocab-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `단어시험 ${selectedWordIds.length}문항`,
          wordIds: selectedWordIds,
          items: selectedWordIds.map((wordId) => {
            const word = savedWordsWithIds.find((item) => item.id === wordId)
            const prompt = selectedPrompts[wordId]
            const fallbackOption = word ? getPromptOptions(word)[0] : null
            const normalizedOption = prompt && word
              ? makePromptOption(prompt.prompt_source, prompt.prompt_text)
              : null
            return {
              wordId,
              promptSource: normalizedOption?.prompt_source ?? fallbackOption?.prompt_source ?? 'word',
              promptText: normalizedOption?.prompt_text ?? fallbackOption?.prompt_text ?? word?.english_word ?? '',
            }
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? '시험지 저장 실패')
        return
      }
      toast.success(`${selectedWordIds.length}문항 시험지가 저장되었습니다`)
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      await loadActiveTest()
    } catch {
      toast.error('시험지 저장 중 오류가 발생했습니다')
    } finally {
      setTestSaving(false)
    }
  }

  function toggleTestWord(wordId: string) {
    setSelectedWordIds((prev) => {
      if (prev.includes(wordId)) {
        setSelectedPrompts((prompts) => {
          const next = { ...prompts }
          delete next[wordId]
          return next
        })
        return prev.filter((id) => id !== wordId)
      }
      const word = savedWordsWithIds.find((item) => item.id === wordId)
      setSelectedPrompts((prompts) => ({
        ...prompts,
        [wordId]: { prompt_source: 'word', prompt_text: word?.english_word ?? '' },
      }))
      return [...prev, wordId]
    })
  }

  function selectPromptForWord(word: VocabEntry & { id: string }, source: VocabTestPromptSource) {
    const option = getPromptOptions(word).find((candidate) => candidate.prompt_source === source)
    if (!option) {
      toast.error(`${promptLabel(source)} 후보가 없습니다`)
      return
    }
    setSelectedWordIds((prev) => prev.includes(word.id) ? prev : [...prev, word.id])
    setSelectedPrompts((prev) => ({
      ...prev,
      [word.id]: { prompt_source: option.prompt_source, prompt_text: option.prompt_text },
    }))
  }

  function updateSelectedPrompt(word: VocabEntry & { id: string }, optionIndex: number) {
    const option = getPromptOptions(word)[optionIndex] ?? getPromptOptions(word)[0]
    if (!option) return
    setSelectedPrompts((prev) => ({
      ...prev,
      [word.id]: { prompt_source: option.prompt_source, prompt_text: option.prompt_text },
    }))
  }

  function moveSelectedWord(wordId: string, direction: -1 | 1) {
    setSelectedWordIds((prev) => {
      const index = prev.indexOf(wordId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function selectRandomTestWords() {
    if (filteredTestWords.length === 0) {
      toast.error('랜덤으로 선택할 단어가 없습니다')
      return
    }
    const count = Math.max(1, Math.min(randomPickCount, filteredTestWords.length))
    const { selected, prompts } = buildRandomVocabSelection(filteredTestWords, count)

    setSelectedWordIds(selected.map((word) => word.id))
    setSelectedPrompts(prompts)
    const counts = selected.reduce<Record<VocabTestPromptSource, number>>((acc, word) => {
      const source = prompts[word.id]?.prompt_source ?? 'word'
      acc[source] += 1
      return acc
    }, { word: 0, synonym: 0, derivative: 0 })
    toast.success(`${selected.length}개 선택: 원본 ${counts.word}, 유의어 ${counts.synonym}, 파생어 ${counts.derivative}`)
  }

  function openClinicPrint(mode: 'student' | 'grading') {
    if (filteredTestWords.length === 0) {
      toast.error('클리닉 시험지로 뽑을 단어가 없습니다')
      return
    }
    const count = Math.max(1, Math.min(randomPickCount, filteredTestWords.length))
    const { selected, prompts } = buildRandomVocabSelection(filteredTestWords, count)
    if (selected.length === 0) {
      toast.error('클리닉 시험지로 뽑을 단어가 없습니다')
      return
    }

    const key = `clinic-vocab-test:${weekId}:${Date.now()}`
    const payload = {
      title: `어휘시험 ${selected.length}문항`,
      createdAt: new Date().toISOString(),
      items: selected.map((word, index) => {
        const prompt = prompts[word.id] ?? { prompt_source: 'word' as const, prompt_text: word.english_word }
        const variant = (word.variants ?? []).find((candidate) =>
          candidate.word.toLocaleLowerCase('en-US') === prompt.prompt_text.toLocaleLowerCase('en-US')
        )
        return {
          id: `${word.id}-${index}`,
          test_number: index + 1,
          prompt_text: prompt.prompt_text,
          prompt_source: prompt.prompt_source,
          vocab_word: {
            english_word: word.english_word,
            correct_answer: variant?.meaning ?? word.correct_answer,
          },
        }
      }),
    }
    localStorage.setItem(key, JSON.stringify(payload))
    const path = mode === 'student' ? 'clinic-print' : 'clinic-grading-print'
    const url = window.location.pathname.replace(/\/$/, '') + `/vocab-test/${path}?draft=${encodeURIComponent(key)}`
    window.open(url, '_blank')
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
          <p className="text-sm font-medium text-gray-700">{status.type === 'saving' ? status.step ?? '저장 중...' : status.step}</p>
          {status.type === 'loading' && <p className="mt-1 text-xs text-gray-400">{elapsed}초 경과</p>}
        </div>
      </div>
    </div>
  )

  const savedWordsWithIds = editWords.filter((word): word is VocabEntry & { id: string } => !!word.id)
  const selectedSet = new Set(selectedWordIds)
  const selectedWords = selectedWordIds
    .map((id) => savedWordsWithIds.find((word) => word.id === id))
    .filter((word): word is VocabEntry & { id: string } => !!word)
  const selectedPromptCounts = selectedWords.reduce<Record<VocabTestPromptSource, number>>((acc, word) => {
    const source = selectedPrompts[word.id]?.prompt_source ?? 'word'
    acc[source] += 1
    return acc
  }, { word: 0, synonym: 0, derivative: 0 })
  const passageOptions = [...new Set(savedWordsWithIds.map((word) => word.passage_label?.trim()).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }))
  const searchQuery = normalizeSearch(testSearch)
  const filteredTestWords = savedWordsWithIds.filter((word) => {
    if (testPassageFilter !== 'all' && (word.passage_label ?? '') !== testPassageFilter) return false
    if (!searchQuery) return true
    return [
      word.english_word,
      word.correct_answer,
      word.passage_label,
      word.part_of_speech,
      word.derivatives,
      formatWordList(word.synonyms),
      formatWordList(word.antonyms),
    ].some((value) => normalizeSearch(value).includes(searchQuery))
  })
  const allFilteredSelected = filteredTestWords.length > 0 && filteredTestWords.every((word) => selectedSet.has(word.id))
  const clinicPickCount = Math.max(1, Math.min(randomPickCount, Math.max(1, filteredTestWords.length)))

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

      <div className="overflow-hidden rounded-xl border border-blue-100 bg-blue-50/40">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-bold text-gray-900">시험지 선택</p>
            <p className="mt-0.5 text-xs text-gray-500">
              원본 단어장 {savedWordsWithIds.length}개 중 실제 시험에 낼 단어만 선택합니다.
              {activeTest && <span className="ml-1 text-blue-600">현재 시험지 {activeTest.item_count}문항</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-gray-400">시험지 인쇄</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!activeTest) {
                    alert('먼저 시험지를 저장해 주세요.')
                    return
                  }
                  const url = window.location.pathname.replace(/\/$/, '') + `/vocab-test/${activeTest.id}/print`
                  window.open(url, '_blank')
                }}
              >
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                정규 시험지
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openClinicPrint('student')}
                disabled={filteredTestWords.length === 0}
                title={`현재 표시된 단어 ${filteredTestWords.length}개 중 ${clinicPickCount}문항을 뽑아 저장 없이 인쇄합니다.`}
              >
                <Dice5 className="mr-1.5 h-3.5 w-3.5" />
                보충 시험지
              </Button>
            </div>
            <span className="mx-1 hidden h-6 w-px bg-gray-200 sm:block" />
            <Button size="sm" onClick={saveVocabTest} disabled={testSaving || selectedWordIds.length === 0}>
              {testSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              {selectedWordIds.length}문항 시험지 저장
            </Button>
          </div>
        </div>

        <div className="grid gap-0 bg-white lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="border-b border-gray-100 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-300" />
                <Input
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  placeholder="단어, 뜻, 유의어, 반의어, 파생어 검색"
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <select
                value={testPassageFilter}
                onChange={(e) => setTestPassageFilter(e.target.value)}
                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600"
              >
                <option value="all">전체 지문</option>
                {passageOptions.map((passage) => (
                  <option key={passage} value={passage}>지문 {passage}</option>
                ))}
              </select>
              <div className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2">
                {[30, 40, 50].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setRandomPickCount(count)}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
                      randomPickCount === count ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {count}
                  </button>
                ))}
                <Input
                  type="number"
                  min={1}
                  max={Math.max(1, filteredTestWords.length)}
                  value={randomPickCount}
                  onChange={(e) => {
                    const parsed = Number(e.target.value)
                    setRandomPickCount(Number.isFinite(parsed) ? parsed : 1)
                  }}
                  className="h-6 w-12 border-0 px-0 text-center text-xs shadow-none focus-visible:ring-0"
                />
                <span className="text-[11px] text-gray-400">개</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={selectRandomTestWords}
                >
                  <Dice5 className="mr-1 h-3.5 w-3.5" />
                  랜덤
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  const visibleIds = new Set(filteredTestWords.map((word) => word.id))
                  setSelectedWordIds((prev) => {
                    if (allFilteredSelected) {
                      return prev.filter((id) => !visibleIds.has(id))
                    }
                    const next = [...prev]
                    for (const word of filteredTestWords) {
                      if (!next.includes(word.id)) next.push(word.id)
                    }
                    return next
                  })
                  setSelectedPrompts((prev) => {
                    if (allFilteredSelected) {
                      const next = { ...prev }
                      for (const id of visibleIds) delete next[id]
                      return next
                    }
                    const next = { ...prev }
                    for (const word of filteredTestWords) {
                      if (!next[word.id]) {
                        next[word.id] = { prompt_source: 'word', prompt_text: word.english_word }
                      }
                    }
                    return next
                  })
                }}
              >
                {allFilteredSelected ? '보이는 단어 해제' : '보이는 단어 선택'}
              </Button>
            </div>

            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 px-4 py-2 text-[11px] font-semibold text-gray-500">
              <span>{filteredTestWords.length}개 표시</span>
              <span>
                {selectedWordIds.length}개 선택됨 · 원본 {selectedPromptCounts.word} · 유의어 {selectedPromptCounts.synonym} · 파생어 {selectedPromptCounts.derivative}
              </span>
            </div>

            <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
              {filteredTestWords.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-gray-400">조건에 맞는 단어가 없습니다.</p>
              ) : filteredTestWords.map((word) => {
                const promptOptions = getPromptOptions(word)
                const selectedPrompt = selectedPrompts[word.id]
                const isSelected = selectedSet.has(word.id)
                const availableSources: VocabTestPromptSource[] = ['word', 'synonym', 'derivative']
                return (
                  <div key={word.id} className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-blue-50/50 ${isSelected ? 'bg-blue-50/35' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleTestWord(word.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                      {word.number}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {word.passage_label && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">지문 {word.passage_label}</span>
                        )}
                        {word.part_of_speech && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">{word.part_of_speech}</span>
                        )}
                        {isSelected && (
                          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            시험 {selectedWordIds.indexOf(word.id) + 1}번
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="break-words text-sm font-bold text-gray-950">{word.english_word}</p>
                        <p className="mt-0.5 text-xs leading-5 text-gray-600">
                          <b className="font-semibold text-gray-900">뜻</b> {word.correct_answer || '-'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {availableSources.map((source) => {
                          const options = promptOptions.filter((option) => option.prompt_source === source)
                          const isActive = isSelected && (selectedPrompt?.prompt_source ?? 'word') === source
                          return (
                            <button
                              key={source}
                              type="button"
                              disabled={options.length === 0}
                              onClick={() => selectPromptForWord(word, source)}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 ${
                                isActive
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700'
                              }`}
                            >
                              {promptLabel(source)}{options.length > 1 ? ` ${options.length}` : ''}
                            </button>
                          )
                        })}
                      </div>
                      {(formatWordList(word.synonyms) || formatWordList(word.antonyms) || word.derivatives) && (
                        <div className="grid gap-1 text-[11px] leading-4 text-gray-500 sm:grid-cols-3">
                          <span className="min-w-0"><b className="font-semibold text-gray-700">유의어</b> <span className="break-words">{formatWordList(word.synonyms) || '-'}</span></span>
                          <span className="min-w-0"><b className="font-semibold text-gray-700">반의어</b> <span className="break-words">{formatWordList(word.antonyms) || '-'}</span></span>
                          <span className="min-w-0"><b className="font-semibold text-gray-700">파생/주의</b> <span className="break-words">{word.derivatives || '-'}</span></span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <aside className="bg-gray-50">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-gray-700">시험지 미리보기</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    원본 {selectedPromptCounts.word} · 유의어 {selectedPromptCounts.synonym} · 파생어 {selectedPromptCounts.derivative}
                  </p>
                </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedWordIds([])
                  setSelectedPrompts({})
                }}
                className="text-[11px] font-semibold text-gray-400 hover:text-gray-600"
              >
                비우기
              </button>
              </div>
            </div>
            <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
              {selectedWords.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-gray-400">왼쪽에서 시험에 낼 항목을 선택하세요.</p>
              ) : selectedWords.map((word, index) => {
                const prompt = selectedPrompts[word.id] ?? { prompt_source: 'word' as const, prompt_text: word.english_word }
                const promptOptions = getPromptOptions(word)
                const selectedPromptIndex = Math.max(0, promptOptions.findIndex((option) =>
                  option.prompt_source === prompt.prompt_source && option.prompt_text === prompt.prompt_text
                ))
                return (
                  <div key={word.id} className="flex items-start gap-2 px-3 py-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="min-w-0 rounded-lg bg-white px-3 py-2 shadow-[0_1px_8px_rgba(15,23,42,0.04)]">
                        <p className="break-words text-sm font-black text-gray-950">{prompt.prompt_text}</p>
                        <p className="mt-1 break-words text-[11px] font-medium text-gray-500">
                          {promptLabel(prompt.prompt_source)} · 정답 {word.correct_answer || '-'}
                        </p>
                      </div>
                      <select
                        value={selectedPromptIndex}
                        onChange={(e) => updateSelectedPrompt(word, Number(e.target.value))}
                        className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      >
                        {promptOptions.map((option, optionIndex) => (
                          <option key={`${option.prompt_source}-${option.prompt_text}-${optionIndex}`} value={optionIndex}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="truncate text-[10px] text-gray-400">
                        {[word.passage_label ? `지문 ${word.passage_label}` : null, word.part_of_speech, prompt.prompt_source !== 'word' ? `원본 ${word.english_word}` : formatWordList(word.synonyms)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button type="button" aria-label="위로 이동" onClick={() => moveSelectedWord(word.id, -1)} className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label="아래로 이동" onClick={() => moveSelectedWord(word.id, 1)} className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label="선택 해제" onClick={() => toggleTestWord(word.id)} className="rounded p-1 text-rose-400 hover:bg-white hover:text-rose-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="hidden grid-cols-[3.5rem_4.25rem_1.3fr_4.25rem_1.4fr_1.4fr_1.2fr_1.5fr] gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 xl:grid">
          <span>#</span>
          <span>지문</span>
          <span>본문 단어</span>
          <span>품사</span>
          <span>본문 의미</span>
          <span>문맥 동의어</span>
          <span>반의어</span>
          <span>파생어 / 변형 주의</span>
        </div>
        <div className="max-h-[52vh] divide-y divide-gray-100 overflow-y-auto overflow-x-hidden">
          {editWords.map((word, index) => (
            <div key={`${word.number}-${index}`} className="grid grid-cols-2 items-end gap-2 px-3 py-3 md:grid-cols-6 xl:grid-cols-[3.5rem_4.25rem_1.3fr_4.25rem_1.4fr_1.4fr_1.2fr_1.5fr] xl:py-2">
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">번호</span>
                <Input
                  value={word.number}
                  type="number"
                  min={1}
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'number', e.target.value)}
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">지문</span>
                <Input
                  value={word.passage_label ?? ''}
                  placeholder="20"
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'passage_label', e.target.value)}
                />
              </label>
              <label className="col-span-2 min-w-0 md:col-span-2 xl:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">본문 단어</span>
                <Input
                  value={word.english_word}
                  className="h-8 w-full min-w-0 px-2 text-xs font-medium"
                  onChange={(e) => updateWord(index, 'english_word', e.target.value)}
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">품사</span>
                <Input
                  value={word.part_of_speech ?? ''}
                  placeholder="v."
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'part_of_speech', e.target.value)}
                />
              </label>
              <label className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">본문 의미</span>
                <Input
                  value={word.correct_answer ?? ''}
                  placeholder="뜻 입력"
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'correct_answer', e.target.value)}
                />
              </label>
              <label className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">문맥 동의어</span>
                <Input
                  value={(word.synonyms ?? []).join(', ')}
                  placeholder="쉼표로 구분"
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'synonyms', e.target.value)}
                />
              </label>
              <label className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">반의어</span>
                <Input
                  value={(word.antonyms ?? []).join(', ')}
                  placeholder="쉼표로 구분"
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'antonyms', e.target.value)}
                />
              </label>
              <label className="col-span-2 min-w-0 md:col-span-3 xl:col-span-1">
                <span className="mb-1 block text-[10px] font-semibold text-gray-400 xl:hidden">파생어 / 변형 주의</span>
                <Input
                  value={word.derivatives ?? ''}
                  placeholder="파생어 / 변형"
                  className="h-8 w-full min-w-0 px-2 text-xs"
                  onChange={(e) => updateWord(index, 'derivatives', e.target.value)}
                />
              </label>
            </div>
          ))}
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
