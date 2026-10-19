import * as XLSX from 'xlsx'
import type { StudentWithEnrollments } from '@/lib/types'

export function uniqueSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*\[\]]/g, ' ').trim().replace(/^'+|'+$/g, '').trim() || '수업'
  let candidate = base.slice(0, 31)
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    const tail = ` (${suffix++})`
    candidate = base.slice(0, 31 - tail.length) + tail
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/** Use the same loaded enrollment snapshot as the student list, avoiding partial per-class requests. */
export function buildStudentWorkbook(students: StudentWithEnrollments[], classes: { id: string; name: string }[]) {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>(['미배정'])
  const assigned = new Set<string>()
  const colors = ['4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '17375E', '953734']
  const toRow = (s: StudentWithEnrollments) => ({
    이름: s.name, 학생연락처: s.phone ?? '', 어머니연락처: s.mother_phone ?? '', 아버지연락처: s.father_phone ?? '',
  })
  function append(rows: StudentWithEnrollments[], name: string) {
    const ws = XLSX.utils.json_to_sheet(rows.map(toRow), { header: ['이름', '학생연락처', '어머니연락처', '아버지연락처'] })
    ws['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, name)
    wb.Workbook ??= { Sheets: [] }
    wb.Workbook.Sheets ??= []
    const index = wb.SheetNames.length - 1
    wb.Workbook.Sheets[index] = { TabColor: { rgb: name === '미배정' ? '808080' : colors[index % colors.length] } } as XLSX.SheetProps
  }
  for (const c of classes) {
    const rows = students.filter(s => s.class_student.some(e => e.class_id === c.id && !e.left_at))
    rows.forEach(s => assigned.add(s.id))
    if (rows.length) append(rows, uniqueSheetName(c.name, used))
  }
  const unassigned = students.filter(s => !assigned.has(s.id) &&
    (s.class_student.length === 0 || s.class_student.some(e => !e.left_at)))
  if (unassigned.length) append(unassigned, '미배정')
  if (!wb.SheetNames.length) append([], '학생 목록')
  return wb
}
