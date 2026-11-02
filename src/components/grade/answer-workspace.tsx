'use client'

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'

const query = '(min-width: 1200px)'
function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(query)
  media?.addEventListener('change', onChange)
  return () => media?.removeEventListener('change', onChange)
}
function desktopSnapshot() { return window.matchMedia?.(query).matches ?? false }
function serverSnapshot() { return false }

/** One editor instance: a connected desktop pane, or a focused sheet on narrow screens. */
export function AnswerWorkspace({ open, busy, onClose, children, description = '학생 답안을 입력하고 이전 또는 다음 학생으로 이동합니다.' }: {
  open: boolean
  busy: boolean
  onClose: () => void
  description?: string
  children: ReactNode
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot)
  const pane = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!desktop || !open || !pane.current) return
    const element = pane.current
    // Fit the pane in the visible part of the main scroller, including its
    // summary above. Keep the save indicator and footer on screen.
    const resize = () => {
      const top = Math.max(16, element.getBoundingClientRect().top)
      element.style.height = `${Math.max(280, window.innerHeight - top - 16)}px`
    }
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', resize, true)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', resize, true)
    }
  }, [desktop, open])
  if (!open) return null
  if (desktop) return (
    <section ref={pane} aria-label="학생 답안 채점" aria-busy={busy}
      onKeyDown={event => {
        // Nested dialogs/popovers handle Escape themselves; never close their parent editor.
        if (event.key === 'Escape' && !event.defaultPrevented && !busy && !(event.target as HTMLElement).closest('[role="dialog"], [role="listbox"]')) onClose()
      }}
      className="scroll-mt-4 sticky top-4 flex h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-background">
      {children}
    </section>
  )
  return <Sheet open onOpenChange={value => { if (!value) onClose() }}>
    <SheetContent showCloseButton={false} aria-busy={busy} className="w-full sm:w-[600px] sm:max-w-[600px] p-0 gap-0 overflow-y-auto shadow-none">
      <SheetTitle className="sr-only">학생 답안 채점</SheetTitle>
      <SheetDescription className="sr-only">{description}</SheetDescription>
      {children}
    </SheetContent>
  </Sheet>
}
