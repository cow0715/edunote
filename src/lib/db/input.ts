import { z } from 'zod'
import { SaveError } from './errors'

export const uuidInput = z.string().uuid()
export const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, '올바른 날짜가 필요합니다')
export const nullableDate = z.preprocess(value => value === '' ? null : value, dateInput.nullable())

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new SaveError('입력한 값이 올바르지 않습니다. 날짜와 필수 항목을 확인해 주세요.')
  return result.data
}

export async function readBody(request: Request): Promise<unknown> {
  if (!request.body) return {}
  try { return await request.json() } catch { throw new SaveError('요청 내용을 확인해 주세요.') }
}
