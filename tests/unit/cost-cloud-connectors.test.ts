import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { fetchNaverCost, fetchVercelCost, naverSignature, parseFocusCharges } from '@/lib/costs/cloud-connectors'
import { billingQuery } from '@/lib/costs/gcp-connector'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('cloud billing adapters', () => {
  it('reads Vercel JSONL including credits and rejects malformed monetary values', () => {
    expect(parseFocusCharges('{"BilledCost":"20.5","BillingCurrency":"USD"}\n{"BilledCost":-5,"BillingCurrency":"USD"}\n')).toBe(15.5)
    expect(() => parseFocusCharges('{"BilledCost":"","BillingCurrency":"USD"}')).toThrow()
    expect(() => parseFocusCharges('{"BilledCost":10,"BillingCurrency":"KRW"}')).toThrow()
  })
  it('uses explicit team scope and Korean period for Vercel export', async () => {
    vi.stubEnv('VERCEL_BILLING_TEAM_ID', 'team_expected'); vi.stubEnv('VERCEL_BILLING_TOKEN', 'dummy')
    const mock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"BilledCost":"12","BillingCurrency":"USD"}\n'))
    vi.stubGlobal('fetch', mock)
    expect(await fetchVercelCost('2026-10')).toBe(12)
    expect(String(mock.mock.calls[0][0])).toContain('teamId=team_expected')
  })
  it('signs the exact Naver path and query', () => {
    const path = '/billing/v1/cost/getDemandCostList?startMonth=202610'
    expect(naverSignature(path, '123', 'access', 'secret')).toBe(createHmac('sha256', 'secret').update(`GET ${path}\n123\naccess`).digest('base64'))
    expect(naverSignature(path, '123', 'access', 'secret')).not.toBe(naverSignature(path + '1', '123', 'access', 'secret'))
  })
  it('does not label an unavailable Naver invoice as zero', async () => {
    vi.stubEnv('NCP_BILLING_ACCESS_KEY', 'dummy'); vi.stubEnv('NCP_BILLING_SECRET_KEY', 'dummy')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ getDemandCostListResponse: { returnCode: '0', totalRows: 0, demandCostList: [] } })))
    await expect(fetchNaverCost('2026-10')).rejects.toThrow('invoice_not_available')
  })
  it('uses this month VAT inclusive cost rather than cumulative arrears', async () => {
    vi.stubEnv('NCP_BILLING_ACCESS_KEY', 'dummy'); vi.stubEnv('NCP_BILLING_SECRET_KEY', 'dummy')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ getDemandCostListResponse: { returnCode: '0', totalRows: 1, demandCostList: [{ thisMonthAmountIncludingVat: 1100, totalDemandAmount: 9999, payCurrency: { code: 'KRW' } }] } })))
    expect(await fetchNaverCost('2026-10')).toBe(1100)
  })
  it('includes GCP credits, enforces project filtering and rejects SQL identifier injection', () => {
    const query = billingQuery('edunote-12345.billing.gcp_billing_export_v1_123')
    expect(query).toContain('UNNEST(credits)')
    expect(query).toContain('project.id = @project')
    expect(() => billingQuery('a.b.c`; DROP TABLE users;')).toThrow('invalid_billing_table')
  })
})
