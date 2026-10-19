// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from '@/components/layout/theme-toggle'

const state = vi.hoisted(() => ({ resolvedTheme: undefined as string | undefined, setTheme: vi.fn() }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', resolvedTheme: state.resolvedTheme, setTheme: state.setTheme }) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('shared light/dark toggle', () => {
  it('hydrates a dark preference without a server/client mismatch', async () => {
    state.resolvedTheme = undefined
    const container = document.createElement('div')
    container.innerHTML = renderToString(<ThemeToggle />)
    document.body.append(container)
    state.resolvedTheme = 'dark'
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: Root | undefined
    try {
      await act(async () => { root = hydrateRoot(container, <ThemeToggle />) })
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/hydrated|hydration|didn't match/i)
      expect(container.querySelector('button')?.title).toBe('라이트 모드로 전환')
      expect(container.querySelector('button')?.disabled).toBe(false)
    } finally {
      await act(async () => root?.unmount())
      errors.mockRestore()
      container.remove()
    }
  })

  it.each(['light', 'dark'])('replaces a system preference with an explicit choice from %s', (resolvedTheme) => {
    state.resolvedTheme = resolvedTheme
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('switch', { name: '다크 모드' }))
    expect(state.setTheme).toHaveBeenCalledWith(resolvedTheme === 'dark' ? 'light' : 'dark')
    expect(screen.queryByText(/기기 설정/)).toBeNull()
  })
})
