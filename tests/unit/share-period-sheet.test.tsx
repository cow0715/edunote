// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import ShareClient from '@/app/share/[token]/share-client'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/layout/theme-select', () => ({ ThemeSelect: () => null }))
vi.mock('@/app/share/[token]/use-share-model', () => ({
  useShareModel: () => ({
    wrongNoteGroups: [],
    vocabWrongGroups: [],
    studentAnswers: [],
    weekNumberByWeekId: new Map(),
    weekLabelByWeekId: new Map(),
    classes: [{ name: '테스트반' }],
    periodOptions: [
      { id: 'current', class_id: 'class', class_name: '테스트반', class_type: 'regular', label: '시즌', start_date: '2026-09-01', end_date: null, is_current: true, is_active_class: true, week_count: 2 },
      { id: 'past', class_id: 'class', class_name: '테스트반', class_type: 'regular', label: '이전', start_date: '2026-07-01', end_date: '2026-08-31', is_current: false, is_active_class: true, week_count: 1 },
    ],
  }),
}))
vi.mock('@/app/share/[token]/tabs/home-tab', () => ({ HomeTab: () => null }))
vi.mock('@/app/share/[token]/tabs/score-tab', () => ({ ScoreTab: () => null }))
vi.mock('@/app/share/[token]/tabs/analysis-tab', () => ({ AnalysisTab: () => null }))
vi.mock('@/app/share/[token]/tabs/vocab-tab', () => ({ VocabTab: () => null }))
vi.mock('@/app/share/[token]/tabs/wrongnote-tab', () => ({ WrongNoteTab: () => null }))
vi.mock('@/app/share/[token]/tag-drawer', () => ({ TagDrawer: () => null }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  navigation.push.mockReset()
})

describe('share period sheet keyboard access', () => {
  it('moves focus into the sheet, traps Tab, and restores the trigger on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        student: { id: 'student', name: '민지', school: '학교', grade: '3학년' },
        currentPeriod: { id: 'current', class_id: 'class', label: '시즌', start_date: '2026-09-01', end_date: null, is_current: true },
      }),
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const params = Promise.resolve({ token: 'test-token' })
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Suspense fallback={null}>
            <ShareClient params={params} />
          </Suspense>
        </QueryClientProvider>,
      )
      await params
    })

    const trigger = await screen.findByRole('button', { name: '기간 선택: 시즌' })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '기간 선택' })
    const options = dialog.querySelectorAll('button')
    expect(document.activeElement).toBe(options[0])

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(options[options.length - 1])
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(options[0])

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '기간 선택' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
