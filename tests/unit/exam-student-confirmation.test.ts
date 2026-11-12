import { describe, expect, it } from 'vitest'
import { duplicateExamStudents, isExamStudentConfirmed } from '@/lib/exam-student-confirmation'

describe('사진별 학생 확인', () => {
  it('자동 연결만으로는 확인이 되지 않고 선택한 학생과 확인한 학생이 일치해야 한다', () => {
    const duplicates = new Set<string>()
    expect(isExamStudentConfirmed({ studentId: 'a', confirmedStudentId: null }, duplicates)).toBe(false)
    expect(isExamStudentConfirmed({ studentId: 'b', confirmedStudentId: 'a' }, duplicates)).toBe(false)
    expect(isExamStudentConfirmed({ studentId: null, confirmedStudentId: null }, duplicates)).toBe(false)
    expect(isExamStudentConfirmed({ studentId: 'a', confirmedStudentId: 'a' }, duplicates)).toBe(true)
  })
  it('이미 확인한 학생도 다른 사진과 중복 연결되면 판독 대상이 될 수 없다', () => {
    const items = [{ studentId: 'a', confirmedStudentId: 'a' }, { studentId: 'a', confirmedStudentId: null }]
    const duplicates = duplicateExamStudents(items)
    expect([...duplicates]).toEqual(['a'])
    expect(items.every((item) => !isExamStudentConfirmed(item, duplicates))).toBe(true)
  })
})
