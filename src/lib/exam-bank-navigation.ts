export type BankTab = 'search' | 'list' | 'vocab' | 'import'
export function bankTab(value: string | null): BankTab {
  if (value === 'book') return 'import'
  return value === 'list' || value === 'vocab' || value === 'import' ? value : 'search'
}
export function mergeBankSearch(filterKey: string, currentSearch: string) {
  const params = new URLSearchParams(filterKey), current = new URLSearchParams(currentSearch)
  for (const key of ['tab', 'document', 'material']) { const value = current.get(key); if (value) params.set(key, value) }
  return params.toString()
}
