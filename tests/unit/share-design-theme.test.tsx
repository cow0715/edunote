// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ShareDesignFrame from '@/app/dev/share-design/frame/share-design-frame'
import { ThemeProvider } from '@/components/providers/theme-provider'

vi.mock('next/navigation', () => ({ usePathname: () => '/dev/share-design/frame', useRouter: () => ({}), useSearchParams: () => new URLSearchParams('design=latest&theme=light&scenario=default') }))
vi.mock('@/app/share/[token]/share-client', async () => {
  const { ThemeToggle } = await import('@/components/layout/theme-toggle')
  return { ShareReport: () => <ThemeToggle />, ShareLoadState: () => null, useShareData: vi.fn() }
})
vi.mock('@/components/dev/share-design-samples', () => ({ getShareDesignSample: () => ({}) }))
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.className = '' })

it('initializes the preview from its URL without overriding later header toggles', async () => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })) })
  render(<ThemeProvider><ShareDesignFrame /></ThemeProvider>)
  const toggle = screen.getByRole('switch', { name: '다크 모드' })
  await waitFor(() => expect(localStorage.getItem('edunote-share-design-appearance')).toBe('light'))
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
  expect(localStorage.getItem('edunote-share-design-appearance')).toBe('dark')
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  expect(localStorage.getItem('edunote-share-design-appearance')).toBe('light')
})
