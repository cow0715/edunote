export class SaveError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'SaveError'
  }
}

export function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  return 'cause' in error ? databaseErrorCode(error.cause) : undefined
}

// Do not log SQL, parameters, connection strings, or student data.
export function saveErrorResponse(error: unknown) {
  if (error instanceof SaveError) return Response.json({ error: error.message }, { status: error.status })
  const code = databaseErrorCode(error)
  if (code === '23505' || code === '40001' || code === '40P01' || code === '55P03') {
    return Response.json({ error: '다른 변경과 겹쳤습니다. 새로고침 후 다시 시도해 주세요.' }, { status: 409 })
  }
  if (['23514', '23502', '22007', '22008', '22P02', '22003'].includes(code ?? '')) {
    return Response.json({ error: '입력한 날짜나 값이 올바르지 않습니다.' }, { status: 400 })
  }
  console.error('[transaction save]', { code: code ?? 'unknown' })
  return Response.json({ error: '저장을 완료하지 못했습니다. 새로고침하여 결과를 확인해 주세요.' }, { status: 503 })
}
