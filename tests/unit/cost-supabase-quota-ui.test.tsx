// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SupabaseQuota } from '@/app/(admin)/settings/costs/supabase-quota'
afterEach(cleanup)
const snapshot = { provider: 'supabase', metric: 'db_bytes_production', amount: 450_000_000, currency: 'BYTES', status: 'ok', updated_at: '2026-10-23T12:00:00Z' }
describe('Supabase quota display', () => {
  it('separates cached traffic and MAU with explicit manual provenance', () => {
    render(<SupabaseQuota environment="development" snapshots={[
      { ...snapshot, metric: 'console_egress_gb', amount: 4.5, currency: 'GB' },
      { ...snapshot, metric: 'console_cached_egress_gb', amount: 0, currency: 'GB' },
      { ...snapshot, metric: 'console_mau', amount: 2, currency: 'COUNT' },
    ]} />)
    expect(screen.getByText('4.5 / 5 GB · 90%')).toBeTruthy()
    expect(screen.getByText('0 / 5 GB · 0%')).toBeTruthy()
    expect(screen.getByText('2 / 50,000 명 · 0.1% 미만')).toBeTruthy()
    expect(screen.getByText(/콘솔 확인값 · 자동 갱신 미연결/)).toBeTruthy()
    expect(screen.getByText('임박 · 확인값')).toBeTruthy()
  })
  it('does not fabricate monthly usage when no console values exist', () => {
    render(<SupabaseQuota environment="production" snapshots={[]} />)
    expect(screen.getByRole('progressbar', { name: /월간 활성 사용자/ }).getAttribute('aria-valuenow')).toBeNull()
    expect(screen.getAllByText('미수집 · 0 사용으로 계산하지 않음')).toHaveLength(3)
  })
  it('uses the verified organization total regardless of the selected DB environment', () => {
    render(<SupabaseQuota environment="development" snapshots={[
      { ...snapshot, metric: 'storage_bytes_production', amount: 400_000_000 },
      { ...snapshot, metric: 'storage_bytes_development', amount: 500_000_000 },
      { ...snapshot, metric: 'storage_bytes_organization', amount: 900_000_000 },
    ]} />)
    expect(screen.getByRole('alert').textContent).toContain('Storage 90% · 임박')
    expect(screen.getByText(/운영 400 MB \+ 개발 500 MB/)).toBeTruthy()
    expect(screen.getByText(/100 MB 남음/)).toBeTruthy()
    expect(screen.queryByText(/조직 전체 잔여량은 확인 필요/)).toBeNull()
  })
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
