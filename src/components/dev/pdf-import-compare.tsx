'use client'

import { useMemo, useRef, useState } from 'react'
import { errorMessage, runWithLoading } from '@/lib/async-ui'
import { AlertTriangle, FileText, Loader2, Play, RotateCcw, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { PdfImportCompareResponse, PdfImportCompareResult } from '@/app/api/dev/pdf-import-compare/route'

type CompareMode = 'direct-pdf' | 'local-text' | 'hybrid'

const MODES: Array<{ id: CompareMode; label: string; desc: string }> = [
  { id: 'direct-pdf', label: 'Direct PDF', desc: '원본 PDF chunk를 Claude에 바로 전달' },
  { id: 'local-text', label: 'Local Text', desc: 'unpdf 텍스트 추출 후 텍스트만 전달' },
  { id: 'hybrid', label: 'Hybrid', desc: '로컬 텍스트와 원본 PDF를 함께 전달' },
]

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatDuration(ms?: number) {
  if (!ms) return '-'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function getQuestionNumbers(result?: PdfImportCompareResult) {
  return result?.questions.map((question) => question.question_number).join(', ') || '-'
}

function ResultCard({ result }: { result: PdfImportCompareResult }) {
  return (
    <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-800 dark:shadow-[0px_10px_40px_rgba(0,0,0,0.4)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-bold text-[#1A1C1E] dark:text-slate-50">
            {MODES.find((mode) => mode.id === result.mode)?.label ?? result.mode}
          </CardTitle>
          <Badge variant={result.ok ? 'secondary' : 'destructive'}>{result.ok ? '완료' : '실패'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="text-xs font-medium text-[#8B95A1] dark:text-slate-400">시간</p>
            <p className="mt-1 text-xl font-extrabold text-[#2463EB] dark:text-blue-400">{formatDuration(result.durationMs)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
            <p className="text-xs font-medium text-[#8B95A1] dark:text-slate-400">문항</p>
            <p className="mt-1 text-xl font-extrabold text-[#1A1C1E] dark:text-slate-50">{result.questionCount}</p>
          </div>
        </div>

        {result.inputTokens !== undefined && (
          <div className="grid grid-cols-2 gap-3 text-xs text-[#8B95A1] dark:text-slate-400">
            <div>Input {result.inputTokens.toLocaleString()}</div>
            <div>Output {result.outputTokens?.toLocaleString() ?? '-'}</div>
          </div>
        )}

        {result.error && (
          <div className="flex gap-2 rounded-2xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{result.error}</span>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-[#8B95A1] dark:text-slate-400">문항 번호</p>
          <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {getQuestionNumbers(result)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function QuestionTable({ response }: { response: PdfImportCompareResponse }) {
  const modes = Object.keys(response.results) as CompareMode[]
  const numbers = useMemo(() => {
    const set = new Set<number>()
    for (const result of Object.values(response.results)) {
      result?.questions.forEach((question) => set.add(question.question_number))
    }
    return [...set].sort((a, b) => a - b)
  }, [response])

  return (
    <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-800">
      <CardHeader>
        <CardTitle className="text-base font-bold">문항 단위 비교</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-white/5">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#8B95A1]">번호</th>
              {modes.map((mode) => (
                <th key={mode} className="px-3 py-2 text-left text-xs font-semibold text-[#8B95A1]">
                  {MODES.find((item) => item.id === mode)?.label ?? mode}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {numbers.map((number) => (
              <tr key={number} className="border-b border-slate-50 last:border-0 dark:border-white/5">
                <td className="px-3 py-3 font-mono text-xs text-[#8B95A1]">{number}</td>
                {modes.map((mode) => {
                  const question = response.results[mode]?.questions.find((item) => item.question_number === number)
                  return (
                    <td key={mode} className="max-w-[280px] px-3 py-3 align-top">
                      {question ? (
                        <div className="space-y-1">
                          <p className="line-clamp-2 text-slate-800 dark:text-slate-100">{question.question_text || question.passage || '-'}</p>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline">{question.question_style}</Badge>
                            <Badge variant={question.needs_source_image ? 'destructive' : 'secondary'}>
                              {question.needs_source_image ? question.source_image_reason ?? 'image' : 'text'}
                            </Badge>
                            <Badge variant="outline">choices {question.choices?.length ?? 0}</Badge>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[#8B95A1]">-</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export default function PdfImportCompare() {
  const [file, setFile] = useState<File | null>(null)
  const [maxPages, setMaxPages] = useState(3)
  const [selectedModes, setSelectedModes] = useState<Set<CompareMode>>(new Set(['direct-pdf', 'local-text']))
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<PdfImportCompareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function toggleMode(mode: CompareMode) {
    setSelectedModes((prev) => {
      const next = new Set(prev)
      if (next.has(mode)) {
        if (next.size === 1) return prev
        next.delete(mode)
      } else {
        next.add(mode)
      }
      return next
    })
  }

  async function run() {
    if (!file || loading) return
    setError(null)
    setResponse(null)

    await runWithLoading(setLoading, async () => {
      const fileData = await fileToBase64(file)
      const res = await fetch('/api/dev/pdf-import-compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileData,
          mimeType: file.type,
          fileName: file.name,
          maxPages,
          modes: [...selectedModes],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'PDF 테스트 요청 실패')
      setResponse(json)
    }, (runError) => setError(errorMessage(runError, String(runError))))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#1A1C1E] dark:text-slate-50">PDF Import 비교</h1>
        <p className="mt-1 text-sm text-[#8B95A1] dark:text-slate-400">
          DB 저장 없이 Direct PDF, 로컬 텍스트 전처리, Hybrid 파싱 결과를 같은 PDF로 비교합니다.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-800">
          <CardHeader>
            <CardTitle className="text-base font-bold">입력 PDF</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={cn(
                'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed transition-colors',
                file
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                  : 'border-slate-200 bg-slate-50 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900',
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const dropped = event.dataTransfer.files[0]
                if (dropped) {
                  setFile(dropped)
                  setResponse(null)
                }
              }}
            >
              {file ? (
                <>
                  <FileText className="h-9 w-9 text-[#2463EB] dark:text-blue-400" />
                  <div className="text-center">
                    <p className="font-semibold text-[#1A1C1E] dark:text-slate-50">{file.name}</p>
                    <p className="text-xs text-[#8B95A1]">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-9 w-9 text-[#8B95A1]" />
                  <p className="text-sm font-medium text-[#8B95A1]">PDF를 클릭하거나 드래그해서 업로드</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const nextFile = event.target.files?.[0]
                if (nextFile) {
                  setFile(nextFile)
                  setResponse(null)
                }
              }}
            />
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 bg-white shadow-[0px_10px_40px_rgba(0,75,198,0.03)] dark:border dark:border-white/5 dark:bg-slate-800">
          <CardHeader>
            <CardTitle className="text-base font-bold">테스트 설정</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="pdf-import-max-pages">앞에서부터 테스트할 페이지 수</Label>
              <Input
                id="pdf-import-max-pages"
                type="number"
                min={1}
                max={20}
                value={maxPages}
                onChange={(event) => setMaxPages(Number(event.target.value))}
                className="rounded-2xl"
              />
            </div>

            <div className="space-y-3">
              {MODES.map((mode) => (
                <div key={mode.id} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-900">
                  <Checkbox
                    id={`pdf-import-${mode.id}`}
                    checked={selectedModes.has(mode.id)}
                    onCheckedChange={() => toggleMode(mode.id)}
                    className="mt-1"
                  />
                  <Label htmlFor={`pdf-import-${mode.id}`} className="cursor-pointer">
                    <span className="block text-sm font-semibold text-[#1A1C1E] dark:text-slate-50">{mode.label}</span>
                    <span className="block text-xs leading-5 text-[#8B95A1] dark:text-slate-400">{mode.desc}</span>
                  </Label>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                disabled={!file || loading || selectedModes.size === 0}
                onClick={run}
                className="flex-1 rounded-full bg-[#2463EB] text-white hover:bg-blue-700 active:scale-95"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                테스트 실행
              </Button>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setResponse(null)
                  setError(null)
                }}
                className="rounded-full"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="flex gap-2 rounded-3xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {response && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{response.fileName}</Badge>
            <Badge variant="secondary">원본 {response.originalPageCount}p</Badge>
            <Badge variant="secondary">테스트 {response.testedPageCount}p</Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {(Object.keys(response.results) as CompareMode[]).map((mode) => {
              const result = response.results[mode]
              return result ? <ResultCard key={mode} result={result} /> : null
            })}
          </div>

          <QuestionTable response={response} />

          {(Object.values(response.results) as PdfImportCompareResult[])
            .filter((result) => result?.extractedTextPreview)
            .map((result) => (
              <Card key={`${result.mode}-text`} className="rounded-3xl border-0 bg-white dark:border dark:border-white/5 dark:bg-slate-800">
                <CardHeader>
                  <CardTitle className="text-base font-bold">
                    {MODES.find((mode) => mode.id === result.mode)?.label} 추출 텍스트
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-80 overflow-auto rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {result.extractedTextPreview}
                  </pre>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  )
}
