type Page<T> = { data: T[] | null; count: number | null; error: { message: string } | null }

/** Never publish a partial clipboard result when a range fails or changes. */
export async function collectBankCopyRows<T extends { id: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
) {
  const data: T[] = [], ids = new Set<string>()
  let total: number | null = null
  do {
    const result = await fetchPage(data.length, data.length + 499)
    if (result.error) throw new Error(result.error.message)
    if (result.count == null || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('전체 문항 수를 확인하지 못했습니다.')
    if (total !== null && result.count !== total) throw new Error('조회 중 문항 수가 변경됐습니다. 다시 검색해 주세요.')
    total = result.count
    const rows = result.data ?? []
    if ((!rows.length && data.length < total) || data.length + rows.length > total) throw new Error('전체 문항 조회가 누락됐습니다. 다시 시도해 주세요.')
    for (const row of rows) {
      if (ids.has(row.id)) throw new Error('조회 중 중복 문항이 발견됐습니다. 다시 검색해 주세요.')
      ids.add(row.id)
      data.push(row)
    }
  } while (data.length < total)
  return { data, total }
}

export function assertCompleteBankCopy<T>(data: T[], total: unknown, expected: number): T[] {
  if (total !== expected || data.length !== expected) throw new Error('검색 결과와 복사할 문항 수가 다릅니다. 다시 검색해 주세요.')
  return data
}

/** Keep each HTTP response small as well as staying below the DB row limit. */
export async function fetchAllBankCopyRows<T extends { id: string }>(filterKey: string, expected: number, request: typeof fetch = fetch): Promise<T[]> {
  const result = await collectBankCopyRows<T>(async (from) => {
    const params = new URLSearchParams(filterKey)
    params.delete('all')
    params.set('limit', '200')
    params.set('page', String(from / 200))
    const response = await request(`/api/exam-bank/questions?${params}`)
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || '전체 조회 실패')
    if (!Array.isArray(json.data) || (json.data.length < 200 && from + json.data.length < expected)) throw new Error('전체 문항 조회가 누락됐습니다. 다시 시도해 주세요.')
    if (json.total != null && json.total !== expected) throw new Error('검색 결과가 변경됐습니다. 다시 검색해 주세요.')
    return { data: json.data, count: json.total ?? expected, error: null }
  })
  return assertCompleteBankCopy(result.data, result.total, expected)
}
