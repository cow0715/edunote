// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CostDashboard } from '@/app/(admin)/settings/costs/cost-dashboard'
import { vi } from 'vitest'

afterEach(() => { cleanup(); focusManager.setFocused(undefined); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup(fail = false, configured = false, snapshots: { provider: string; metric: string; amount: number | null; currency: string; status: string; updated_at: string }[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ message: '업체 조회 완료' })
    if (fail) return Response.json({ error: 'SQL 적용 필요' }, { status: 503 })
    return Response.json(url.includes('/sync') ? { snapshots, configured: configured ? ['claude'] : [] } : { entries: [], usage: [], tracking: false })
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><CostDashboard /></QueryClientProvider>)
  return client
}
describe('cost dashboard honest empty and failure states', () => {
  it('shows all six providers, currency separation and unregistered costs', async () => {
    const client = setup()
    await waitFor(() => expect(screen.getAllByText('미등록')).toHaveLength(2))
    for (const name of ['Vercel', 'Supabase', '네이버 CLOVA', 'Claude', 'SOLAPI', 'GCP']) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    expect(screen.getByText('KRW 등록 비용 합계')).toBeTruthy()
    expect(screen.getByText('USD 등록 비용 합계')).toBeTruthy()
    expect(screen.getByLabelText('금액')).toBeTruthy()
    client.clear()
  })
  it('shows a fetch failure without presenting empty data as zero costs', async () => {
    const client = setup(true)
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.queryByText('USD 등록 비용 합계')).toBeNull()
    client.clear()
  })
})

function requestCount(method: string, includes: string) {
  return vi.mocked(fetch).mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(includes)).length
}
describe('active cost dashboard refresh', () => {
  it('refreshes recorded usage every minute and providers every five minutes, then pauses when hidden', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    focusManager.setFocused(true)
    const client = setup(false, true)
    await waitFor(() => expect(requestCount('POST', '/sync')).toBe(1))
    const initialReads = requestCount('GET', '/api/admin/costs?')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    await waitFor(() => expect(requestCount('GET', '/api/admin/costs?')).toBeGreaterThan(initialReads))
    expect(requestCount('POST', '/sync')).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000) })
    await waitFor(() => expect(requestCount('POST', '/sync')).toBe(2))
    act(() => focusManager.setFocused(false))
    const reads = requestCount('GET', '/api/admin/costs?')
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(requestCount('GET', '/api/admin/costs?')).toBe(reads)
    expect(requestCount('POST', '/sync')).toBe(2)
    client.clear()
  })
  it('does not automatically poll a historical month but permits an explicit provider refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    focusManager.setFocused(true)
    const client = setup(false, true)
    await waitFor(() => expect(requestCount('POST', '/sync')).toBe(1))
    fireEvent.change(screen.getByLabelText('조회 월'), { target: { value: '2026-09' } })
    await waitFor(() => expect(screen.getByText(/과거 월은 새로고침/)).toBeTruthy())
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
    expect(requestCount('POST', '/sync')).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '업체 데이터 동기화' }))
    await waitFor(() => expect(requestCount('POST', '/sync')).toBe(2))
    const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(calls.at(-1)?.[1]?.body))).toEqual({ month: '2026-09' })
    client.clear()
  })
})

describe('provider cost overview', () => {
  it('puts Claude, CLOVA and GCP first and distinguishes a confirmed zero from missing data', async () => {
    const client = setup(false, false, [
      { provider: 'claude', metric: 'monthly_cost', amount: 27.75, currency: 'USD', status: 'ok', updated_at: '2026-10-22T12:00:00Z' },
      { provider: 'naver', metric: 'monthly_cost', amount: 0, currency: 'KRW', status: 'ok', updated_at: '2026-10-22T12:00:00Z' },
      { provider: 'gcp', metric: 'monthly_cost', amount: null, currency: 'KRW', status: 'error', updated_at: '2026-10-22T12:00:00Z' },
    ])
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Claude 조회액' })).getByText('US$27.75')).toBeTruthy())
    expect(within(screen.getByRole('region', { name: '네이버 CLOVA 조회액' })).getByText('₩0')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'GCP 조회액' })).getByText('조회값 없음')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'GCP 조회액' })).queryByText('₩0')).toBeNull()
    expect(screen.getAllByRole('region').map(node => node.getAttribute('aria-label'))).toEqual(['Claude 조회액', '네이버 CLOVA 조회액', 'GCP 조회액'])
    client.clear()
  })
})
