'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

/** Back-office control: the first toggle also replaces a saved system preference. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { resolvedTheme, setTheme, forcedTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <button type="button" role={compact ? undefined : "switch"} aria-label={compact ? (dark ? "라이트 모드로 전환" : "다크 모드로 전환") : "다크 모드"} aria-checked={compact ? undefined : dark}
      disabled={!mounted || Boolean(forcedTheme)}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border border-border bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${compact ? "min-w-11 rounded-xl px-2" : "rounded-full px-3"}`}>
      {dark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
      {!compact && <span className={`flex h-6 w-10 items-center rounded-full p-0.5 ${dark ? 'bg-foreground/25' : 'bg-muted'}`} aria-hidden>
        <span className={`size-5 rounded-full bg-foreground transition-transform motion-reduce:transition-none ${dark ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>}
    </button>
  )
}
