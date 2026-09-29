// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { ThemeSelect } from '@/components/layout/theme-select'

const route = vi.hoisted(() => ({ pathname: '/share/test' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))

beforeEach(() => {
  localStorage.clear()
  route.pathname = '/share/test'
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(),
  })) })
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => { cleanup(); document.documentElement.className = '' })

describe('appearance preference', () => {
  it('switches through the menu, persists the choice and restores it on another screen', async () => {
    const view = render(<ThemeProvider><ThemeSelect /></ThemeProvider>)
    fireEvent.keyDown(screen.getByRole('button', { name: /화면 모드/ }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '다크' }))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(localStorage.getItem('edunote-appearance')).toBe('dark')
    view.unmount()
    route.pathname = '/dashboard'
    render(<ThemeProvider><ThemeSelect /></ThemeProvider>)
    expect(screen.getByRole('button', { name: '화면 모드: 다크' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('button', { name: /화면 모드/ }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '라이트' }))
    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true))
    expect(localStorage.getItem('edunote-appearance')).toBe('light')
  })

  it('keeps print routes light without overwriting the saved preference', async () => {
    localStorage.setItem('edunote-appearance', 'dark')
    route.pathname = '/dashboard/class/weeks/week/answer-sheet/print'
    const view = render(<ThemeProvider><ThemeSelect /></ThemeProvider>)
    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem('edunote-appearance')).toBe('dark')
    route.pathname = '/share/test'
    view.rerender(<ThemeProvider><ThemeSelect /></ThemeProvider>)
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })
})
