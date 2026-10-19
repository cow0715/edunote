// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { ThemeToggle } from '@/components/layout/theme-toggle'

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
  it('back-office toggle replaces system preference with explicit light/dark and persists it', async () => {
    localStorage.setItem('edunote-appearance', 'system')
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    const toggle = screen.getByRole('switch', { name: '다크 모드' })
    expect(screen.queryByRole('menuitemradio')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(localStorage.getItem('edunote-appearance')).toBe('dark')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(localStorage.getItem('edunote-appearance')).toBe('light')
  })

  it('persists the share toggle choice and restores it on another screen', async () => {
    const view = render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('switch', { name: '다크 모드' }))
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
    expect(localStorage.getItem('edunote-appearance')).toBe('dark')
    view.unmount()
    route.pathname = '/dashboard'
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    expect(screen.getByRole('switch', { name: '다크 모드' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: '다크 모드' }))
    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true))
    expect(localStorage.getItem('edunote-appearance')).toBe('light')
  })

  it('keeps print routes light without overwriting the saved preference', async () => {
    localStorage.setItem('edunote-appearance', 'dark')
    route.pathname = '/dashboard/class/weeks/week/answer-sheet/print'
    const view = render(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    await waitFor(() => expect(document.documentElement.classList.contains('light')).toBe(true))
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem('edunote-appearance')).toBe('dark')
    route.pathname = '/share/test'
    view.rerender(<ThemeProvider><ThemeToggle /></ThemeProvider>)
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })
})
