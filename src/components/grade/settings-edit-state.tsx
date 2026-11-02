'use client'
import { createContext, useContext, useEffect } from 'react'

export type SettingsEditState = { dirty: boolean; busy: boolean }
export const SettingsEditContext = createContext<((panel: string, state: SettingsEditState) => void) | null>(null)

/** Optional registration keeps these panels usable outside the week settings dialog. */
export function useSettingsEditState(panel: string, dirty: boolean, busy = false) {
  const report = useContext(SettingsEditContext)
  useEffect(() => { report?.(panel, { dirty, busy }) }, [report, panel, dirty, busy])
  useEffect(() => () => { report?.(panel, { dirty: false, busy: false }) }, [report, panel])
}
