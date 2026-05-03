type SupabaseLike = {
  from: (table: string) => ClassPeriodTable
}

type QueryError = { message?: string } | null

type CurrentPeriodRow = { id: string; start_date: string; end_date: string | null }

type QueryResult<T> = {
  data: T[] | null
  error: QueryError
}

type UpdateResult = {
  error: QueryError
}

type UpdateQuery = {
  eq: (column: string, value: string) => UpdateQuery & PromiseLike<UpdateResult>
}

type ClassPeriodSelectQuery = PromiseLike<QueryResult<CurrentPeriodRow>> & {
  eq: (column: string, value: string | boolean) => ClassPeriodQuery
  neq: (column: string, value: string) => ClassPeriodQuery
}

type ClassPeriodQuery = ClassPeriodSelectQuery

type ClassPeriodTable = {
  select: (columns: string) => ClassPeriodQuery
  update: (values: Record<string, unknown>) => UpdateQuery
}

export function previousDate(startDate: string): string {
  const d = new Date(`${startDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function closeCurrentPeriods(
  supabaseClient: unknown,
  classId: string,
  newStartDate: string,
  exceptPeriodId?: string,
) {
  const supabase = supabaseClient as SupabaseLike
  let query = supabase
    .from('class_period')
    .select('id, start_date, end_date')
    .eq('class_id', classId)
    .eq('is_current', true)

  if (exceptPeriodId) query = query.neq('id', exceptPeriodId)

  const { data: currentPeriods, error: fetchError } = await query
  if (fetchError) return fetchError

  const endDate = previousDate(newStartDate)
  for (const period of currentPeriods ?? []) {
    const patch: Record<string, unknown> = { is_current: false }
    if ((!period.end_date || period.end_date >= newStartDate) && endDate >= period.start_date) {
      patch.end_date = endDate
    }

    const { error } = await supabase
      .from('class_period')
      .update(patch)
      .eq('id', period.id)

    if (error) return error
  }

  return null
}
