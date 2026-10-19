import { createClient } from '@supabase/supabase-js'

/** Cookie-independent server client, also usable by a Cloud Run process. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase 서버 환경변수가 필요합니다.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
