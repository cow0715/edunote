// @vitest-environment jsdom
import Link from 'next/link'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UnsavedChangesGuard } from '@/components/grade/unsaved-changes-guard'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('can cancel a same-tab route link and removes guards after unmount', () => {
  const view = render(<><Link href="/students">학생 관리로</Link><UnsavedChangesGuard dirty /></>)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(screen.getByRole('link'), event)
  expect(event.defaultPrevented).toBe(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '계속 편집' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  view.unmount()
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(false)
})
it('protects cancellable browser history traversal as well as links', () => {
  const navigation = new EventTarget()
  vi.stubGlobal('navigation', navigation)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<UnsavedChangesGuard dirty />)
  const event = new Event('navigate', { cancelable: true })
  Object.defineProperty(event, 'navigationType', { value: 'traverse' })
  navigation.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  vi.restoreAllMocks()
})

it('allows preserved tab history but still protects another page with unsaved edits', () => {
  const navigation = new EventTarget()
  vi.stubGlobal('navigation', navigation)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<UnsavedChangesGuard dirty preserveTabNavigation />)
  const tab = new Event('navigate', { cancelable: true })
  Object.defineProperties(tab, { navigationType: { value: 'traverse' }, destination: { value: { url: `${location.origin}${location.pathname}?tab=grade`, sameDocument: true } } })
  navigation.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false)
  expect(confirm).not.toHaveBeenCalled()
  const away = new Event('navigate', { cancelable: true })
  Object.defineProperties(away, { navigationType: { value: 'traverse' }, destination: { value: { url: `${location.origin}/students`, sameDocument: true } } })
  navigation.dispatchEvent(away)
  expect(away.defaultPrevented).toBe(true)
  vi.restoreAllMocks()
})
