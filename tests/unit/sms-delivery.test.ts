import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('solapi', () => ({ SolapiMessageService: class { send = m.send } }))
import { sendMessages } from '@/lib/solapi'
beforeEach(() => { vi.clearAllMocks() })
const target = { studentId: 'synthetic', studentName: '가상', recipientLabel: '학생', phone: '000-0000-0000', message: '무료 회귀 검증' }
it('preserves successful sends when another recipient fails', async () => {
  m.send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('일시 장애'))
  const results = await sendMessages([target, { ...target, studentId: 'other' }])
  expect(results.map(r => r.success)).toEqual([true, false])
  expect(results[1].error).toBe('일시 장애')
})
it('treats provider-declared failures as failures even when its request resolves', async () => {
  m.send.mockResolvedValue({ failedMessageList: [{ statusMessage: '잘못된 번호' }] })
  expect((await sendMessages([target]))[0]).toMatchObject({ success: false, error: '잘못된 번호' })
})
it('passes the scheduled time and normalizes phone formatting without real provider calls', async () => {
  m.send.mockResolvedValue({})
  await sendMessages([{ ...target, scheduledDate: '2026-10-20T09:00:00+09:00' }])
  expect(m.send).toHaveBeenCalledWith([expect.objectContaining({ to: '00000000000', text: target.message })], { scheduledDate: '2026-10-20T09:00:00+09:00' })
})
