/** Callers must use a stable order (including a unique tie-breaker). */
export async function collectPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 500,
): Promise<T[]> {
  if (!Number.isInteger(size) || size < 1) throw new Error('Invalid page size')
  const rows: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(error.message)
    if (!data) throw new Error('목록 응답이 비어 있습니다')
    rows.push(...data)
    if (data.length < size) return rows
  }
}
