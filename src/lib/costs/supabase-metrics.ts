// Only retain aggregate infrastructure gauges; never persist SQL or arbitrary labels.
export function parseSupabaseMetrics(text: string) {
  const names = new Set(['node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes', 'pg_stat_database_num_backends', 'max_connections_connection_count'])
  const gauges = new Map<string, number[]>()
  for (const line of text.split('\n')) {
    const match = /^([a-zA-Z_:][\w:]*)(?:\{[^\n]*\})?\s+([^\s]+)(?:\s+\d+)?\s*$/.exec(line)
    if (!match || !names.has(match[1])) continue
    const number = Number(match[2])
    if (!Number.isFinite(number) || number < 0) throw new Error('invalid_metrics')
    gauges.set(match[1], [...(gauges.get(match[1]) ?? []), number])
  }
  const one = (name: string) => { const values = gauges.get(name); return values?.length === 1 ? values[0] : undefined }
  const total = one('node_memory_MemTotal_bytes'), available = one('node_memory_MemAvailable_bytes')
  const limit = one('max_connections_connection_count'), connections = gauges.get('pg_stat_database_num_backends')
  if (total === undefined || available === undefined || available > total || !total || limit === undefined || !connections?.length) throw new Error('missing_metrics')
  return { memory_used_bytes: total - available, memory_total_bytes: total, connections: connections.reduce((sum, n) => sum + n, 0), connection_limit: limit }
}

export async function fetchSupabaseMetrics() {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  // Credentials must only be sent to the configured hosted Supabase project.
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) throw new Error('invalid_metrics_host')
  url.pathname = '/customer/v1/privileged/metrics'; url.search = ''; url.hash = ''
  const response = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`service_role:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).toString('base64')}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.body) throw new Error('metrics_unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let text = '', size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > 2_000_000) throw new Error('metrics_too_large')
      text += decoder.decode(next.value, { stream: true })
    }
    return parseSupabaseMetrics(text + decoder.decode())
  } finally { await reader.cancel().catch(() => {}) }
}
