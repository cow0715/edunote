import { describe, expect, it, vi } from 'vitest'
import { answerSheetCode } from '@/lib/answer-sheet-identity'

const mock = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/anthropic', () => ({ readVocabSheetName: mock.read }))
vi.mock('@/lib/api', () => ({
  getTeacherId: async () => 'teacher',
  assertWeekOwner: async () => true,
  err: (error: string, status = 400) => Response.json({ error }, { status }),
  ok: (body: unknown) => Response.json(body),
  getAuth: async () => ({ user: { id: 'user' }, supabase: { from: () => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { class_id: 'class' } }),
      is: async () => ({ data: [
        { student_id: 'first', student: { name: '김학생' } },
        { student_id: 'second', student: { name: '김학생' } },
      ] }),
    }
    return query
  } } }),
}))
import { POST } from '@/app/api/weeks/[id]/vocab-photo-name/route'

function scan(kind?: 'reading') {
  return POST(new Request('http://localhost/name', {
    method: 'POST', body: JSON.stringify({ fileData: 'photo', mimeType: 'image/jpeg', kind }),
  }), { params: Promise.resolve({ id: 'week' }) })
}

describe('진단평가 인쇄 코드로 학생 찾기', () => {
  it('뒷장에 이름이 없어도 같은 회차의 코드를 읽어 동명이인 중 한 명에게 연결한다', async () => {
    mock.read.mockResolvedValueOnce({ rawName: null, name: null, sheetCode: answerSheetCode('week', 'second'), sheetPage: 2 })
    const response = await scan('reading')
    expect(await response.json()).toMatchObject({ studentId: 'second', codeMatch: 'matched', sheetPage: 2 })
    expect(mock.read).toHaveBeenLastCalledWith('photo', 'image/jpeg', ['김학생', '김학생'], { readSheetCode: true })
  })

  it('다른 회차의 코드는 직접 확인 대상으로 남긴다', async () => {
    mock.read.mockResolvedValueOnce({ rawName: '김학생', name: '김학생', sheetCode: answerSheetCode('other-week', 'first') })
    expect(await (await scan('reading')).json()).toMatchObject({ studentId: null, codeMatch: 'unmatched' })
  })

  it('판독 코드와 학생 이름이 없어도 인쇄 쪽수를 전달한다', async () => {
    mock.read.mockResolvedValueOnce({ rawName: null, name: null, sheetPage: 2, sheetPages: [2, null] })
    expect(await (await scan('reading')).json()).toMatchObject({ studentId: null, sheetPage: 2, sheetPages: [2, null] })
  })

  it('단어 시험은 기존 이름 중복 규칙을 사용한다', async () => {
    mock.read.mockResolvedValueOnce({ rawName: '김학생', name: '김학생', sheetCode: answerSheetCode('week', 'first') })
    expect(await (await scan()).json()).toMatchObject({ studentId: null, duplicate: true })
    expect(mock.read).toHaveBeenLastCalledWith('photo', 'image/jpeg', ['김학생', '김학생'], { readSheetCode: false })
  })
})
