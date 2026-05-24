'use client'

import { useEffect, useState } from 'react'
import { ExamQuestion } from '@/lib/types'

type SourceImagePreviewProps = {
  question: Pick<ExamQuestion, 'source_image_path' | 'needs_source_image' | 'source_page'>
  compact?: boolean
}

export function SourceImagePreview({ question, compact = false }: SourceImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(true)
  const [failed, setFailed] = useState(false)

  async function fetchSignedUrl() {
    if (!question.source_image_path) return null
    const response = await fetch(`/api/answer-sheet-url?path=${encodeURIComponent(question.source_image_path)}`)
    if (!response.ok) throw new Error('failed')
    const data = await response.json()
    return typeof data.url === 'string' ? data.url : null
  }

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)

    if (!question.source_image_path) return

    fetchSignedUrl()
      .then((nextUrl) => {
        if (active) setUrl(nextUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [question.source_image_path])

  async function openFreshSignedUrl() {
    try {
      const nextUrl = await fetchSignedUrl()
      if (!nextUrl) return
      setUrl(nextUrl)
      window.open(nextUrl, '_blank', 'noopener,noreferrer')
    } catch {
      setFailed(true)
    }
  }

  if (!question.source_image_path) {
    if (!question.needs_source_image) return null
    return (
      <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
        원본 이미지가 필요한 문항으로 표시됐지만 저장된 이미지가 없습니다. 시험지를 다시 가져오면 원본 페이지가 저장됩니다.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-slate-50/90 dark:bg-slate-950/40">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-300">
          원본 페이지{question.source_page ? ` ${question.source_page}` : ''}
        </span>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {isOpen ? '접기' : '보기'}
        </button>
      </div>
      {isOpen ? (
        <div className="px-3 pb-3">
          {url ? (
            <button type="button" onClick={openFreshSignedUrl} className="block w-full">
              <img
                src={url}
                alt="문항 원본 페이지"
                className={[
                  'w-full rounded-xl bg-white object-contain shadow-sm dark:bg-slate-900',
                  compact ? 'max-h-80' : 'max-h-[560px]',
                ].join(' ')}
              />
            </button>
          ) : (
            <div className="rounded-xl bg-white px-3 py-4 text-xs text-slate-400 shadow-sm dark:bg-slate-900 dark:text-slate-500">
              {failed ? '원본 이미지를 불러오지 못했습니다.' : '원본 이미지를 불러오는 중입니다.'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
