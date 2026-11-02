// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SmsSheet } from '@/components/grade/sms-sheet'
vi.mock('@/hooks/use-prompts', () => ({ usePrompt: () => ({ data: undefined }), useSavePrompt: () => ({ isPending: false, mutate: vi.fn() }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('applies a common message without AI and blocks sending a stale template with a footer recipient summary', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ class_name: '테스트반', week_label: '1주차', start_date: '2026-07-15', messages: [{ student_id: 's', student_name: '학생1', mother_phone: '01000000000', father_phone: null, phone: null, message: '', student_data: null }] }) })
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SmsSheet weekId="w" weekNumber={1} /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '문자 발송' }))
  const template = await screen.findByRole('textbox', { name: '공통 문자 문구' })
  fireEvent.change(template, { target: { value: '이번 주 복습 안내입니다.' } })
  expect((screen.getByRole('button', { name: '전체 발송' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '학생별 문자에 적용' }))
  expect((screen.getByRole('textbox', { name: '학생1 발송 내용' }) as HTMLTextAreaElement).value).toContain('이번 주 복습 안내입니다.')
  const send = screen.getByRole('button', { name: '전체 발송' }) as HTMLButtonElement
  expect(send.closest('footer')?.getAttribute('aria-label')).toBe('최종 발송')
  expect(screen.getByText('학생 1명 · 수신자 1건')).toBeTruthy()
  expect(send.disabled).toBe(false)
  fireEvent.change(template, { target: { value: '바뀐 공통 문구' } })
  expect(send.disabled).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
