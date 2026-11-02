import { expect, it } from 'vitest'
import { rosterAtDate } from '@/lib/week-roster'
const members = [
 { student_id: 'historical', joined_at: '2026-03-01', left_at: '2026-06-01', created_at: '2026-10-01' },
 { student_id: 'late-import', joined_at: '2026-05-01', left_at: null },
 { student_id: 'future', joined_at: '2026-05-01', left_at: null },
 { student_id: 'left', joined_at: '2026-03-01', left_at: '2026-04-08' },
]
it('uses enrollment dates rather than import creation timestamps and preserves recorded students', () => {
 expect(rosterAtDate(members, '2026-04-08', ['late-import']).map(m => m.student_id)).toEqual(['historical', 'late-import'])
})
it('does not carry the previous date recorded membership onto another date', () => {
 expect(rosterAtDate(members, '2026-04-08').map(m => m.student_id)).toEqual(['historical'])
 expect(rosterAtDate(members, null).map(m => m.student_id)).toEqual(['late-import', 'future'])
})
