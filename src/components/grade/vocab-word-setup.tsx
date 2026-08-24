'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, Dice5, FileSpreadsheet, FileText, Loader2, Lock, Printer, RotateCcw, Save, Search, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { usePrompt, useSavePrompt } from '@/hooks/use-prompts'
import { VOCAB_GRADING_RULES } from '@/lib/prompts'
import { blankExampleSentence, choiceExampleSentence, extractChoiceAnswerIndex, parenthesizeExampleSentence, parseChoiceOptions } from '@/lib/vocab-example-blank'
import {
  DEFAULT_SOURCE_RATIO,
  applySourceAvailability,
  RATIO_SOURCES,
  SOURCE_RATIO_PRESETS,
  ratioSourceLabel,
  VocabRatioSource,
  VocabSourceRatio,
  allocatePromptTargets,
  rebalanceSourceRatio,
} from '@/lib/vocab-test-ratio'
import { VocabSourceRatioPanel } from '@/components/grade/vocab-source-ratio-panel'
import { useUploadStore, VocabEntry } from '@/store/upload-store'
import { choiceDistractor, normalizePromptCandidate } from '@/lib/vocab-choice-distractor'
import { errorMessage, runOrReport, runWithLoading } from '@/lib/async-ui'

const PROMPT_KEY = 'vocab_grading_rules'
const EMPTY_VOCAB_ENTRIES: VocabEntry[] = []

type SourceMeta = {
  sourceType: 'xlsx' | 'legacy_ai'
  sourceFileName: string
}

type VocabTestItem = {
  id: string
  vocab_word_id: string
  vocab_word_variant_id?: string | null
  test_number: number
  sort_order: number
  prompt_source?: VocabTestPromptSource | null
  prompt_text?: string | null
  vocab_word: VocabEntry | null
  vocab_word_variant?: {
    id: string
    word: string
    part_of_speech: string | null
    meaning: string | null
    relation_type: string
  } | null
}

type VocabTest = {
  id: string
  title: string
  item_count: number
  is_active: boolean
  items: VocabTestItem[]
}

// 모든 출제 유형이 랜덤 비율 대상이다 (예문 유형은 예문이 있는 단어에만 배분).
type VocabTestPromptSource = VocabRatioSource

