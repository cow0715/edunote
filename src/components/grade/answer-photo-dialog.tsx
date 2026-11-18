'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AnswerPhotoDialog({ open, onOpenChange, url, title, allowPdf = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; url: string | null; title: string; allowPdf?: boolean
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  return <Dialog open={open && !!url} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false} className="flex max-h-[90dvh] flex-col gap-3 p-4 sm:max-w-[90vw]">
      <DialogHeader className="flex-row items-center justify-between gap-3 text-left">
        <div><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">확대한 원본 사진입니다. Esc 또는 닫기 버튼으로 답안 입력 화면에 돌아갑니다.</DialogDescription></div>
        <Button variant="ghost" size="icon" aria-label="원본 사진 닫기" onClick={() => onOpenChange(false)}><X /></Button>
      </DialogHeader>
      <div className="min-h-0 overflow-auto">{url && (allowPdf && failedImageUrl === url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center px-4 text-sm text-[var(--share-blue)]">원본 답안지 열기</a>
      ) : (
        // Signed student-upload URLs are displayed directly, without an image optimization proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={title} className="mx-auto max-h-[75dvh] max-w-full object-contain" onError={allowPdf ? () => setFailedImageUrl(url) : undefined} />
      ))}</div>
    </DialogContent>
  </Dialog>
}
