import { z } from 'zod'
export const DEV_STORAGE_REF = 'otlyfjciikngdoazjusq'
const reading = z.object({ project_ref: z.literal(DEV_STORAGE_REF), storage_bytes: z.number().int().nonnegative().safe(), files: z.number().int().nonnegative().safe(), collected_at: z.iso.datetime() })
export async function fetchDevelopmentStorage() {
  const token = process.env.COST_DEV_STORAGE_READER_TOKEN
  if (!token) throw new Error('storage_reader_not_configured')
  const response = await fetch(`https://${DEV_STORAGE_REF}.supabase.co/functions/v1/storage-usage-reader`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('development_storage_unavailable')
  return reading.parse(await response.json())
}