type SelectedPrompt = {
  prompt_source: VocabTestPromptSource
  prompt_text: string
  variant_id?: string | null
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

function shuffle<T>(items: T[]) {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}


function normalizePromptDuplicateKey(value: string | null | undefined) {
  const normalized = normalizePromptCandidate(value) || (value ?? '').replace(/\s+/g, ' ').trim()
  return normalized
    .toLocaleLowerCase('en-US')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 시험지 파트 순서 = 문항 번호 순서. 인쇄 시험지가 A 뜻쓰기 → B 예문뜻 → C 예문빈칸 → D 예문선택 으로 묶어 찍으므로
 * 번호도 그 순서로 매겨야 한다 (랜덤 출제는 후보 귀한 유형부터 고르기 때문에 그대로 두면 번호가 파트를 거슬러 올라간다).
 */
const SECTION_RANK: Record<VocabTestPromptSource, number> = {
  word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 1, example: 2, example_choice: 3,
}
function sortIdsBySection(ids: string[], prompts: Record<string, SelectedPrompt>): string[] {
  return ids
    .map((id, index) => ({ id, index, rank: SECTION_RANK[prompts[id]?.prompt_source ?? 'word'] ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.id)
}

function promptLabel(source: VocabTestPromptSource | null | undefined) {
  if (source === 'synonym') return '유의어'
  if (source === 'antonym') return '반의어'
  if (source === 'derivative') return '파생어'
  if (source === 'example_meaning') return '예문뜻'
  if (source === 'example') return '예문빈칸'
  return '원본'
}

function makePromptOption(source: VocabTestPromptSource, rawText: string, variantId?: string | null): PromptOption | null {
  const promptText = source === 'word' ? rawText.trim() : normalizePromptCandidate(rawText)
  if (!promptText) return null
  const note = rawText.trim() && rawText.trim() !== promptText ? ` (원문: ${rawText.trim()})` : ''
  return {
    prompt_source: source,
    prompt_text: promptText,
    variant_id: variantId ?? null,
    raw_text: rawText,
    label: `${promptLabel(source)} · ${promptText}${note}`,
  }
}

/** 폴백 오답 후보 풀. VocabWordSetup 이 단어 목록을 로드할 때 갱신한다 (module scope 캐시). */
let fallbackDistractorWords: VocabEntry[] = []
/** 컴포넌트 렌더에서 모듈 변수에 직접 대입하면 React Compiler 가 컴포넌트를 건너뛰므로 함수로 감싼다. */
function setFallbackDistractorWords(words: VocabEntry[]) {
  fallbackDistractorWords = words
}

// getPromptOptions 는 예문 정규식 + 오답 후보 탐색(단어장 전체 스캔)이라 호출당 O(N) 이다.
// 렌더마다 7유형 × N단어 + 행마다 다시 부르면 O(N²~N³) 이 돼 비율 입력 한 글자에 1초 넘게 걸렸다.
// 단어 객체는 목록이 바뀌기 전까지 동일 참조이므로 WeakMap 으로 결과를 캐시한다.
// 오답 후보 풀(fallbackDistractorWords)이 바뀌면 예문선택 옵션이 달라지므로 그때 캐시를 통째로 버린다.
let promptOptionsCache = new WeakMap<VocabEntry, PromptOption[]>()
let promptOptionsCachePool: VocabEntry[] | null = null

function getPromptOptions(word: VocabEntry): PromptOption[] {
  if (promptOptionsCachePool !== fallbackDistractorWords) {
    promptOptionsCache = new WeakMap()
    promptOptionsCachePool = fallbackDistractorWords
  }
  const cached = promptOptionsCache.get(word)
  if (cached) return cached
  const options = computePromptOptions(word)
  promptOptionsCache.set(word, options)
  return options
}

function computePromptOptions(word: VocabEntry): PromptOption[] {
  const options: PromptOption[] = []
  const seen = new Set<string>()

  function addOption(source: VocabTestPromptSource, rawText: string, variantId?: string | null) {
    const option = makePromptOption(source, rawText, variantId)
    if (!option) return
    const key = normalizePromptDuplicateKey(option.prompt_text)
      || `${option.prompt_source}:${option.prompt_text.toLocaleLowerCase('en-US')}`
    if (seen.has(key)) return
    seen.add(key)
    options.push(option)
  }

  for (const variant of word.variants ?? []) {
    if (variant.exam_enabled === false) continue
    const source: VocabTestPromptSource = variant.relation_type === 'synonym'
      ? 'synonym'
      : variant.relation_type === 'derivative'
        ? 'derivative'
        : variant.relation_type === 'antonym'
          ? 'antonym'
          : 'word'
    addOption(source, variant.word, variant.id ?? null)
  }
  addOption('word', word.english_word)

  // 예문 옵션 2종: 예문 속 출제 단어(활용형 포함)가 매칭될 때만 제공.
  // 괄호/빈칸 마커가 살아있어야 하므로 makePromptOption 의 정규화를 거치지 않는다.
  const parenthesized = parenthesizeExampleSentence(word.example_sentence, word.english_word)
  if (parenthesized.matched && parenthesized.text) {
    options.push({
      prompt_source: 'example_meaning',
      prompt_text: parenthesized.text,
      variant_id: null,
      raw_text: word.example_sentence ?? '',
      label: `예문뜻 · ${parenthesized.text}`,
    })
  }
  const blanked = blankExampleSentence(word.example_sentence, word.english_word)
  if (blanked.matched && blanked.text) {
    options.push({
      prompt_source: 'example',
      prompt_text: blanked.text,
      variant_id: null,
      raw_text: word.example_sentence ?? '',
      label: `예문빈칸 · ${blanked.text}`,
    })
  }
  // 예문선택: 오답 후보는 반의어 우선. 옵션 목록에서는 정답을 왼쪽에 고정해 두고
  // (텍스트가 흔들리면 저장된 시험지 복원 시 매칭이 깨진다), 실제 출제 시 좌우를 섞는다.
  const distractor = choiceDistractor(word, fallbackDistractorWords)
  if (distractor) {
    const choice = choiceExampleSentence(word.example_sentence, word.english_word, distractor, false)
    if (choice.matched && choice.text) {
      options.push({
        prompt_source: 'example_choice',
        prompt_text: choice.text,
        variant_id: null,
        raw_text: word.example_sentence ?? '',
        label: `예문선택 · ${choice.text}`,
      })
    }
  }
  return options
}


/** 정답 좌우를 랜덤으로 섞은 선택형 prompt 를 만든다 (실제 출제용) */
function randomizedChoicePrompt(word: VocabEntry, option: PromptOption): SelectedPrompt {
  const distractor = choiceDistractor(word, fallbackDistractorWords)
  const choice = distractor
    ? choiceExampleSentence(word.example_sentence, word.english_word, distractor, Math.random() < 0.5)
    : null
  return {
    prompt_source: 'example_choice',
    prompt_text: choice?.matched && choice.text ? choice.text : option.prompt_text,
    variant_id: null,
  }
}

function normalizeSelectedPrompt(word: VocabEntry | null | undefined, source: VocabTestPromptSource | null | undefined, text: string | null | undefined, variantId?: string | null): SelectedPrompt {
  if (source === 'example' || source === 'example_meaning' || source === 'example_choice') {
    const exampleOption = word ? getPromptOptions(word).find((option) => option.prompt_source === source) : null
    const promptText = (text ?? '').trim() || exampleOption?.prompt_text || ''
    if (promptText) return { prompt_source: source, prompt_text: promptText, variant_id: null }
    // 예문 매칭 실패 → 원본 단어 뜻쓰기로 폴백
  }
  const byVariantId = variantId && word
    ? getPromptOptions(word).find((option) => option.variant_id === variantId)
    : null
  if (byVariantId) {
    return {
      prompt_source: byVariantId.prompt_source,
      prompt_text: byVariantId.prompt_text,
      variant_id: byVariantId.variant_id ?? null,
    }
  }
  const promptSource = source ?? 'word'
  const option = makePromptOption(promptSource, text || word?.english_word || '')
  const fallback = word ? getPromptOptions(word)[0] : null
  const matchedOption = option && word
    ? getPromptOptions(word).find((candidate) =>
      candidate.prompt_source === option.prompt_source &&
      candidate.prompt_text.toLocaleLowerCase('en-US') === option.prompt_text.toLocaleLowerCase('en-US')
    )
    : null
  return {
    prompt_source: matchedOption?.prompt_source ?? option?.prompt_source ?? fallback?.prompt_source ?? 'word',
    prompt_text: matchedOption?.prompt_text ?? option?.prompt_text ?? fallback?.prompt_text ?? word?.english_word ?? '',
    variant_id: matchedOption?.variant_id ?? null,
  }
}

function findVariantForPrompt(word: VocabEntry, prompt: SelectedPrompt) {
  if (prompt.prompt_source === 'word' || prompt.prompt_source === 'example' || prompt.prompt_source === 'example_meaning' || prompt.prompt_source === 'example_choice') return null
  if (prompt.variant_id) {
    return (word.variants ?? []).find((variant) => variant.id === prompt.variant_id) ?? null
  }
  return (word.variants ?? []).find((variant) =>
    variant.relation_type === prompt.prompt_source &&
    variant.word.toLocaleLowerCase('en-US') === prompt.prompt_text.toLocaleLowerCase('en-US')
  ) ?? null
}

function getPromptAnswer(word: VocabEntry, prompt: SelectedPrompt) {
  // 원본·예문뜻쓰기(영→한)의 정답은 한글 뜻, 예문빈칸(영→영)은 문장 속 영어 표면형
  if (prompt.prompt_source === 'word' || prompt.prompt_source === 'example_meaning') return word.correct_answer
  if (prompt.prompt_source === 'example') {
    return blankExampleSentence(word.example_sentence, word.english_word).answer ?? word.english_word
  }
  if (prompt.prompt_source === 'example_choice') {
    const index = extractChoiceAnswerIndex(word.example_sentence, prompt.prompt_text)
    const options = parseChoiceOptions(prompt.prompt_text)
    return (index !== null && options ? options[index] : null) ?? word.english_word
  }
  return findVariantForPrompt(word, prompt)?.meaning ?? null
}

function buildRandomVocabSelection(words: Array<VocabEntry & { id: string }>, count: number, ratio: VocabSourceRatio = DEFAULT_SOURCE_RATIO): RandomVocabSelection {
  const selected: Array<VocabEntry & { id: string }> = []
  const prompts: Record<string, SelectedPrompt> = {}
  const usedIds = new Set<string>()
  const usedPromptKeys = new Set<string>()
  const targets = allocatePromptTargets(count, ratio)

  function addWords(
    source: VocabTestPromptSource,
    target: number,
    candidates: Array<VocabEntry & { id: string }>,
    getPromptOption: (word: VocabEntry & { id: string }) => PromptOption | null
  ) {
    for (const word of shuffle(candidates)) {
      if (selected.length >= count || target <= 0) break
      if (usedIds.has(word.id)) continue
      const option = getPromptOption(word)
      if (!option) continue
      const promptKey = normalizePromptDuplicateKey(option.prompt_text)
      if (promptKey && usedPromptKeys.has(promptKey)) continue
      selected.push(word)
      usedIds.add(word.id)
      if (promptKey) usedPromptKeys.add(promptKey)
      prompts[word.id] = option.prompt_source === 'example_choice'
        ? randomizedChoicePrompt(word, option)
        : { prompt_source: option.prompt_source, prompt_text: option.prompt_text, variant_id: option.variant_id ?? null }
      target -= 1
    }
  }

  // 후보가 귀한 유형부터 채우고, 남는 자리는 원본으로 메운다
  for (const source of ['example_choice', 'example', 'example_meaning', 'antonym', 'derivative', 'synonym'] as const) {
    addWords(
      source,
      targets[source],
      words.filter((word) => getPromptOptions(word).some((option) => option.prompt_source === source)),
      (word) => randomItem(getPromptOptions(word).filter((option) => option.prompt_source === source)) ?? null
    )
  }
  addWords('word', targets.word, words, (word) => getPromptOptions(word).find((option) => option.prompt_source === 'word') ?? null)
  addWords('word', count - selected.length, words, (word) => getPromptOptions(word).find((option) => option.prompt_source === 'word') ?? null)

  return { selected, prompts }
}

/** 클릭 핸들러에서만 쓰지만 컴포넌트 본문에 Date.now() 가 있으면 react-hooks/purity 린트가 렌더 중 호출로 오인한다. */
function makeClinicPrintStamp(weekId: string) {
  const now = new Date()
  return { key: `clinic-vocab-test:${weekId}:${now.getTime()}`, createdAt: now.toISOString() }
}

// ── 미리보기 행 ────────────────────────────────────────────────────────────
// memo: 미리보기는 선택 단어 수(30~50)만큼 <select>(옵션 7개)를 그려 한 번 렌더에 120ms 를 먹었다.
// prompt 는 selectedPrompts 의 항목 참조 그대로 내려 바뀐 행만 리렌더되게 한다.
type PreviewRowProps = {
  word: VocabEntry & { id: string }
  index: number
  prompt: SelectedPrompt | undefined
  testLocked: boolean
  onUpdatePrompt: (word: VocabEntry & { id: string }, optionIndex: number) => void
  onMove: (wordId: string, direction: -1 | 1) => void
  onToggle: (wordId: string) => void
}

const PreviewRow = memo(function PreviewRow({ word, index, prompt: selected, testLocked, onUpdatePrompt, onMove, onToggle }: PreviewRowProps) {
  const prompt = selected ?? { prompt_source: 'word' as const, prompt_text: word.english_word, variant_id: null }
  const promptOptions = getPromptOptions(word)
  const selectedPromptIndex = Math.max(0, promptOptions.findIndex((option) =>
    option.prompt_source === prompt.prompt_source && option.prompt_text === prompt.prompt_text
  ))
  return (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words text-sm font-bold leading-5 text-gray-950">{prompt.prompt_text}</p>
        <p className="break-words text-[11px] text-gray-500">
          <span className="font-semibold text-blue-600">{promptLabel(prompt.prompt_source)}</span> · 정답 {getPromptAnswer(word, prompt) || '-'}
          {prompt.prompt_source !== 'word' && <span className="text-gray-400"> · 원본 {word.english_word}</span>}
        </p>
        {promptOptions.length > 1 && !testLocked && (
          <select
            value={selectedPromptIndex}
            onChange={(e) => onUpdatePrompt(word, Number(e.target.value))}
            className="h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-[11px] text-gray-600 outline-none focus:border-blue-300"
          >
            {promptOptions.map((option, optionIndex) => (
              <option key={`${option.prompt_source}-${option.prompt_text}-${optionIndex}`} value={optionIndex}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!testLocked && (
        <div className="flex shrink-0 flex-col">
          <button type="button" aria-label="위로 이동" onClick={() => onMove(word.id, -1)} className="rounded p-0.5 text-gray-300 hover:bg-white hover:text-gray-700">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="아래로 이동" onClick={() => onMove(word.id, 1)} className="rounded p-0.5 text-gray-300 hover:bg-white hover:text-gray-700">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="선택 해제" onClick={() => onToggle(word.id)} className="rounded p-0.5 text-gray-300 hover:bg-white hover:text-rose-500">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
})

// ── 단어 목록 행 ───────────────────────────────────────────────────────────
// memo: 단어장이 수십~수백 행이라 체크박스 하나를 눌러도 전체 행이 다시 그려지면 조작당 0.5초가 넘었다.
// props 를 원시값(isSelected / selectedSource / orderNo)으로 내려 바뀐 행만 리렌더되게 한다.
// 콜백(onToggle / onSelectPrompt)은 부모가 ref 패턴으로 참조를 고정해서 내려준다.
type WordRowProps = {
  word: VocabEntry & { id: string }
  isSelected: boolean
  /** 선택된 경우 현재 고른 출제 유형 (미선택이면 null) */
  selectedSource: VocabTestPromptSource | null
  /** 선택된 경우 시험지 번호 (미선택이면 null) */
  orderNo: number | null
  testLocked: boolean
  onToggle: (wordId: string) => void
  onSelectPrompt: (word: VocabEntry & { id: string }, source: VocabTestPromptSource) => void
}

const WordRow = memo(function WordRow({ word, isSelected, selectedSource, orderNo, testLocked, onToggle, onSelectPrompt }: WordRowProps) {
  const promptOptions = getPromptOptions(word)
  const availableSources = RATIO_SOURCES.filter((source) => promptOptions.some((option) => option.prompt_source === source))
  const extras = [
    formatWordList(word.synonyms) ? `유 ${formatWordList(word.synonyms)}` : null,
    formatWordList(word.antonyms) ? `반 ${formatWordList(word.antonyms)}` : null,
    word.derivatives ? `파생 ${word.derivatives}` : null,
  ].filter(Boolean)
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 px-4 py-2.5 transition-colors ${isSelected ? 'bg-blue-50/40' : 'hover:bg-gray-50/70'} ${testLocked ? 'cursor-default' : ''}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        disabled={testLocked}
        onChange={() => onToggle(word.id)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="w-6 shrink-0 text-right text-[11px] font-bold text-gray-300">{word.number}</span>
          <span className="text-sm font-bold text-gray-950">{word.english_word}</span>
          <span className="min-w-0 truncate text-xs text-gray-500">{word.correct_answer || '-'}</span>
          {word.passage_label && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">지문 {word.passage_label}</span>}
          {word.part_of_speech && <span className="text-[10px] text-gray-400">{word.part_of_speech}</span>}
          {isSelected && orderNo !== null && (
            <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {orderNo}번
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 pl-8">
          {availableSources.map((source) => {
            const options = promptOptions.filter((option) => option.prompt_source === source)
            const isActive = isSelected && (selectedSource ?? 'word') === source
            return (
              <button
                key={source}
                type="button"
                disabled={testLocked}
                onClick={(e) => { e.preventDefault(); onSelectPrompt(word, source) }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-700'
                } ${testLocked ? 'cursor-default hover:bg-gray-100 hover:text-gray-500' : ''}`}
              >
                {promptLabel(source)}{options.length > 1 ? ` ${options.length}` : ''}
              </button>
            )
          })}
        </div>
        {extras.length > 0 && (
          <p className="truncate pl-8 text-[11px] text-gray-400">{extras.join(' · ')}</p>
        )}
      </div>
    </label>
  )
})

export function VocabWordSetup({ weekId }: { weekId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const legacyInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploadMode, setUploadMode] = useState<'xlsx' | 'legacy_ai'>('xlsx')
  const [elapsed, setElapsed] = useState(0)
  const [regenLoading, setRegenLoading] = useState(false)
  const [meaningLoading, setMeaningLoading] = useState(false)
  const [editWords, setEditWords] = useState<VocabEntry[]>([])
  const [activeTest, setActiveTest] = useState<VocabTest | null>(null)
  // 채점된 답안 수. 0보다 크면 시험지 변경(저장·랜덤)을 잠근다 — 정답 역산이 어긋나는 걸 원천 차단
  const [gradedCount, setGradedCount] = useState(0)
  const testLocked = gradedCount > 0
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([])
  const [selectedPrompts, setSelectedPrompts] = useState<Record<string, SelectedPrompt>>({})
  const [testSearch, setTestSearch] = useState('')
  const [testPassageFilter, setTestPassageFilter] = useState('all')
  const [randomPickCount, setRandomPickCount] = useState(50)
  const [sourceRatio, setSourceRatio] = useState<VocabSourceRatio>(DEFAULT_SOURCE_RATIO)
  const [testSaving, setTestSaving] = useState(false)
  const [promptText, setPromptText] = useState(VOCAB_GRADING_RULES)
  const [promptOpen, setPromptOpen] = useState(false)
  // 단어 직접 수정은 평소에 쓸 일이 거의 없는데 목록이 길어 스크롤만 만든다.
  // 아래 "채점 규칙 수정"과 같은 방식으로 접어둔다.
  const [wordEditOpen, setWordEditOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)

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

  // 서버 프롬프트가 바뀌면 편집창 내용을 맞춘다 — 렌더 중 조정 (effect 에서 setState 하면 한 프레임 늦게 반영)
  const [syncedPrompt, setSyncedPrompt] = useState(savedPrompt)
  if (syncedPrompt !== savedPrompt) {
    setSyncedPrompt(savedPrompt)
    if (savedPrompt) setPromptText(savedPrompt)
  }

  // 로딩 상태로 들어갈 때 경과 시간을 0 으로 — 렌더 중 조정. 타이머만 effect 에서 돌린다
  const [elapsedStatus, setElapsedStatus] = useState(status.type)
  if (elapsedStatus !== status.type) {
    setElapsedStatus(status.type)
    setElapsed(0)
  }
  useEffect(() => {
    if (status.type !== 'loading') return
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
    const data = await res.json() as { activeTest: VocabTest | null; gradedCount?: number }
    const test = data.activeTest ?? null
    const sortedItems = (test?.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)
    setActiveTest(test)
    setGradedCount(data.gradedCount ?? 0)
    setSelectedWordIds(sortedItems.map((item) => item.vocab_word_id))
    setSelectedPrompts(Object.fromEntries(sortedItems.map((item) => {
      return [
        item.vocab_word_id,
        normalizeSelectedPrompt(item.vocab_word, item.prompt_source, item.prompt_text, item.vocab_word_variant_id ?? item.vocab_word_variant?.id ?? null),
      ]
    })))
  }, [weekId])

  // 스토어의 저장본이 바뀌면 편집본을 거기에 맞춘다 — 렌더 중 조정
  const [syncedSavedWords, setSyncedSavedWords] = useState(savedWords)
  if (syncedSavedWords !== savedWords) {
    setSyncedSavedWords(savedWords)
    if (savedWords.length > 0) setEditWords(savedWords)
  }

  useEffect(() => {
    if (savedWords.length > 0 || status.type !== 'idle') return
    // 서버 fetch 후(await 뒤) setState — 동기 호출이 아니라 캐스케이드 렌더가 아니지만 린트는 구분하지 못한다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSavedWords().catch(() => {})
  }, [loadSavedWords, savedWords, status.type])

  useEffect(() => {
    if (status.type !== 'ready') return
    // 위와 같은 이유 (fetch 후 setState)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadActiveTest().catch(() => {})
  }, [loadActiveTest, status.type])

  // ── 파생값 (핸들러 함수 선언보다 앞에 둔다 — 아래 function 들이 이 값을 호이스팅으로 참조하면
  //    React Compiler 가 "나중에 변경될 수 있는 값"으로 보고 컴포넌트를 건너뛴다) ─────────────
  const savedWordsWithIds = useMemo(
    () => editWords.filter((word): word is VocabEntry & { id: string } => !!word.id),
    [editWords],
  )
  // 선택형 오답 폴백 풀 갱신 (반의어 없는 단어용). 렌더 중 module 변수 대입 — 부작용 없는 캐시.
  setFallbackDistractorWords(savedWordsWithIds)
  const savedWordsById = useMemo(
    () => new Map(savedWordsWithIds.map((word) => [word.id, word])),
    [savedWordsWithIds],
  )
  const selectedSet = useMemo(() => new Set(selectedWordIds), [selectedWordIds])
  // 화면·저장·번호 전부 이 순서를 쓴다 (파트 순서 → 그 안에서는 고른 순서)
  // 잠긴(채점된) 시험지는 저장된 번호 그대로 보여준다 — 이 규칙 이전에 저장된 시험지가 있을 수 있어서
  const orderedSelectedWordIds = useMemo(
    () => (testLocked ? selectedWordIds : sortIdsBySection(selectedWordIds, selectedPrompts)),
    [selectedWordIds, selectedPrompts, testLocked],
  )
  const selectedWords = useMemo(
    () => orderedSelectedWordIds
      .map((id) => savedWordsById.get(id))
      .filter((word): word is VocabEntry & { id: string } => !!word),
    [savedWordsById, orderedSelectedWordIds],
  )
  // 행별 시험지 번호 — indexOf 를 행마다 부르면 O(N²) 이라 한 번만 색인한다
  const selectedOrderNo = useMemo(
    () => new Map(orderedSelectedWordIds.map((id, index) => [id, index + 1])),
    [orderedSelectedWordIds],
  )
  // WordRow/PreviewRow(memo) 에 내려주는 콜백은 참조가 고정돼야 한다. 원래 핸들러들은 최신 선택 상태를
  // closure 로 읽으므로 ref 에 담아 두고 고정된 래퍼만 내려준다. ref 갱신은 effect 에서 한다 —
  const selectedPromptCounts = useMemo(
    () => selectedWords.reduce<Record<VocabTestPromptSource, number>>((acc, word) => {
      const source = selectedPrompts[word.id]?.prompt_source ?? 'word'
      acc[source] += 1
      return acc
    }, { word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 }),
    [selectedPrompts, selectedWords],
  )
  // 보완 대상이 있을 때만 버튼을 살린다 — 서버(enrich-variants / regen-examples)가 채우는 조건과 같은 기준
  const missingMeaningVariantIds = useMemo(
    () => savedWordsWithIds.flatMap((word) => (word.variants ?? [])
      .filter((variant) => !!variant.id && (!variant.meaning?.trim() || variant.needs_review === true))
      .map((variant) => variant.id as string)),
    [savedWordsWithIds],
  )
  const missingExampleCount = useMemo(
    () => savedWordsWithIds.filter((word) => !word.example_sentence?.trim()).length,
    [savedWordsWithIds],
  )
  const passageOptions = useMemo(
    () => [...new Set(savedWordsWithIds.map((word) => word.passage_label?.trim()).filter((value): value is string => !!value))]
      .sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true })),
    [savedWordsWithIds],
  )
  const searchQuery = normalizeSearch(testSearch)
  const filteredTestWords = useMemo(
    () => savedWordsWithIds.filter((word) => {
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
    }),
    [savedWordsWithIds, searchQuery, testPassageFilter],
  )
  // (early return 앞에 둔다 — 훅 순서 고정) 유형별로 실제 출제 가능한 단어 수 (현재 필터 기준). 예문 생성 전이면 예문 유형은 0 → 비율에서 접는다
  const candidateCounts = useMemo(
    () => RATIO_SOURCES.reduce<Record<VocabRatioSource, number>>((acc, source) => {
      acc[source] = filteredTestWords.filter((word) => getPromptOptions(word).some((option) => option.prompt_source === source)).length
      return acc
    }, { word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 }),
    [filteredTestWords],
  )

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, mode: 'xlsx' | 'legacy_ai') {
    const selected = e.target.files?.[0]
    if (!selected) return
    e.target.value = ''
    setFile(selected)
    setUploadMode(mode)
    setVocabStatus(weekId, { type: 'file-selected', fileName: selected.name })
  }

  async function enrichSelectedVariantMeanings(variantIds: string[]) {
    const ids = [...new Set(variantIds.filter(Boolean))]
    if (ids.length === 0) return new Map<string, string | null>()
    const meanings = new Map<string, string | null>()
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      const res = await fetch(`/api/weeks/${weekId}/vocab-words/enrich-variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantIds: batch, limit: 50 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '단어 뜻 저장 실패')
      for (const variant of data.variants ?? []) {
        if (typeof variant.id === 'string') meanings.set(variant.id, variant.meaning ?? null)
      }
    }
    if (meanings.size > 0) {
      setEditWords((prev) => prev.map((word) => ({
        ...word,
        variants: word.variants?.map((variant) => (
          variant.id && meanings.has(variant.id)
            ? { ...variant, meaning: meanings.get(variant.id) ?? variant.meaning ?? null, needs_review: false }
            : variant
        )),
      })))
    }
    return meanings
  }

  async function saveWords(words: VocabEntry[], source?: SourceMeta) {
    setVocabStatus(weekId, { type: 'saving', step: '단어 저장 중...' })
    await runOrReport(async () => {
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
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      toast.success(`단어 ${data.saved}개 저장 완료`)
      await loadSavedWords()
      await loadActiveTest()
    }, () => setVocabStatus(weekId, { type: 'error', message: '저장 중 오류가 발생했습니다' }))
  }

  async function handleUpload() {
    if (!file) return
    setVocabStatus(weekId, {
      type: 'loading',
      step: '업로드 파일 처리 중...',
    })

    await runOrReport(async () => {
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
    }, () => setVocabStatus(weekId, { type: 'error', message: '파일 처리 중 오류가 발생했습니다' }))
  }

  async function handleRegenExamples() {
    await runWithLoading(setRegenLoading, async () => {
      const res = await fetch(`/api/weeks/${weekId}/vocab-words/regen-examples`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? '예문 생성 실패')
        return
      }
      if (data.generated === 0) toast.success('비어 있는 예문이 없습니다')
      else if (data.failedBatches > 0) toast.warning(`${data.saved ?? data.generated}개 예문 생성 완료 — 일부 배치가 실패했습니다. 다시 누르면 빈 단어만 이어서 채웁니다`)
      else toast.success(`${data.saved ?? data.generated}개 예문 생성 완료`)
      await loadSavedWords()
    }, () => toast.error('예문 생성 중 오류가 발생했습니다'))
  }

  async function handleEnrichMeanings() {
    // 단어장 전체에서 뜻이 비어 있거나 검토 필요한 유의어/반의어/파생어만 (서버도 그 조건만 채운다)
    if (missingMeaningVariantIds.length === 0) {
      toast.success('뜻이 비어 있는 유의어/반의어/파생어가 없습니다')
      return
    }
    await runWithLoading(setMeaningLoading, async () => {
      const filled = await enrichSelectedVariantMeanings(missingMeaningVariantIds)
      toast.success(`뜻 ${filled.size}개 보완 완료`)
      await loadSavedWords()
      await loadActiveTest()
    }, (error) => toast.error(errorMessage(error, '단어 뜻 저장 중 오류가 발생했습니다')))
  }

  async function persistVocabTest(wordIds: string[], prompts: Record<string, SelectedPrompt>, options: { showToast?: boolean } = {}) {
    if (wordIds.length === 0) {
      toast.error('시험에 넣을 단어를 선택해주세요')
      return
    }
    await runWithLoading(setTestSaving, async () => {
      const res = await fetch(`/api/weeks/${weekId}/vocab-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `단어시험 ${wordIds.length}문항`,
          wordIds,
          items: wordIds.map((wordId) => {
            const word = savedWordsById.get(wordId)
            const prompt = prompts[wordId]
            const fallbackOption = word ? getPromptOptions(word)[0] : null
            const resolvedPrompt = prompt && word
              ? normalizeSelectedPrompt(word, prompt.prompt_source, prompt.prompt_text, prompt.variant_id ?? null)
              : {
                prompt_source: fallbackOption?.prompt_source ?? 'word',
                prompt_text: fallbackOption?.prompt_text ?? word?.english_word ?? '',
                variant_id: fallbackOption?.variant_id ?? null,
              } as SelectedPrompt
            const variantId = word ? findVariantForPrompt(word, resolvedPrompt)?.id : undefined
            return {
              wordId,
              variantId,
              promptSource: resolvedPrompt.prompt_source,
              promptText: resolvedPrompt.prompt_text,
            }
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? '시험지 저장 실패')
        return
      }
      if (options.showToast !== false) toast.success(`${wordIds.length}문항 시험지가 저장되었습니다`)
      qc.invalidateQueries({ queryKey: ['week', weekId] })
      qc.invalidateQueries({ queryKey: ['weeks'] })
      qc.invalidateQueries({ queryKey: ['grade', weekId] })
      await loadActiveTest()
    }, () => toast.error('시험지 저장 중 오류가 발생했습니다'))
  }

  async function saveVocabTest() {
    await persistVocabTest(orderedSelectedWordIds, selectedPrompts)
  }

  function hasDuplicatePrompt(wordId: string, prompt: SelectedPrompt) {
    const key = normalizePromptDuplicateKey(prompt.prompt_text)
    if (!key) return false
    return selectedWordIds.some((selectedId) => {
      if (selectedId === wordId) return false
      const selectedWord = savedWordsById.get(selectedId)
      const selectedPrompt = selectedPrompts[selectedId] ?? {
        prompt_source: 'word' as const,
        prompt_text: selectedWord?.english_word ?? '',
        variant_id: null,
      }
      return normalizePromptDuplicateKey(selectedPrompt.prompt_text) === key
    })
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
      const word = savedWordsById.get(wordId)
      const nextPrompt = { prompt_source: 'word' as const, prompt_text: word?.english_word ?? '', variant_id: null }
      if (hasDuplicatePrompt(wordId, nextPrompt)) {
        toast.error('이미 같은 시험 단어가 선택되어 있습니다')
        return prev
      }
      setSelectedPrompts((prompts) => ({
        ...prompts,
        [wordId]: nextPrompt,
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
    const nextPrompt = option.prompt_source === 'example_choice'
      ? randomizedChoicePrompt(word, option)
      : { prompt_source: option.prompt_source, prompt_text: option.prompt_text, variant_id: option.variant_id ?? null }
    if (hasDuplicatePrompt(word.id, nextPrompt)) {
      toast.error('이미 같은 시험 단어가 선택되어 있습니다')
      return
    }
    setSelectedWordIds((prev) => prev.includes(word.id) ? prev : [...prev, word.id])
    setSelectedPrompts((prev) => ({
      ...prev,
      [word.id]: nextPrompt,
    }))
  }

  function updateSelectedPrompt(word: VocabEntry & { id: string }, optionIndex: number) {
    const option = getPromptOptions(word)[optionIndex] ?? getPromptOptions(word)[0]
    if (!option) return
    const nextPrompt = option.prompt_source === 'example_choice'
      ? randomizedChoicePrompt(word, option)
      : { prompt_source: option.prompt_source, prompt_text: option.prompt_text, variant_id: option.variant_id ?? null }
    if (hasDuplicatePrompt(word.id, nextPrompt)) {
      toast.error('이미 같은 시험 단어가 선택되어 있습니다')
      return
    }
    setSelectedPrompts((prev) => ({
      ...prev,
      [word.id]: nextPrompt,
    }))
  }

  function moveSelectedWord(wordId: string, direction: -1 | 1) {
    // 화면에 보이는(파트 순) 목록에서 자리를 바꾼다. 파트 경계를 넘는 이동은 다시 정렬돼 제자리로 온다
    setSelectedWordIds((prev) => {
      const ordered = sortIdsBySection(prev, selectedPrompts)
      const index = ordered.indexOf(wordId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return prev
      const next = [...ordered]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function updateSourceRatio(source: VocabRatioSource, value: number) {
    // 화면엔 실효 비율(후보 없는 유형 0)이 보이므로 그 값을 기준으로 재배분해야 사용자가 본 숫자와 맞는다
    setSourceRatio((prev) => rebalanceSourceRatio(applySourceAvailability(prev, candidateCounts), source, value))
  }

  async function selectRandomTestWords() {
    if (filteredTestWords.length === 0) {
      toast.error('랜덤으로 선택할 단어가 없습니다')
      return
    }
    const count = Math.max(1, Math.min(randomPickCount, filteredTestWords.length))
    const picked = buildRandomVocabSelection(filteredTestWords, count, effectiveRatio)
    const prompts = picked.prompts
    // 랜덤은 후보 귀한 유형부터 채우므로 그대로 저장하면 번호가 인쇄 파트를 거스른다 → 파트 순으로 정렬해 저장
    const orderedIds = sortIdsBySection(picked.selected.map((word) => word.id), prompts)
    const selected = orderedIds.map((id) => picked.selected.find((word) => word.id === id)!)

    setSelectedWordIds(orderedIds)
    setSelectedPrompts(prompts)
    const variantIds = selected
      .map((word) => findVariantForPrompt(word, prompts[word.id])?.id)
      .filter((id): id is string => Boolean(id))
    const counts = selected.reduce<Record<VocabTestPromptSource, number>>((acc, word) => {
      const source = prompts[word.id]?.prompt_source ?? 'word'
      acc[source] += 1
      return acc
    }, { word: 0, synonym: 0, antonym: 0, derivative: 0, example_meaning: 0, example: 0, example_choice: 0 })
    if (variantIds.length > 0) {
      const ok = await runWithLoading(setMeaningLoading, async () => {
        await enrichSelectedVariantMeanings(variantIds)
        await loadSavedWords()
      }, (error) => toast.error(errorMessage(error, '단어 뜻 저장 중 오류가 발생했습니다')))
      if (!ok) return
    }
    await persistVocabTest(selected.map((word) => word.id), prompts, { showToast: false })
    toast.success(`${selected.length}개 선택: 원본 ${counts.word}, 유의어 ${counts.synonym}, 반의어 ${counts.antonym}, 파생어 ${counts.derivative}, 예문 ${counts.example_meaning + counts.example + counts.example_choice}`)
  }

  async function openClinicPrint(mode: 'student' | 'grading') {
    if (filteredTestWords.length === 0) {
      toast.error('클리닉 시험지로 뽑을 단어가 없습니다')
      return
    }
    const count = Math.max(1, Math.min(randomPickCount, filteredTestWords.length))
    const picked = buildRandomVocabSelection(filteredTestWords, count, effectiveRatio)
    const prompts = picked.prompts
    // 인쇄 파트 순서(뜻쓰기 → 예문뜻 → 빈칸 → 선택)로 번호를 매긴다
    const orderedIds = sortIdsBySection(picked.selected.map((word) => word.id), prompts)
    const selected = orderedIds.map((id) => picked.selected.find((word) => word.id === id)!)
    if (selected.length === 0) {
      toast.error('클리닉 시험지로 뽑을 단어가 없습니다')
      return
    }

    const selectedVariants = selected.map((word) => {
      const prompt = prompts[word.id] ?? { prompt_source: 'word' as const, prompt_text: word.english_word, variant_id: null }
      if (prompt.prompt_source === 'word') return null
      const variant = findVariantForPrompt(word, prompt)
      return variant?.id ? variant : null
    })
    let enrichedMeanings = new Map<string, string | null>()
    const selectedVariantIds = selectedVariants.map((variant) => variant?.id).filter((id): id is string => Boolean(id))
    if (selectedVariantIds.length > 0) {
      const ok = await runWithLoading(setMeaningLoading, async () => {
        enrichedMeanings = await enrichSelectedVariantMeanings(selectedVariantIds)
      }, (error) => toast.error(errorMessage(error, '단어 뜻 저장 중 오류가 발생했습니다')))
      if (!ok) return
    }

    const { key, createdAt } = makeClinicPrintStamp(weekId)
    const payload = {
      title: `어휘시험 ${selected.length}문항`,
      createdAt,
      items: selected.map((word, index) => {
        const prompt = prompts[word.id] ?? { prompt_source: 'word' as const, prompt_text: word.english_word, variant_id: null }
        const variant = findVariantForPrompt(word, prompt)
        const variantMeaning = variant?.id ? enrichedMeanings.get(variant.id) ?? variant.meaning : variant?.meaning
        // 예문 유형 포함 유형별 정답 계산. variant 는 방금 enrich 된 뜻을 우선 사용
        const answer = variant
          ? variantMeaning ?? null
          : getPromptAnswer(word, prompt)
        return {
          id: `${word.id}-${index}`,
          test_number: index + 1,
          prompt_text: prompt.prompt_text,
          prompt_source: prompt.prompt_source,
          vocab_word: {
            english_word: word.english_word,
            correct_answer: answer,
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

  // 렌더 중 ref.current 에 대입하면 React Compiler 가 이 컴포넌트를 건너뛴다.
  const rowHandlersRef = useRef({ toggleTestWord, selectPromptForWord, updateSelectedPrompt, moveSelectedWord })
  useEffect(() => {
    rowHandlersRef.current = { toggleTestWord, selectPromptForWord, updateSelectedPrompt, moveSelectedWord }
  })
  const handleToggleWord = useCallback((wordId: string) => rowHandlersRef.current.toggleTestWord(wordId), [])
  const handleSelectPrompt = useCallback(
    (word: VocabEntry & { id: string }, source: VocabTestPromptSource) => rowHandlersRef.current.selectPromptForWord(word, source),
    [],
  )
  const handleUpdatePrompt = useCallback(
    (word: VocabEntry & { id: string }, optionIndex: number) => rowHandlersRef.current.updateSelectedPrompt(word, optionIndex),
    [],
  )
  const handleMoveWord = useCallback((wordId: string, direction: -1 | 1) => rowHandlersRef.current.moveSelectedWord(wordId, direction), [])

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

  const clinicPickCount = Math.max(1, Math.min(randomPickCount, Math.max(1, filteredTestWords.length)))
  const effectiveRatio = applySourceAvailability(sourceRatio, candidateCounts)
  const foldedSources = RATIO_SOURCES.filter((source) => sourceRatio[source] > 0 && effectiveRatio[source] === 0)
  const randomRatioTargets = allocatePromptTargets(clinicPickCount, effectiveRatio)

  // 잠김: 채점된 답안이 있으면 문항 구성(선택·유형·순서·랜덤·저장)을 전부 막고 인쇄만 남긴다.
  // 버튼 disabled 만으로는 "왜 안 되지" 가 안 보여서 배너 + 저장 자리를 잠금 표시로 바꾼다.
  const lockTitle = testLocked ? '채점된 답안이 있어 시험지를 바꿀 수 없습니다' : undefined
  const activePreset = SOURCE_RATIO_PRESETS.find((preset) => RATIO_SOURCES.every((source) => sourceRatio[source] === preset.ratio[source]))
  const nonZeroCounts = RATIO_SOURCES.filter((source) => selectedPromptCounts[source] > 0)

  return (
    <div className="space-y-4">
      {/* 단어장 상태 + 관리 액션 (보조 — 시험지 카드보다 눈에 덜 띄게) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-900">단어장 {editWords.length}개</span>
          <span className="text-gray-400" title="예문이 있는 단어 수 — 예문 유형(예문뜻·빈칸·선택)은 이 단어들에서만 출제됩니다">예문 {savedWordsWithIds.length - missingExampleCount}/{savedWordsWithIds.length}</span>
          {isDirty ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">미저장</span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />저장됨
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {/* 채울 게 있을 때만 활성 — 다 차 있으면 회색 + 툴팁 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-gray-500 disabled:opacity-40"
            onClick={handleEnrichMeanings}
            disabled={meaningLoading || missingMeaningVariantIds.length === 0}
            title={missingMeaningVariantIds.length === 0 ? '유의어·반의어·파생어 뜻이 모두 채워져 있습니다' : `뜻이 비어 있는 유의어·반의어·파생어 ${missingMeaningVariantIds.length}개를 AI 로 채웁니다`}
          >
            {meaningLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            뜻 보완{missingMeaningVariantIds.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">{missingMeaningVariantIds.length}</span>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-gray-500 disabled:opacity-40"
            onClick={handleRegenExamples}
            disabled={regenLoading || missingExampleCount === 0}
            title={missingExampleCount === 0 ? '모든 단어에 예문이 있습니다' : `예문이 없는 단어 ${missingExampleCount}개에 AI 예문을 만듭니다`}
          >
            {regenLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            예문 생성{missingExampleCount > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">{missingExampleCount}</span>}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-gray-500" onClick={() => setVocabStatus(weekId, { type: 'idle' })}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            다시 올리기
          </Button>
        </div>
      </div>

      {/* 시험지 카드 */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_10px_40px_rgba(0,75,198,0.04)]">
        {testLocked && (
          <div className="flex items-start gap-2.5 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p>
              <span className="font-bold">시험지 잠김</span> — 채점된 답안이 {gradedCount}개 있어 문항 구성을 바꿀 수 없습니다.
              <span className="text-amber-700"> 인쇄는 그대로 가능합니다.</span>
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">
              시험지
              {activeTest && <span className="ml-1.5 text-xs font-semibold text-blue-600">{activeTest.item_count}문항 저장됨</span>}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">단어장에서 시험에 낼 항목을 고르고 유형을 정합니다</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
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
              className="h-8"
              onClick={() => openClinicPrint('student')}
              disabled={filteredTestWords.length === 0 || meaningLoading}
              title={`현재 표시된 단어 ${filteredTestWords.length}개 중 ${clinicPickCount}문항을 뽑아 저장 없이 인쇄합니다.`}
            >
              {meaningLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Dice5 className="mr-1.5 h-3.5 w-3.5" />}
              보충 시험지
            </Button>
            {testLocked ? (
              <span className="ml-1 flex h-8 items-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-semibold text-gray-500" title={lockTitle}>
                <Lock className="h-3.5 w-3.5" />
                잠김
              </span>
            ) : (
              <Button size="sm" className="ml-1 h-8" onClick={saveVocabTest} disabled={testSaving || selectedWordIds.length === 0}>
                {testSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                {selectedWordIds.length}문항 저장
              </Button>
            )}
          </div>
        </div>

        <div className={`grid border-t border-gray-100 lg:grid-cols-[minmax(0,1fr)_400px] ${testLocked ? 'opacity-70' : ''}`}>
          <div className="border-b border-gray-100 lg:border-b-0 lg:border-r">
            {/* 도구 줄: 검색 · 지문 · 랜덤 */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-300" />
                <Input
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  placeholder="단어 · 뜻 · 유의어 · 반의어 검색"
                  className="h-8 border-gray-200 pl-8 text-xs shadow-none"
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
              <div className={`flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-gray-200 bg-white pl-1 pr-0.5 ${testLocked ? 'pointer-events-none' : ''}`} title={lockTitle}>
                {[30, 40, 50].map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={testLocked}
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
                  disabled={testLocked}
                  onChange={(e) => {
                    const parsed = Number(e.target.value)
                    setRandomPickCount(Number.isFinite(parsed) ? parsed : 1)
                  }}
                  className="h-6 w-11 border-0 px-0 text-center text-xs shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-6 rounded px-2 text-[11px]"
                  onClick={selectRandomTestWords}
                  disabled={meaningLoading || testLocked}
                >
                  {meaningLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Dice5 className="mr-1 h-3 w-3" />}
                  랜덤 출제
                </Button>
              </div>
            </div>

            {/* 출제 비율 — 평소엔 한 줄 요약, 눌러야 펼침 (랜덤 출제에만 쓰이는 설정) */}
            <div className="border-y border-gray-100">
              <button
                type="button"
                onClick={() => setRatioOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[11px] transition-colors hover:bg-gray-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="font-bold text-gray-700">출제 비율</span>
                <span className="min-w-0 truncate text-gray-500">
                  {RATIO_SOURCES.filter((source) => effectiveRatio[source] > 0).map((source) => `${ratioSourceLabel(source)} ${effectiveRatio[source]}`).join(' · ')}
                </span>
                {activePreset && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{activePreset.label}</span>}
                {foldedSources.length > 0 && (
                  <span
                    className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                    title={`${foldedSources.map(ratioSourceLabel).join('·')} 은 출제 가능한 단어가 없어 비율에서 제외됐습니다 (예문 유형은 예문 생성 후 열립니다)`}
                  >
                    {foldedSources.map(ratioSourceLabel).join('·')} 제외
                  </span>
                )}
                <span className="ml-auto shrink-0 text-gray-400">{ratioOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
              </button>
              {ratioOpen && (
                <div className={testLocked ? 'pointer-events-none' : ''}>
                  <VocabSourceRatioPanel
                    ratio={effectiveRatio}
                    targets={randomRatioTargets}
                    candidateCounts={candidateCounts}
                    onChangeRatio={updateSourceRatio}
                    onSelectPreset={setSourceRatio}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-gray-400">
              <span>{filteredTestWords.length}개 표시</span>
              <span><b className="font-semibold text-gray-600">{selectedWordIds.length}개</b> 선택</span>
            </div>

            {/* 단어 목록 — 한 줄에 번호·단어·뜻·배지, 그 아래 고를 수 있는 유형 칩만 */}
            <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
              {filteredTestWords.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-gray-400">조건에 맞는 단어가 없습니다.</p>
              ) : filteredTestWords.map((word) => (
                <WordRow
                  key={word.id}
                  word={word}
                  isSelected={selectedSet.has(word.id)}
                  selectedSource={selectedPrompts[word.id]?.prompt_source ?? null}
                  orderNo={selectedOrderNo.get(word.id) ?? null}
                  testLocked={testLocked}
                  onToggle={handleToggleWord}
                  onSelectPrompt={handleSelectPrompt}
                />
              ))}
            </div>
          </div>

          {/* 미리보기 — 실제 시험지 순서·문장 그대로 */}
          <aside className="bg-gray-50/70">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-700">
                  미리보기 <span className="font-semibold text-gray-400">{selectedWords.length}문항</span>
                </p>
                {nonZeroCounts.length > 0 && (
                  <p className="mt-0.5 truncate text-[10px] text-gray-400">
                    {nonZeroCounts.map((source) => `${ratioSourceLabel(source)} ${selectedPromptCounts[source]}`).join(' · ')}
                  </p>
                )}
              </div>
              {!testLocked && selectedWords.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWordIds([])
                    setSelectedPrompts({})
                  }}
                  className="shrink-0 text-[11px] font-semibold text-gray-400 hover:text-gray-600"
                >
                  비우기
                </button>
              )}
            </div>
            <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
              {selectedWords.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-gray-400">왼쪽에서 시험에 낼 항목을 선택하세요.</p>
              ) : selectedWords.map((word, index) => (
                <PreviewRow
                  key={word.id}
                  word={word}
                  index={index}
                  prompt={selectedPrompts[word.id]}
                  testLocked={testLocked}
                  onUpdatePrompt={handleUpdatePrompt}
                  onMove={handleMoveWord}
                  onToggle={handleToggleWord}
                />
              ))}
            </div>
          </aside>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <button
          type="button"
          onClick={() => setWordEditOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50"
        >
          <span className="flex items-center gap-1.5">
            단어 직접 수정
            <span className="text-gray-300">{editWords.length}개</span>
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">미저장</span>
            )}
          </span>
          {wordEditOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {wordEditOpen && (
        <div className="border-t border-gray-200">
        <p className="px-3 pt-2 text-[11px] text-gray-400">
          채점을 마친 뒤에도 여기서 고치면 학생 점수가 유지됩니다. 파일을 다시 올리면 그 주차 점수가 초기화됩니다.
        </p>
        <div className="mt-2 hidden grid-cols-[3.5rem_4.25rem_1.3fr_4.25rem_1.4fr_1.4fr_1.2fr_1.5fr] gap-2 border-y border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 xl:grid">
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
        <div className="flex justify-end border-t border-gray-200 p-3">
          <Button onClick={() => saveWords(editWords)} disabled={!isDirty}>
            변경사항 저장
          </Button>
        </div>
        </div>
        )}
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
