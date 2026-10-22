// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CostDashboard } from '@/app/(admin)/settings/costs/cost-dashboard'
import { vi } from 'vitest'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup(fail = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (fail) return Response.json({ error: 'SQL 적용 필요' }, { status: 503 })
    return Response.json(url.includes('/sync') ? { snapshots: [], configured: [] } : { entries: [], usage: [], tracking: false })
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
