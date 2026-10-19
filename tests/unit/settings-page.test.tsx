// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SettingsPage from '@/app/(admin)/settings/page'
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: notices }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const profile = { id: 'teacher', name: '테스트 강사', academy_name: '기존 학원' }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>)
}
it('failed profile load hides editable fields and retries successfully', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValue(new Response(JSON.stringify(profile)))
  vi.stubGlobal('fetch', fetcher)
  mount()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByDisplayValue('기존 학원')).toBeTruthy()
})
it('rejects a whitespace-only teacher name before sending a save', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile)))
  vi.stubGlobal('fetch', fetcher)
  mount()
  const name = await screen.findByLabelText('담당 강사 이름 (필수)')
  fireEvent.change(name, { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(notices.error).toHaveBeenCalledWith('담당 강사 이름을 입력해 주세요')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keeps input and allows retry after saving fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profile))).mockResolvedValueOnce(new Response(JSON.stringify({ error: '저장 오류' }), { status: 500 })).mockResolvedValue(new Response(JSON.stringify(profile)))
  vi.stubGlobal('fetch', fetcher)
  mount()
  fireEvent.change(await screen.findByLabelText('학원명'), { target: { value: '변경 학원' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(notices.error).toHaveBeenCalledWith('저장 오류'))
  expect(screen.getByDisplayValue('변경 학원')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(notices.success).toHaveBeenCalledWith('저장되었습니다'))
})
