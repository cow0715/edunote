type Config = { tokenDigest?: string; url?: string; key?: string; projectRef: string }
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers })
export function storageReader(config: Config) {
  return async (request: Request) => {
    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405)
    if (new URL(request.url).search) return reply({ error: 'invalid_request' }, 400)
    if (!config.tokenDigest || !/^[a-f0-9]{64}$/.test(config.tokenDigest) || !config.key || config.url !== `https://${config.projectRef}.supabase.co`) return reply({ error: 'not_configured' }, 503)
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
    if (!token) return reply({ error: 'unauthorized' }, 401)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), n => n.toString(16).padStart(2, '0')).join('')
    let difference = 0
    for (let i = 0; i < 64; i++) difference |= digest.charCodeAt(i) ^ config.tokenDigest.charCodeAt(i)
    if (difference !== 0) return reply({ error: 'unauthorized' }, 401)
    try {
      const result = await fetch(`${config.url}/rest/v1/rpc/cost_infrastructure_usage`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!result.ok) return reply({ error: 'usage_unavailable' }, 503)
      const rows = await result.json()
      if (!Array.isArray(rows) || rows.length !== 1) return reply({ error: 'invalid_usage' }, 503)
      const storage = Number(rows[0].storage_bytes), files = Number(rows[0].files)
      if (rows[0].storage_bytes == null || rows[0].files == null || !Number.isSafeInteger(storage) || storage < 0 || !Number.isSafeInteger(files) || files < 0) return reply({ error: 'invalid_usage' }, 503)
      // Only aggregates leave this project, never records, object names, or keys.
      return reply({ project_ref: config.projectRef, storage_bytes: storage, files, collected_at: new Date().toISOString() })
    } catch { return reply({ error: 'usage_unavailable' }, 503) }
  }
}
