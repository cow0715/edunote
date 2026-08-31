'use client'

import { useCallback, useEffect, useState } from 'react'

/** 공유 화면 다크모드 — localStorage 우선, 없으면 OS 설정 */
export function useShareTheme() {
  const [isDark, setIsDark] = useState(false)
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = localStorage.getItem('share-theme')
      if (saved) {
        setIsDark(saved === 'dark')
      } else {
        setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
      setThemeReady(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev
      localStorage.setItem('share-theme', next ? 'dark' : 'light')
      return next
    })
  }, [])

  return { isDark, themeReady, toggleTheme }
}
