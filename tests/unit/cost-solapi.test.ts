import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ stats: vi.fn(), balance: vi.fn() }))
vi.mock('solapi', () => ({ SolapiMessageService: class { getStatistics = mocks.stats; getBalance = mocks.balance } }))
import { fetchSolapiBalance, parseSolapiBalance, fetchSolapiUsage, parseSolapiStatistics } from '@/lib/costs/solapi-connector'
const fixture = { balance: 0, deposit: 12652.2, point: 10, refund: { balance: 0, deposit: 49.5, point: 0 }, total: { total: 331, sms: 124, lms: 207 }, successed: { total: 330, sms: 124, lms: 206 }, failed: { total: 1, lms: 1 } }
afterEach(() => vi.clearAllMocks())
describe('SOLAPI provider statistics', () => {
  it('uses the wallet balance as returned without adding deposit or points to cash', async () => {
    expect(parseSolapiBalance({ balance: 19733, deposit: 5000, point: 120 })).toEqual({ balance: 19733, point_balance: 120 })
    expect(parseSolapiBalance({ balance: 0, point: 0 }).balance).toBe(0)
    expect(() => parseSolapiBalance({})).toThrow()
    expect(() => parseSolapiBalance({ balance: Infinity, point: 0 })).toThrow()
    mocks.balance.mockResolvedValue({ balance: 19733, point: 120 })
    expect(await fetchSolapiBalance()).toEqual({ balance: 19733, point_balance: 120 })
  })
  it('reads deposit spend, separates points and does not subtract refunds or double-count total', () => {
    expect(parseSolapiStatistics(fixture)).toMatchObject({ monthly_cost: 12652.2, message_total: 331, message_succeeded: 330, message_failed: 1, sms_succeeded: 330, sms_count: 124, lms_count: 206, cash_refund: 49.5, point_usage: 10 })
  })
  it('supports legacy cash amounts and a genuine zero but rejects missing or inconsistent data', () => {
    expect(parseSolapiStatistics({ ...fixture, balance: 100, deposit: undefined }).monthly_cost).toBe(100)
    expect(parseSolapiStatistics({ balance: 0, point: 0, total: {}, successed: {}, failed: {} }).monthly_cost).toBe(0)
    expect(() => parseSolapiStatistics({})).toThrow()
    expect(() => parseSolapiStatistics({ ...fixture, deposit: Infinity })).toThrow()
    expect(() => parseSolapiStatistics({ ...fixture, total: { total: 10 } })).toThrow('inconsistent_message_counts')
  })
  it('bounds the requested Korean month to now and uses an inclusive end without next-month overlap', async () => {
    mocks.stats.mockResolvedValue(fixture)
    await fetchSolapiUsage('2026-09', new Date('2026-10-22T00:00:00Z'))
    expect(mocks.stats).toHaveBeenLastCalledWith({ startDate: '2026-08-31T15:00:00.000Z', endDate: new Date('2026-09-30T14:59:59.999Z') })
    await fetchSolapiUsage('2026-10', new Date('2026-10-22T00:00:00Z'))
    expect(mocks.stats).toHaveBeenLastCalledWith({ startDate: '2026-09-30T15:00:00.000Z', endDate: new Date('2026-10-22T00:00:00Z') })
    await expect(fetchSolapiUsage('2026-11', new Date('2026-10-22T00:00:00Z'))).rejects.toThrow('future_month')
  })
})
