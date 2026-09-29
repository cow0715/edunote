'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export function ThemeSelect({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, forcedTheme, resolvedTheme } = useTheme()
  // 서버와 첫 클라이언트 렌더를 맞춘 뒤 저장된 기기 설정을 표시한다.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  const value = mounted ? theme ?? 'system' : 'system'
  const Icon = value === 'dark' ? Moon : value === 'light' ? Sun : Monitor
  const label = value === 'dark' ? '다크' : value === 'light' ? '라이트' : '기기 설정'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={!mounted || Boolean(forcedTheme)}
          aria-label={`화면 모드: ${label}`} title={value === 'system' ? `기기 설정을 따라 자동 전환 · 현재 ${resolvedTheme === 'dark' ? '다크' : '라이트'}` : `화면 모드: ${label}`}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${compact ? 'w-11 border border-border bg-card' : 'w-full border border-border bg-muted/50 px-3 text-sm font-medium text-foreground'}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          {!compact && <span>테마 · {label}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={value} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="system" className="min-h-11">기기 설정 (자동)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light" className="min-h-11">라이트</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="min-h-11">다크</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
