// Published Free plan allowances, checked 2026-10-23. Decimal MB/GB.
// DB is per project; Storage is shared across the organization.
export const SUPABASE_FREE_DB_BYTES = 500_000_000
export const SUPABASE_FREE_STORAGE_BYTES = 1_000_000_000
export function quotaUsage(amount: number | null | undefined, limit: number) {
  if (amount == null || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(limit) || limit <= 0) return null
  const percent = amount / limit * 100
  return { percent: Math.floor(percent * 10) / 10, bar: Math.min(100, percent), remaining: Math.max(0, limit - amount),
    level: percent >= 100 ? '초과' : percent >= 90 ? '임박' : percent >= 80 ? '주의' : '여유', warning: percent >= 80 }
}
