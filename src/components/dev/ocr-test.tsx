'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Upload, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import type { OcrTestResult } from '@/app/api/dev/ocr-test/route'

// ── 테스트 목록 ─────────────────────────────────────────────────────────
const TEST_OPTIONS = [
  { id: 'clova',                  label: 'CLOVA General',              desc: '현재 사용 중' },
  { id: 'claude-haiku',           label: 'Claude Haiku Vision',        desc: '빠름 · 저렴' },
  { id: 'claude-sonnet',          label: 'Claude Sonnet Vision',       desc: '현재 fallback' },
  { id: 'claude-sonnet-enhanced', label: 'Claude Sonnet Vision +힌트', desc: '손글씨 프롬프트 강화' },
  { id: 'clova-claude',           label: 'CLOVA + Claude 검증',        desc: 'CLOVA 텍스트 + 이미지 같이 전달' },
  { id: 'google',                 label: 'Google Cloud Vision',        desc: '손글씨 특화' },
] as const

type TestId = (typeof TEST_OPTIONS)[number]['id']

// 모든 테스트의 항목을 합쳐 문항 번호 목록을 구성
function collectNumbers(results: Record<string, OcrTestResult>): number[] {
  const set = new Set<number>()
  for (const r of Object.values(results)) {
    r.items?.forEach((i) => set.add(i.number))
  }
  return [...set].sort((a, b) => a - b)
}

// 다수결로 "정답 추정값" 계산 → 소수인 값을 빨간색으로 표시
function majority(values: (string | null)[]): string | null {
  const freq = new Map<string | null, number>()
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1)
  let max = 0
  let result: string | null = null
  for (const [val, cnt] of freq) {
    if (cnt > max) { max = cnt; result = val }
  }
  return result
}

export default function OcrTest() {
  const [selectedTests, setSelectedTests] = useState<Set<TestId>>(
    new Set(['clova', 'claude-sonnet', 'clova-claude', 'google'])
  )
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [fileData, setFileData] = useState<string | null>(null)
  const [mimeType, setMimeType] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, OcrTestResult> | null>(null)
  const [expandedRaw, setExpandedRaw] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  function toggleTest(id: TestId) {
    setSelectedTests((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleFile(file: File) {
    setResults(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setImagePreview(dataUrl)
      // base64 부분만 추출
      const base64 = dataUrl.split(',')[1]
      setFileData(base64)
      setMimeType(file.type)
    }
    reader.readAsDataURL(file)
  }

  async function runTests() {
    if (!fileData || selectedTests.size === 0) return
    setLoading(true)
    setResults(null)
    try {
      const res = await fetch('/api/dev/ocr-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData, mimeType, tests: [...selectedTests] }),
      })
      const json = await res.json()
      setResults(json.results)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function toggleRaw(id: string) {
    setExpandedRaw((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const activeTests = results ? (Object.keys(results) as string[]) : []
  const numbers = results ? collectNumbers(results) : []

  return (
    <div className="space-y-6 max-w-full">
      <div>
        <h1 className="text-xl font-semibold">OCR 성능 테스트</h1>
        <p className="text-sm text-muted-foreground mt-1">단어 시험지 사진을 업로드하고 OCR 엔진별 결과를 비교합니다.</p>
      </div>

      {/* 업로드 + 테스트 선택 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 이미지 업로드 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">시험지 이미지</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 transition-colors"
              style={{ minHeight: 180 }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            >
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="preview" className="max-h-48 object-contain rounded" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
                  <Upload className="h-8 w-8" />
                  <span className="text-sm">클릭 또는 드래그해서 업로드</span>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </CardContent>
        </Card>

        {/* 테스트 선택 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">테스트 선택</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {TEST_OPTIONS.map(({ id, label, desc }) => (
              <div key={id} className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={selectedTests.has(id)}
                  onCheckedChange={() => toggleTest(id)}
                  className="mt-0.5"
                />
                <Label htmlFor={id} className="cursor-pointer leading-snug">
                  <span className="font-medium text-sm">{label}</span>
                  <span className="block text-xs text-muted-foreground">{desc}</span>
                </Label>
              </div>
            ))}

            <Button
              className="w-full mt-2"
              disabled={!fileData || selectedTests.size === 0 || loading}
              onClick={runTests}
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />테스트 중...</>
              ) : (
                `${selectedTests.size}개 테스트 실행`
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 결과 */}
      {results && (
        <div className="space-y-4">

          {/* 소요 시간 */}
          <div className="flex flex-wrap gap-2">
            {activeTests.map((id) => {
              const r = results[id]
              const label = TEST_OPTIONS.find((t) => t.id === id)?.label ?? id
              return (
                <Badge key={id} variant={r.error ? 'destructive' : 'secondary'} className="text-xs">
                  {label}: {r.error ? '오류' : `${(r.ms / 1000).toFixed(1)}s`}
                </Badge>
              )
            })}
          </div>

          {/* 비교 테이블 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">결과 비교</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">번호</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">영단어</th>
                    {activeTests.map((id) => (
                      <th key={id} className="text-left py-2 pr-4 font-medium whitespace-nowrap">
                        {TEST_OPTIONS.find((t) => t.id === id)?.label ?? id}
                        {results[id].error && (
                          <span className="block text-xs font-normal text-destructive">{results[id].error}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((num) => {
                    const values = activeTests.map((id) =>
                      results[id].items?.find((i) => i.number === num)?.student_answer ?? null
                    )
                    const maj = majority(values)
                    return (
                      <tr key={num} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 text-muted-foreground">{num}</td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {results[activeTests[0]]?.items?.find((i) => i.number === num)?.english_word ?? '-'}
                        </td>
                        {activeTests.map((id, idx) => {
                          const val = values[idx]
                          const isMinority = val !== maj
                          return (
                            <td key={id} className="py-2 pr-4">
                              {results[id].error ? (
                                <span className="text-muted-foreground text-xs">-</span>
                              ) : val === null ? (
                                <span className="text-muted-foreground text-xs italic">판독불가</span>
                              ) : val === '' ? (
                                <span className="text-muted-foreground text-xs italic">미기재</span>
                              ) : (
                                <span className={isMinority ? 'text-red-500 font-medium' : ''}>
                                  {val}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                빨간색 = 다수결과 다른 결과 (오인식 의심)
              </p>
            </CardContent>
          </Card>

          {/* RAW 텍스트 (CLOVA / Google) */}
          {activeTests
            .filter((id) => results[id].rawText)
            .map((id) => {
              const label = TEST_OPTIONS.find((t) => t.id === id)?.label ?? id
              const expanded = expandedRaw.has(id)
              return (
                <Card key={id}>
                  <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleRaw(id)}>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{label} — 원본 OCR 텍스트</CardTitle>
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </CardHeader>
                  {expanded && (
                    <CardContent>
                      <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap overflow-x-auto">
                        {results[id].rawText}
                      </pre>
                    </CardContent>
                  )}
                </Card>
              )
            })}
        </div>
      )}
    </div>
  )
}
