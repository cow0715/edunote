// @ts-expect-error Deno requires the .ts extension; this entrypoint runs outside Next.js.
import { storageReader } from './handler.ts'
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void }
Deno.serve(storageReader({ tokenDigest: Deno.env.get('COST_STORAGE_READER_TOKEN_SHA256'), url: Deno.env.get('SUPABASE_URL'), key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), projectRef: 'otlyfjciikngdoazjusq' }))
