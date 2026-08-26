'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Trash2, ChevronDown, ChevronUp, Loader2, BookOpen, Sparkles, Download } from 'lucide-react'
import { confirmAiWork } from './constants'
import type {
  ExamBank,
  GenerateVocabResult,
  VocabCollection,
  VocabCollectionDetail,
  VocabCollectionItem,
  VocabSource,
} from './types'

// ── 기출 단어장 ───────────────────────────────────────────────────────────

function csvCell(value: string | number) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function sourceLabel(source: VocabSource) {
  const numbers = source.question_numbers?.length
    ? source.question_numbers
    : [source.question_number]
  const sortedNumbers = [...new Set(numbers)].filter((number) => Number.isFinite(number)).sort((a, b) => a - b)
  if (sortedNumbers.length === 0) return `${source.year}년 ${source.month}월 ${source.source}`
  const numberLabel = sortedNumbers.length <= 1
    ? `${sortedNumbers[0]}번`
    : `${sortedNumbers[0]}~${sortedNumbers[sortedNumbers.length - 1]}번`
  return `${source.year}년 ${source.month}월 ${source.source} ${numberLabel}`
}

function listOrEmpty(values: unknown) {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []
}

function downloadVocabCsv(collection: VocabCollectionDetail, items = collection.items) {
  const header = ['번호', '단어', '뜻', '빈도', '주제', '유의어', '반의어', '유사어', '출처']
  const rows = items.map((item, index) => [
    index + 1,
    item.word,
    item.meaning,
    item.frequency,
    item.topic,
    listOrEmpty(item.synonyms).join(' / '),
    listOrEmpty(item.antonyms).join(' / '),
    listOrEmpty(item.similar_words).join(' / '),
    item.sources.map(sourceLabel).join(' / '),
  ])
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${collection.title}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function readApiError(res: Response, fallback: string) {
  const text = await res.text().catch(() => '')
  if (text.includes('FUNCTION_INVOCATION_TIMEOUT') || res.status === 504) {
    return '단어장 생성 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.'
  }

  if (!text) return fallback

  try {
    const data = JSON.parse(text) as { error?: string; message?: string }
    return data.error ?? data.message ?? fallback
  } catch {
    return fallback
  }
}

type VocabSortKey = 'topic' | 'frequency' | 'word' | 'source'
type VocabSortDirection = 'asc' | 'desc'

const VOCAB_SORT_COLUMN_ORDER: VocabSortKey[] = ['topic', 'frequency', 'word', 'source']
const DEFAULT_VOCAB_SORT_DIRECTIONS: Record<VocabSortKey, VocabSortDirection> = {
  topic: 'asc',
  frequency: 'desc',
  word: 'asc',
  source: 'desc',
}

function compareSourceLatest(a: VocabCollectionItem, b: VocabCollectionItem) {
  const aSource = a.sources[0]
  const bSource = b.sources[0]
  const aQuestionNumber = aSource?.question_numbers?.[0] ?? aSource?.question_number ?? 0
  const bQuestionNumber = bSource?.question_numbers?.[0] ?? bSource?.question_number ?? 0
  return (aSource?.year ?? 0) - (bSource?.year ?? 0)
    || (aSource?.month ?? 0) - (bSource?.month ?? 0)
    || aQuestionNumber - bQuestionNumber
}

function compareVocabBySort(a: VocabCollectionItem, b: VocabCollectionItem, key: VocabSortKey) {
  if (key === 'topic') return (a.topic || '기타').localeCompare(b.topic || '기타')
  if (key === 'frequency') return a.frequency - b.frequency
  if (key === 'word') return a.word.localeCompare(b.word)
  if (key === 'source') return compareSourceLatest(a, b)
  return 0
}

function applySortDirection(value: number, direction: VocabSortDirection) {
  return direction === 'asc' ? value : -value
}

export function VocabCollections() {
  const queryClient = useQueryClient()
  const currentYear = new Date().getFullYear()
  const defaultYearTo = currentYear - 1
  const [yearFrom, setYearFrom] = useState(String(defaultYearTo - 4))
  const [yearTo, setYearTo] = useState(String(defaultYearTo))
  const [months, setMonths] = useState<number[]>([6, 9, 11])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [duplicateCollection, setDuplicateCollection] = useState<VocabCollection | null>(null)
  const [topicFilter, setTopicFilter] = useState('all')
  const [minFrequency, setMinFrequency] = useState('1')
  const [sortDirections, setSortDirections] = useState(DEFAULT_VOCAB_SORT_DIRECTIONS)

  const { data: collections, isLoading } = useQuery<VocabCollection[]>({
    queryKey: ['vocab-collections'],
    queryFn: () => fetch('/api/exam-bank/vocab-collections').then((r) => r.json()),
  })

  const { data: examsForYears } = useQuery<ExamBank[]>({
    queryKey: ['exam-bank'],
    queryFn: () => fetch('/api/exam-bank').then((r) => r.json()),
  })

  const { data: detail, isFetching: detailLoading } = useQuery<VocabCollectionDetail>({
    queryKey: ['vocab-collection', selectedId],
    queryFn: () => fetch(`/api/exam-bank/vocab-collections/${selectedId}`).then((r) => r.json()),
    enabled: !!selectedId,
  })

  // 생성 조건이 바뀌면 이전 "중복 단어장" 안내를 지운다 (렌더 중 조정).
  const filterKey = `${yearFrom}|${yearTo}|${months.join(',')}`
  const [syncedFilterKey, setSyncedFilterKey] = useState(filterKey)
  if (syncedFilterKey !== filterKey) {
    setSyncedFilterKey(filterKey)
    setDuplicateCollection(null)
  }

  const generateMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean } = {}) => {
      const res = await fetch('/api/exam-bank/vocab-collections/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year_from: Number(yearFrom),
          year_to: Number(yearTo),
          grade: 3,
          months,
          force_regenerate: force,
        }),
      })
      if (!res.ok) throw new Error(await readApiError(res, '단어장 생성 실패'))
      const data = await res.json()
      return data as GenerateVocabResult
    },
    onSuccess: (data) => {
      if (data.duplicate) {
        setDuplicateCollection(data.existing)
        toast.info('같은 조건의 단어장이 이미 있습니다')
        return
      }
      setDuplicateCollection(null)
      toast.success(`단어장 생성 완료 (${data.item_count}개)`)
      setSelectedId(data.id)
      queryClient.invalidateQueries({ queryKey: ['vocab-collections'] })
      queryClient.invalidateQueries({ queryKey: ['vocab-collection', data.id] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '단어장 생성 실패')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/exam-bank/vocab-collections/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readApiError(res, '단어장 삭제 실패'))
      return id
    },
    onSuccess: (id) => {
      toast.success('단어장을 삭제했습니다')
      if (selectedId === id) setSelectedId(null)
      setDuplicateCollection((current) => current?.id === id ? null : current)
      queryClient.invalidateQueries({ queryKey: ['vocab-collections'] })
      queryClient.removeQueries({ queryKey: ['vocab-collection', id] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '단어장 삭제 실패')
    },
  })

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, defaultYearTo])
    for (const exam of examsForYears ?? []) {
      if (Number.isFinite(exam.exam_year)) years.add(exam.exam_year)
    }
    for (const value of [yearFrom, yearTo]) {
      const year = Number(value)
      if (Number.isFinite(year) && year > 0) years.add(year)
    }
    const min = Math.min(...years)
    const max = Math.max(...years)
    return Array.from({ length: max - min + 1 }, (_, i) => max - i)
  }, [currentYear, defaultYearTo, examsForYears, yearFrom, yearTo])

  const toggleMonth = (month: number) => {
    setMonths((prev) => prev.includes(month)
      ? prev.filter((m) => m !== month)
      : [...prev, month].sort((a, b) => a - b))
  }

  const selectedCollection = detail ?? null
  const topicOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of selectedCollection?.items ?? []) {
      const topic = item.topic || '기타'
      counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
  }, [selectedCollection])

  // 고른 주제가 현재 목록에 없으면 'all' 로 취급한다.
  // state 를 되돌리는 대신 파생값을 쓰면 애초에 잘못된 state 가 생기지 않는다.
  const effectiveTopicFilter =
    topicFilter !== 'all' && !topicOptions.some((option) => option.topic === topicFilter)
      ? 'all'
      : topicFilter

  const displayedItems = useMemo(() => {
    const minimum = Math.max(1, Number(minFrequency) || 1)
    return [...(selectedCollection?.items ?? [])]
      .filter((item) => effectiveTopicFilter === 'all' || (item.topic || '기타') === effectiveTopicFilter)
      .filter((item) => item.frequency >= minimum)
      .sort((a, b) => {
        for (const rule of VOCAB_SORT_COLUMN_ORDER) {
          const result = compareVocabBySort(a, b, rule)
          if (result !== 0) return applySortDirection(result, sortDirections[rule])
        }
        return a.word.localeCompare(b.word)
      })
  }, [minFrequency, selectedCollection, sortDirections, effectiveTopicFilter])

  const toggleSortDirection = (key: VocabSortKey) =>
    setSortDirections((current) => ({
      ...current,
      [key]: current[key] === 'asc' ? 'desc' : 'asc',
    }))

  const sortCaret = (key: VocabSortKey) =>
    sortDirections[key] === 'asc'
      ? <ChevronUp className="h-3.5 w-3.5" />
      : <ChevronDown className="h-3.5 w-3.5" />


  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="rounded-2xl bg-white p-4 shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">기출 어휘 생성</h2>
            <BookOpen className="h-4 w-4 text-blue-600" />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">시행년</p>
              <div className="flex items-center gap-1">
                <Select value={yearFrom} onValueChange={setYearFrom}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => <SelectItem key={year} value={String(year)}>{year}년</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-300">~</span>
                <Select value={yearTo} onValueChange={setYearTo}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => <SelectItem key={year} value={String(year)}>{year}년</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide">시험</p>
              <div className="grid grid-cols-3 gap-2">
                {[6, 9, 11].map((month) => (
                  <label key={month} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gray-50 text-xs font-medium text-gray-600">
                    <Checkbox checked={months.includes(month)} onCheckedChange={() => toggleMonth(month)} />
                    {month === 11 ? '수능' : `${month}월`}
                  </label>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => {
                if (confirmAiWork()) generateMutation.mutate({ force: false })
              }}
              disabled={generateMutation.isPending || months.length === 0}
            >
              {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              단어장 생성
            </Button>

            {duplicateCollection && (
              <div className="rounded-xl bg-blue-50 px-3 py-3 text-xs text-blue-700">
                <p className="font-semibold">같은 조건의 단어장이 이미 있습니다.</p>
                <p className="mt-1 text-blue-500">{duplicateCollection.title} · {duplicateCollection.item_count}개</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-blue-200 bg-white text-xs text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      setSelectedId(duplicateCollection.id)
                      setDuplicateCollection(null)
                    }}
                  >
                    기존 열기
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      if (confirmAiWork()) generateMutation.mutate({ force: true })
                    }}
                    disabled={generateMutation.isPending}
                  >
                    재생성
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-2 shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80">
          {isLoading ? (
            <p className="px-3 py-6 text-sm text-gray-400">단어장을 불러오는 중...</p>
          ) : !collections?.length ? (
            <p className="px-3 py-6 text-sm text-gray-400">생성된 단어장이 없습니다.</p>
          ) : (
            <div className="space-y-1">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                    selectedId === collection.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(collection.id)}>
                      <p className="truncate text-sm font-semibold">{collection.title}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {collection.year_from}-{collection.year_to}년 · {collection.item_count}개
                      </p>
                    </button>
                    <button
                      className="mt-0.5 rounded-md p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      disabled={deleteMutation.isPending}
                      title="단어장 삭제"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (window.confirm(`"${collection.title}" 단어장을 삭제할까요?`)) {
                          deleteMutation.mutate(collection.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-[0px_4px_24px_rgba(0,75,198,0.06)] border border-gray-100/80 overflow-hidden">
        {!selectedCollection ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-400">
            단어장을 선택하거나 새로 생성하세요.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-gray-900">{selectedCollection.title}</h2>
                <p className="mt-0.5 text-xs text-gray-400">
                  {selectedCollection.year_from}-{selectedCollection.year_to}년 · {selectedCollection.months.map((m) => m === 11 ? '수능' : `${m}월`).join(', ')}
                  <span className="mx-1.5">·</span>
                  {displayedItems.length}/{selectedCollection.items.length}개 표시
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadVocabCsv(selectedCollection, displayedItems)}>
                  <Download className="mr-2 h-4 w-4" />
                  현재 정렬 CSV
                </Button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-400">불러오는 중...</div>
            ) : (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 bg-gray-50/60 px-4 py-3">
                  <div className="grid flex-1 gap-2 sm:max-w-md sm:grid-cols-[1fr_120px]">
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">주제</p>
                      <Select value={effectiveTopicFilter} onValueChange={setTopicFilter}>
                        <SelectTrigger className="h-8 bg-white text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">전체 주제</SelectItem>
                          {topicOptions.map((option) => (
                            <SelectItem key={option.topic} value={option.topic}>
                              {option.topic} ({option.count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">최소 빈도</p>
                      <Input
                        type="number"
                        min={1}
                        value={minFrequency}
                        onChange={(e) => setMinFrequency(e.target.value)}
                        className="h-8 bg-white text-xs"
                      />
                    </div>
                  </div>
                  <div className="text-xs leading-5 text-gray-400">
                    정렬: 주제{sortDirections.topic === 'asc' ? '↑' : '↓'} · 빈도{sortDirections.frequency === 'asc' ? '↑' : '↓'} · 단어{sortDirections.word === 'asc' ? '↑' : '↓'} · 출처{sortDirections.source === 'asc' ? '↑' : '↓'}
                  </div>
                </div>

                <div className="max-h-[620px] overflow-auto">
                {displayedItems.length === 0 ? (
                  <div className="px-3 py-16 text-center text-sm text-gray-400">
                    표시할 단어가 없습니다.
                  </div>
                ) : (
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(15,23,42,0.06)]">
                      <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        <th className="w-12 px-4 py-2">No</th>
                        <th className="w-36 px-3 py-2">
                          <button type="button" onClick={() => toggleSortDirection('topic')} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-100 hover:text-gray-700">
                            주제 {sortCaret('topic')}
                          </button>
                        </th>
                        <th className="w-24 px-3 py-2">
                          <button type="button" onClick={() => toggleSortDirection('frequency')} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-100 hover:text-gray-700">
                            빈도 {sortCaret('frequency')}
                          </button>
                        </th>
                        <th className="w-44 px-3 py-2">
                          <button type="button" onClick={() => toggleSortDirection('word')} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-100 hover:text-gray-700">
                            단어 {sortCaret('word')}
                          </button>
                        </th>
                        <th className="min-w-52 px-3 py-2">뜻</th>
                        <th className="min-w-64 px-3 py-2">유의/반의/유사</th>
                        <th className="min-w-48 px-3 py-2">
                          <button type="button" onClick={() => toggleSortDirection('source')} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-gray-100 hover:text-gray-700">
                            출처 {sortCaret('source')}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {displayedItems.map((item, index) => {
                        const synonyms = listOrEmpty(item.synonyms)
                        const antonyms = listOrEmpty(item.antonyms)
                        const similarWords = listOrEmpty(item.similar_words)
                        return (
                          <tr key={item.id} className="align-top hover:bg-blue-50/30">
                            <td className="px-4 py-3 text-xs font-medium text-gray-300">{index + 1}</td>
                            <td className="px-3 py-3 text-xs text-gray-500">{item.topic || '기타'}</td>
                            <td className="px-3 py-3">
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{item.frequency}회</span>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-bold text-gray-950">{item.word}</p>
                            </td>
                            <td className="px-3 py-3 text-gray-600">{item.meaning}</td>
                            <td className="space-y-1 px-3 py-3 text-xs leading-5 text-gray-500">
                              {synonyms.length > 0 && <p><span className="font-semibold text-gray-400">유의</span> {synonyms.join(' / ')}</p>}
                              {antonyms.length > 0 && <p><span className="font-semibold text-gray-400">반의</span> {antonyms.join(' / ')}</p>}
                              {similarWords.length > 0 && <p><span className="font-semibold text-gray-400">유사</span> {similarWords.join(' / ')}</p>}
                              {!synonyms.length && !antonyms.length && !similarWords.length ? <p className="text-gray-300">관련어 없음</p> : null}
                            </td>
                            <td className="px-3 py-3 text-xs leading-5 text-gray-400">
                              {item.sources.slice(0, 3).map(sourceLabel).join(' / ')}
                              {item.sources.length > 3 ? ` 외 ${item.sources.length - 3}` : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
