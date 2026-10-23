import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSupabaseMetrics, parseSupabaseMetrics } from '@/lib/costs/supabase-metrics'

const sample = `# HELP ignored
node_memory_MemTotal_bytes{service_type="db"} 4e8
node_memory_MemAvailable_bytes{service_type="db"} 1e8
max_connections_connection_count{server="localhost"} 60
pg_stat_database_num_backends{datname="postgres"} 4
pg_stat_database_num_backends{datname="template1"} 0
pg_stat_database_num_backends{datname="other"} 2
private_query{query="sensitive"} 5`
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('Supabase official gauges', () => {
  it('keeps only selected aggregates and sums database connections', () => {
    expect(parseSupabaseMetrics(sample)).toEqual({ memory_used_bytes: 3e8, memory_total_bytes: 4e8, connections: 6, connection_limit: 60 })
  })
  it.each([sample.replace('1e8', '5e8'), sample.replace('1e8', 'NaN'), sample.replace('1e8', '-1'), sample.replace(' 60', ' +Inf'), ''])('rejects invalid or incomplete samples instead of showing zero', text => {
    expect(() => parseSupabaseMetrics(text)).toThrow()
  })
  it('does not choose arbitrarily among duplicated memory series', () => {
    expect(() => parseSupabaseMetrics(sample + '\nnode_memory_MemTotal_bytes 10')).toThrow()
  })
  it('authenticates only to the configured Supabase endpoint without forwarding redirects', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secret')
    const request = vi.fn().mockResolvedValue(new Response(sample)); vi.stubGlobal('fetch', request)
    expect(await fetchSupabaseMetrics()).toMatchObject({ connections: 6 })
    expect(request).toHaveBeenCalledWith(new URL('https://project.supabase.co/customer/v1/privileged/metrics'), expect.objectContaining({ redirect: 'error', cache: 'no-store' }))
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://untrusted.example')
    await expect(fetchSupabaseMetrics()).rejects.toThrow('invalid_metrics_host')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
