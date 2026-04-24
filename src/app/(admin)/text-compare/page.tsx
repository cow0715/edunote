'use client'

import { useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Printer,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react'

type DifficultyLevel = 'low' | 'low-medium' | 'medium' | 'medium-high' | 'high'

type TextCompareResult = {
  summary: {
    analyzedPassageCount: number
    totalQuestions: number
    avgSurfaceChangeScore: number
    avgStructureChangeScore: number
    avgExamAdaptationScore: number
    difficulty: DifficultyLevel
    topPatterns: string[]
    keyInsight: string
  }
  passages: {
    questionRange: string
    matchedOriginalLabel: string
    matchConfidence: number
    surfaceChangeScore: number
    structureChangeScore: number
    examAdaptationScore: number
    questionTypes: string[]
    modificationTypes: string[]
    hasNewlyAuthoredContent: boolean
    deletedContent: string[]
    addedContent: string[]
    evidenceComparisons: {
      original: string
      exam: string
      changeType: string
      commentary: string
    }[]
  }[]
  questionAnalysis: {
    typeDistribution: {
      type: string
      count: number
      percentage: number
    }[]
    difficultyDistribution: {
      high: number
      medium: number
      low: number
    }
    hardQuestions: {
      questionNumber: string
      reason: string
      relatedPassage: string
    }[]
  }
  teachingStrategy: {
    priority: number
    title: string
    description: string
    teacherTalkingPoint: string
  }[]
}

const difficultyLabel: Record<DifficultyLevel, string> = {
  low: '하',
  'low-medium': '중하',
  medium: '중',
  'medium-high': '중상',
  high: '상',
}

const difficultyTone: Record<DifficultyLevel, string> = {
  low: 'bg-blue-500/15 text-blue-700',
  'low-medium': 'bg-sky-500/15 text-sky-700',
  medium: 'bg-amber-500/15 text-amber-700',
  'medium-high': 'bg-orange-500/15 text-orange-700',
  high: 'bg-red-500/15 text-red-700',
}

function scoreTone(score: number) {
  if (score >= 75) return 'text-red-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-blue-600'
}

function scoreBarTone(score: number) {
  if (score >= 75) return 'from-red-500 to-orange-500'
  if (score >= 50) return 'from-amber-500 to-orange-400'
  return 'from-blue-500 to-sky-400'
}

function MetricBar({ score }: { score: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/70">
      <div
        className={cn('h-full rounded-full bg-gradient-to-r transition-all', scoreBarTone(score))}
        style={{ width: `${Math.max(6, Math.min(100, score))}%` }}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-[24px] bg-white/95 p-5 shadow-[0px_10px_40px_rgba(0,75,198,0.03)] ring-1 ring-blue-100/70">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{hint}</div>
    </div>
  )
}

function FileDropZone({
  label,
  description,
  file,
  onFile,
}: {
  label: string
  description: string
  file: File | null
  onFile: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function pick(nextFile: File | null) {
    if (!nextFile) return
    if (nextFile.type !== 'application/pdf') {
      toast.error('PDF 파일만 업로드할 수 있습니다.')
      return
    }
    onFile(nextFile)
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragOver(false)
        pick(event.dataTransfer.files[0] ?? null)
      }}
      className={cn(
        'group cursor-pointer rounded-[28px] border border-dashed p-6 transition-all',
        'bg-white/92 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]',
        dragOver
          ? 'border-[#2463EB] bg-blue-50/80'
          : 'border-slate-200 hover:border-blue-300 hover:bg-white'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => pick(event.target.files?.[0] ?? null)}
      />
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      {file ? (
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#2463EB]">
            <FileText className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-900">{file.name}</div>
            <div className="mt-1 text-sm text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="text-slate-500 hover:text-slate-900"
            onClick={(event) => {
              event.stopPropagation()
              onFile(null)
            }}
          >
            제거
          </Button>
        </div>
      ) : (
        <div className="rounded-[22px] bg-slate-50/80 p-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#2463EB] shadow-sm">
            <Upload className="h-6 w-6" />
          </div>
          <div className="mt-4 text-base font-semibold text-slate-900">{description}</div>
          <div className="mt-2 text-sm text-slate-500">클릭하거나 파일을 드래그해 업로드하세요.</div>
        </div>
      )}
    </div>
  )
}

function HeroSummary({ summary }: { summary: TextCompareResult['summary'] }) {
  return (
    <Card className="overflow-hidden rounded-[32px] border-0 bg-white/80 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
      <CardContent className="space-y-6 p-0">
        <div className="bg-[linear-gradient(180deg,#EBF3FF_0%,#FFFFFF_100%)] px-8 py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[#2463EB]">
                Exam Transformation Report
              </div>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 lg:text-4xl">
                시험 변형 분석
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600">
                {summary.keyInsight}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', difficultyTone[summary.difficulty])}>
                예상 난도 {difficultyLabel[summary.difficulty]}
              </Badge>
              <Button variant="outline" size="sm" className="rounded-full bg-white/80" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                인쇄
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-8 pb-8 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="분석 지문"
            value={`${summary.analyzedPassageCount}`}
            hint="시험 지문 묶음 기준"
          />
          <StatTile
            label="총 문항"
            value={`${summary.totalQuestions}`}
            hint="분석에 반영된 문제 수"
          />
          <StatTile
            label="표면 변형"
            value={`${summary.avgSurfaceChangeScore}`}
            hint="어휘·표현·어순 변화"
          />
          <StatTile
            label="시험형 가공"
            value={`${summary.avgExamAdaptationScore}`}
            hint="출제 목적 재구성 정도"
          />
        </div>

        <div className="flex flex-wrap gap-2 px-8 pb-8">
          {summary.topPatterns.map((pattern) => (
            <Badge
              key={pattern}
              variant="secondary"
              className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#2463EB]"
            >
              {pattern}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PassageCard({ passage }: { passage: TextCompareResult['passages'][number] }) {
  const [open, setOpen] = useState(false)

  const headline = useMemo(() => {
    if (passage.examAdaptationScore >= 75) return '시험형 재구성이 강한 지문'
    if (passage.structureChangeScore >= 60) return '구조 변형이 큰 지문'
    return '원문 기반 변형이 뚜렷한 지문'
  }, [passage.examAdaptationScore, passage.structureChangeScore])

  return (
    <Card className="rounded-[28px] border-0 bg-white/95 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
      <CardContent className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                {passage.questionRange}
              </Badge>
              {passage.questionTypes.map((type) => (
                <Badge key={type} variant="secondary" className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {type}
                </Badge>
              ))}
              {passage.hasNewlyAuthoredContent && (
                <Badge className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-700">
                  신규 문장 포함
                </Badge>
              )}
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">{headline}</div>
              <div className="mt-1 text-sm text-slate-500">
                매칭 원문: {passage.matchedOriginalLabel}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-[22px] bg-blue-50 px-4 py-3 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Match</div>
              <div className={cn('mt-1 text-2xl font-extrabold', scoreTone(passage.matchConfidence))}>
                {passage.matchConfidence}
              </div>
            </div>
            <Button
              variant="ghost"
              className="rounded-full text-slate-500 hover:text-slate-900"
              onClick={() => setOpen((prev) => !prev)}
            >
              {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">표면 변형</span>
              <span className={cn('font-bold', scoreTone(passage.surfaceChangeScore))}>{passage.surfaceChangeScore}</span>
            </div>
            <div className="mt-3">
              <MetricBar score={passage.surfaceChangeScore} />
            </div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">구조 변형</span>
              <span className={cn('font-bold', scoreTone(passage.structureChangeScore))}>{passage.structureChangeScore}</span>
            </div>
            <div className="mt-3">
              <MetricBar score={passage.structureChangeScore} />
            </div>
          </div>
          <div className="rounded-[22px] bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-600">시험형 가공</span>
              <span className={cn('font-bold', scoreTone(passage.examAdaptationScore))}>{passage.examAdaptationScore}</span>
            </div>
            <div className="mt-3">
              <MetricBar score={passage.examAdaptationScore} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {passage.modificationTypes.map((type) => (
            <Badge
              key={type}
              variant="secondary"
              className="rounded-full bg-[#2463EB]/10 px-3 py-1 text-xs font-semibold text-[#2463EB]"
            >
              {type}
            </Badge>
          ))}
        </div>

        {open && (
          <div className="grid gap-4 border-t border-slate-100 pt-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-[22px] bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-900">시험에서 빠진 핵심 내용</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {passage.deletedContent.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 text-red-500">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[22px] bg-slate-50 p-5">
                <div className="text-sm font-semibold text-slate-900">시험에서 추가·변형된 내용</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {passage.addedContent.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-1 text-[#2463EB]">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              {passage.evidenceComparisons.map((item, index) => (
                <div key={`${item.original}-${index}`} className="rounded-[22px] bg-slate-50 p-5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-xs">원문</Badge>
                    <div className="text-sm leading-6 text-slate-700">{item.original}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge className="rounded-full bg-[#2463EB]/15 px-2.5 py-0.5 text-xs font-semibold text-[#2463EB]">
                      시험
                    </Badge>
                    <div className="text-sm leading-6 text-slate-900">{item.exam}</div>
                  </div>
                  <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {item.changeType}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{item.commentary}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function QuestionAnalysisSection({ analysis }: { analysis: TextCompareResult['questionAnalysis'] }) {
  const totalDifficulty =
    analysis.difficultyDistribution.high +
    analysis.difficultyDistribution.medium +
    analysis.difficultyDistribution.low

  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <Card className="rounded-[28px] border-0 bg-white/95 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-2 text-slate-900">
            <Target className="h-5 w-5 text-[#2463EB]" />
            <div className="text-lg font-bold">문항 유형 분포</div>
          </div>
          <div className="space-y-4">
            {analysis.typeDistribution.map((item) => (
              <div key={item.type}>
                <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                  <span>{item.type}</span>
                  <span>{item.count}문항 · {item.percentage}%</span>
                </div>
                <MetricBar score={item.percentage} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="rounded-[28px] border-0 bg-white/95 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <CardContent className="space-y-4 p-6">
            <div className="text-lg font-bold text-slate-900">문항 난도 분포</div>
            {([
              ['상', analysis.difficultyDistribution.high],
              ['중', analysis.difficultyDistribution.medium],
              ['하', analysis.difficultyDistribution.low],
            ] as const).map(([label, count]) => {
              const percentage = totalDifficulty > 0 ? Math.round((count / totalDifficulty) * 100) : 0
              return (
                <div key={label}>
                  <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                    <span>{label}</span>
                    <span>{count}문항 · {percentage}%</span>
                  </div>
                  <MetricBar score={percentage} />
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white/95 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-slate-900">
              <AlertTriangle className="h-5 w-5 text-[#2463EB]" />
              <div className="text-lg font-bold">고난도 문항</div>
            </div>
            <div className="space-y-4">
              {analysis.hardQuestions.map((item) => (
                <div key={`${item.questionNumber}-${item.relatedPassage}`} className="rounded-[22px] bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{item.questionNumber}</div>
                    <Badge variant="secondary" className="rounded-full bg-white px-3 py-1 text-xs">
                      {item.relatedPassage}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StrategySection({ strategies }: { strategies: TextCompareResult['teachingStrategy'] }) {
  return (
    <div className="space-y-4">
      {strategies.map((item) => (
        <Card key={item.priority} className="rounded-[28px] border-0 bg-white/95 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <CardContent className="grid gap-4 p-6 lg:grid-cols-[80px_1fr_1fr] lg:items-start">
            <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-[linear-gradient(180deg,#2463EB_0%,#3B82F6_100%)] text-2xl font-extrabold text-white">
              {item.priority}
            </div>
            <div>
              <div className="text-xl font-bold text-slate-900">{item.title}</div>
              <div className="mt-3 text-sm leading-7 text-slate-600">{item.description}</div>
            </div>
            <div className="rounded-[22px] bg-blue-50/70 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#2463EB]">
                <Sparkles className="h-4 w-4" />
                설명회 멘트
              </div>
              <div className="mt-3 text-sm leading-7 text-slate-700">
                {item.teacherTalkingPoint}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function TextComparePage() {
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [examFile, setExamFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState<TextCompareResult | null>(null)

  async function uploadFile(file: File) {
    const presignResponse = await fetch('/api/pdf-extract/presign', { method: 'POST' })
    if (!presignResponse.ok) throw new Error('업로드 URL을 가져오지 못했습니다.')

    const { uploadUrl, path } = await presignResponse.json()
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    })

    if (!uploadResponse.ok) throw new Error('PDF 업로드에 실패했습니다.')
    return path as string
  }

  async function handleAnalyze() {
    if (!originalFile || !examFile) {
      toast.error('원문 PDF와 시험 PDF를 모두 선택해주세요.')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      setStatus('PDF 업로드 중...')
      const [originalPath, examPath] = await Promise.all([
        uploadFile(originalFile),
        uploadFile(examFile),
      ])

      setStatus('시험 지문을 원문에 매칭하는 중...')
      const response = await fetch('/api/text-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalPath, examPath }),
      })

      const payload = await response.json().catch(() => ({ error: '분석 응답을 읽지 못했습니다.' }))
      if (!response.ok) throw new Error(payload.error ?? '시험 변형 분석에 실패했습니다.')

      setResult(payload)
      toast.success('시험 변형 분석이 완료되었습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      toast.error(message)
    } finally {
      setLoading(false)
      setStatus('')
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#EBF3FF_0%,#FFFFFF_100%)]">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8 lg:px-10">
        <section className="rounded-[32px] bg-white/75 p-6 shadow-[0px_10px_40px_rgba(0,75,198,0.03)] ring-1 ring-white/70 backdrop-blur-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-[#2463EB]">
                Teaching Proof
              </div>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 lg:text-4xl">
                시험 변형 분석 리포트
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600">
                교과서 원문과 실제 시험지를 나란히 읽고, 지문이 어떻게 가공되었는지와 어떤 출제 포인트가
                점수를 갈랐는지를 즉시 리포트로 정리합니다.
              </p>
            </div>
            <div className="rounded-[24px] bg-blue-50/80 px-5 py-4 text-sm leading-6 text-slate-600">
              저장 없이 바로 분석하고, 업로드한 PDF는 분석 후 임시 버킷에서 삭제됩니다.
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <FileDropZone
              label="원문"
              description="교과서 또는 학습자료 PDF"
              file={originalFile}
              onFile={setOriginalFile}
            />
            <FileDropZone
              label="시험지"
              description="중간·기말고사 PDF"
              file={examFile}
              onFile={setExamFile}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {status}
              </div>
            )}
            <Button
              onClick={handleAnalyze}
              disabled={loading || !originalFile || !examFile}
              className="rounded-full bg-[#2463EB] px-6 py-6 text-sm font-semibold hover:bg-[#1f56ca]"
            >
              {loading ? '분석 중...' : '시험 변형 분석 시작'}
            </Button>
          </div>
        </section>

        {result && (
          <>
            <HeroSummary summary={result.summary} />

            <Tabs defaultValue="passages" className="space-y-4">
              <TabsList
                variant="line"
                className="w-full justify-start rounded-[24px] bg-white/90 p-2 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]"
              >
                <TabsTrigger value="passages" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-50 data-[state=active]:text-[#2463EB]">
                  지문별 변형 분석
                </TabsTrigger>
                <TabsTrigger value="questions" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-50 data-[state=active]:text-[#2463EB]">
                  문항 출제 분석
                </TabsTrigger>
                <TabsTrigger value="strategy" className="rounded-full px-5 py-2 data-[state=active]:bg-blue-50 data-[state=active]:text-[#2463EB]">
                  수업 전략
                </TabsTrigger>
              </TabsList>

              <TabsContent value="passages" className="space-y-4">
                {result.passages.map((passage) => (
                  <PassageCard key={`${passage.questionRange}-${passage.matchedOriginalLabel}`} passage={passage} />
                ))}
              </TabsContent>

              <TabsContent value="questions">
                <QuestionAnalysisSection analysis={result.questionAnalysis} />
              </TabsContent>

              <TabsContent value="strategy">
                <StrategySection strategies={result.teachingStrategy} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  )
}
