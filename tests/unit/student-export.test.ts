import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { uniqueSheetName, buildStudentWorkbook } from '@/lib/student-export'
import type { StudentWithEnrollments } from '@/lib/types'
describe('student export', () => {
  it('sanitizes invalid, duplicate, long, case-insensitive and reserved sheet names', () => {
    const used = new Set(['미배정'])
    const names = ['A/B:*?[]', 'A/B:*?[]', 'a b', '미배정', '', 'x'.repeat(40), 'x'.repeat(40)].map(n => uniqueSheetName(n, used))
    expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length)
    for (const n of names) { expect(n.length).toBeLessThanOrEqual(31); expect(n).not.toMatch(/[:\\/?*\[\]]/) }
  })
  it('exports all 1050 enrollments and reads back a valid workbook despite duplicate class names', () => {
    const students = Array.from({ length: 1050 }, (_, i) => ({ id: String(i), name: `가상 ${i}`, class_student: [{ class_id: 'one', left_at: null }, ...(i === 0 ? [{ class_id: 'two', left_at: null }] : [])] })) as StudentWithEnrollments[]
    const wb = buildStudentWorkbook(students, [{ id: 'one', name: '동일/반' }, { id: 'two', name: '동일/반' }])
    const parsed = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(parsed.SheetNames).toHaveLength(2)
    expect(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]])).toHaveLength(1050)
    expect(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[1]])).toHaveLength(1)
  })
  it('does not export withdrawn students and still creates a valid empty workbook', () => {
    const students = [{ id: 'left', name: '퇴원', class_student: [{ class_id: 'one', left_at: '2026-01-01' }] }] as StudentWithEnrollments[]
    const wb = buildStudentWorkbook(students, [{ id: 'one', name: '반' }])
    expect(wb.SheetNames).toEqual(['학생 목록'])
    expect(XLSX.utils.sheet_to_json(wb.Sheets['학생 목록'])).toEqual([])
  })
})
