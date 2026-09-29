'use client'

import { usePathname } from 'next/navigation'
import { ThemeProvider as NextThemeProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // 출력물은 저장한 화면 모드를 바꾸지 않고 라이트로 유지한다.
  const isPrintPage = pathname.split('/').includes('print')
    || pathname.startsWith('/dev/vocab-print-preview')
    || pathname.startsWith('/report-cards/')
    || pathname.startsWith('/mock-exam-reports/')

  return (
    <NextThemeProvider attribute="class" storageKey="edunote-appearance"
      defaultTheme="system" enableSystem disableTransitionOnChange
      forcedTheme={isPrintPage ? 'light' : undefined}>
      {children}
    </NextThemeProvider>
  )
}
