// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const fixture = vi.hoisted(() => ({ batches: [] as string[][], fail: false }))
vi.mock('@/lib/api', () => ({
 getAuth: async () => ({ user: { id: 'u' }, supabase: { from: (table: string) => {
  const chain = { select: () => chain, eq: () => chain, in: (_column: string, ids: string[]) => { fixture.batches.push(ids); return chain }, order: async () => table === 'vocab_word'
   ? { data: Array.from({ length: 468 }, (_, i) => ({ id: `v${i}`, number: i + 1 })), error: null }
   : fixture.fail ? { data: null, error: { message: 'variant read failed' } } : { data: fixture.batches.at(-1)!.map(id => ({ id: `variant-${id}`, vocab_word_id: id, sort_order: 1 })), error: null } }
  return chain
 } } }), getTeacherId: async () => 't', assertWeekOwner: async () => true,
 ok: (data: unknown) => Response.json(data), err: (error: string, status: number) => Response.json({ error }, { status }),
}))
vi.mock('@/lib/anthropic', () => ({ gradeVocabItems: vi.fn() }))
import { GET } from '@/app/api/weeks/[id]/vocab-words/route'
it('loads all 468 words through bounded variant filters and fails rather than returning partial variants', async () => {
 fixture.batches = []; fixture.fail = false
 const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'w' }) })
 const words = await response.json()
 expect(response.status).toBe(200); expect(words).toHaveLength(468)
 expect(fixture.batches).toHaveLength(10); expect(fixture.batches.every(ids => ids.length <= 50)).toBe(true)
 expect(words.every((word: { id: string; variants: { vocab_word_id: string }[] }) => word.variants.length === 1 && word.variants[0].vocab_word_id === word.id)).toBe(true)
 fixture.fail = true
 const failure = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'w' }) })
 expect(failure.status).toBe(500)
})
