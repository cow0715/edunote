'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Protect local grade edits without changing Next.js history entries. */
export function UnsavedChangesGuard({ dirty, busy = false, preserveTabNavigation = false }: { dirty: boolean; busy?: boolean; preserveTabNavigation?: boolean }) {
  const [pendingLink, setPendingLink] = useState<HTMLAnchorElement | null>(null)
  const allowNavigation = useRef(false)
  useEffect(() => {
    if (!dirty && !busy) return
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    function protectLink(event: MouseEvent) {
      if (allowNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const destination = new URL(link.href, location.href)
      if (!['http:', 'https:'].includes(destination.protocol)) return
      if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setPendingLink(link)
    }
    // Chromium's Navigation API also allows cancellation of same-document Back/Forward.
    // Other browsers still receive the link and full-document unload protections above.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation
    function protectTraversal(event: Event) {
      if ((event as Event & { navigationType?: string }).navigationType !== 'traverse' || !event.cancelable || allowNavigation.current) return
      const destination = (event as Event & { destination?: { url: string; sameDocument: boolean } }).destination
      if (preserveTabNavigation && destination?.sameDocument) {
        const current = new URL(location.href), next = new URL(destination.url)
        current.searchParams.delete('tab'); next.searchParams.delete('tab')
        current.hash = ''; next.hash = ''
        if (current.href === next.href) return
      }
      if (busy || !window.confirm('저장하지 않은 채점 변경이 있습니다. 저장하지 않고 이동할까요?')) event.preventDefault()
    }
    document.addEventListener('click', protectLink, true)
    window.addEventListener('beforeunload', warn)
    navigation?.addEventListener('navigate', protectTraversal)
    return () => {
      document.removeEventListener('click', protectLink, true)
      window.removeEventListener('beforeunload', warn)
      navigation?.removeEventListener('navigate', protectTraversal)
    }
  }, [dirty, busy, preserveTabNavigation])
  return <Dialog open={pendingLink !== null} onOpenChange={open => { if (!open) setPendingLink(null) }}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>{busy ? '저장이 진행 중입니다' : '저장하지 않은 변경이 있습니다'}</DialogTitle>
        <DialogDescription>{busy ? '저장이 끝난 뒤 이동해 주세요.' : '이동하면 저장하지 않은 입력이 사라집니다. 계속 편집하거나 채점표에서 저장한 뒤 이동해 주세요.'}</DialogDescription></DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => setPendingLink(null)}>계속 편집</Button>
        {!busy && <Button onClick={() => {
          const link = pendingLink
          if (!link) return
          allowNavigation.current = true
          setPendingLink(null)
          link.click()
          // A different guard may cancel navigation; protect later attempts as well.
          queueMicrotask(() => { allowNavigation.current = false })
        }}>저장하지 않고 이동</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
