import { getAuth, getTeacherId, err } from '../api'
import { isUuid } from '../pdf-import/types'
import type { BookDocument } from './types'

export async function bookTeacher() {
  const { supabase, user } = await getAuth()
  if (!user) return { response: err('로그인이 필요합니다.', 401) }
  const teacherId = await getTeacherId(supabase, user.id)
  if (!teacherId) return { response: err('승인된 강사 정보가 없습니다.', 403) }
  return { supabase, user, teacherId }
}

export async function ownedBook(id: string) {
  const auth = await bookTeacher()
  if (auth.response) return auth
  if (!isUuid(id)) return { response: err('자료 ID 형식 오류') }
  const { data, error } = await auth.supabase!.from('book_pdf_document').select('*').eq('id', id).eq('teacher_id', auth.teacherId!).single()
  if (error || !data) return { response: err('자료를 찾을 수 없습니다.', 404) }
  return { ...auth, document: data as BookDocument }
}
