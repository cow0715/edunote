// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SupabaseQuota } from '@/app/(admin)/settings/costs/supabase-quota'
afterEach(cleanup)
const snapshot = { provider: 'supabase', metric: 'db_bytes_production', amount: 450_000_000, currency: 'BYTES', status: 'ok', updated_at: '2026-10-23T12:00:00Z' }
describe('Supabase quota display', () => {
  it('alerts on nearing the DB limit and excludes other environments', () => {
    render(<SupabaseQuota environment="production" snapshots={[snapshot, { ...snapshot, metric: 'db_bytes_development', amount: 10 }]} />)
    expect(screen.getByRole('alert').textContent).toContain('DB 90% · 임박')
    expect(screen.getByText(/50 MB 남음/)).toBeTruthy()
  })
  it('does not claim organization headroom from a single project or missing data', () => {
    render(<SupabaseQuota environment="production" snapshots={[{ ...snapshot, metric: 'storage_bytes_production', amount: 100_000_000 }]} />)
    expect(screen.getByText('프로젝트 사용분')).toBeTruthy()
    expect(screen.getByText(/조직 전체 잔여량은 확인 필요/)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: /DB 무료/ }).getAttribute('aria-valuenow')).toBeNull()
    expect(screen.queryByText('여유')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('labels a failed refresh instead of presenting the old value as fresh', () => {
    render(<SupabaseQuota environment="production" snapshots={[{ ...snapshot, status: 'error' }]} />)
    expect(screen.getByRole('alert').textContent).toContain('(이전 값)')
    expect(screen.getByText('갱신 실패 · 이전 값')).toBeTruthy()
  })
})
