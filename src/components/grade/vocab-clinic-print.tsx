'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { VocabTestPrintSheet } from '@/components/grade/vocab-test-print-sheet'
import { VocabGradingPrintSheet } from '@/components/grade/vocab-grading-print-sheet'

type ClinicVocabItem = {
  id: string
  test_number: number
  prompt_text: string | null
  prompt_source: string | null
  vocab_word: {
    english_word: string
    correct_answer: string | null
  } | null
}

type ClinicVocabTest = {
  title: string
  createdAt?: string
  items: ClinicVocabItem[]
}

function loadDraft(draftKey: string | null) {
  if (!draftKey) return null
  const raw = localStorage.getItem(draftKey)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ClinicVocabTest
    if (!Array.isArray(parsed.items)) return null
    return parsed
  } catch {
    return null
  }
}

export function VocabClinicPrint({ mode }: { mode: 'student' | 'grading' }) {
  const [test, setTest] = useState<ClinicVocabTest | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = new URLSearchParams(window.location.search).get('draft')
      setTest(loadDraft(key))
      setLoaded(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    document.body.classList.add('bg-white')
    return () => document.body.classList.remove('bg-white')
  }, [])

  const items = useMemo(
    () => (test?.items ?? []).slice().sort((a, b) => a.test_number - b.test_number),
    [test?.items]
  )
  const isGrading = mode === 'grading'

  // 클리닉 draft 는 correct_answer 에 유형별 정답이 이미 계산돼 들어온다 (getPromptAnswer 참고)
  const sheetItems = useMemo(
    () => items.map((item) => ({
      id: item.id,
      test_number: item.test_number,
      prompt_source: item.prompt_source,
      prompt_text: item.prompt_text,
      display_word: item.prompt_text || item.vocab_word?.english_word || '',
      answer: item.vocab_word?.correct_answer || '-',
    })),
    [items]
  )

  function switchMode(nextMode: 'student' | 'grading') {
    const nextPath = nextMode === 'grading' ? 'clinic-grading-print' : 'clinic-print'
    const url = window.location.pathname.replace(/clinic(?:-grading)?-print$/, nextPath) + window.location.search
    window.location.href = url
  }

  if (!loaded) return <div className="p-8 text-sm text-gray-500">시험지를 불러오는 중...</div>
  if (!test || items.length === 0) {
    return <div className="p-8 text-sm text-red-500">시험지 데이터를 찾을 수 없습니다. 설정 탭에서 다시 인쇄해 주세요.</div>
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{test.title}</h1>
          <p className="text-xs text-gray-500">
            {items.length}문항 · {isGrading ? '채점용 인쇄' : 'A4 인쇄 전용'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => switchMode(isGrading ? 'student' : 'grading')}
          >
            {isGrading ? '시험지 보기' : '정답지 보기'}
          </Button>
          <Button onClick={() => window.print()}>인쇄</Button>
        </div>
      </div>

      {isGrading
        ? <VocabGradingPrintSheet items={sheetItems} />
        : <VocabTestPrintSheet items={sheetItems} />}
    </div>
  )
}
