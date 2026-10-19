import type { PoolConfig } from 'pg'
import { SaveError } from './errors'

export function poolConfig(connectionString?: string, ca?: string): PoolConfig {
  if (!connectionString) throw new SaveError('저장 서버 연결 설정이 필요합니다. 관리자에게 문의해 주세요.', 503)
  let url: URL
  try { url = new URL(connectionString) } catch { throw new SaveError('저장 서버 연결 설정을 확인해 주세요.', 503) }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^edunote_app\.[a-z0-9]+$/.test(decodeURIComponent(url.username)) || url.port !== '6543') {
    throw new SaveError('저장 서버의 전용 계정과 transaction pooler 설정을 확인해 주세요.', 503)
  }
  // pg parses URL query parameters after its config object; do not allow URL
  // options (ssl=false, user=postgres, etc.) to override the verified settings.
  url.search = ''
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {}) },
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'edunote-server',
  }
}
