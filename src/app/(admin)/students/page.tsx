'use client'

import { useState, useMemo } from 'react'
import { Plus, Users, Pencil, Trash2, Phone, School, ExternalLink, Search, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StudentFormDialog } from '@/components/students/student-form-dialog'
import { useStudents, useDeleteStudent, useClassStudents } from '@/hooks/use-students'
import { useClasses } from '@/hooks/use-classes'
import { Student } from '@/lib/types'
import * as XLSX from 'xlsx'

export default function StudentsPage() {
  const { data: students, isLoading } = useStudents()
  const { data: classes = [] } = useClasses()
  const deleteStudent = useDeleteStudent()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Student | undefined>()
  const [searchName, setSearchName] = useState('')
  const [searchGrade, setSearchGrade] = useState('')
  const [searchClass, setSearchClass] = useState('')

  const { data: classStudents } = useClassStudents(searchClass)
  const classStudentIds = useMemo(
    () => new Set((classStudents ?? []).map((cs: { student_id: string }) => cs.student_id)),
    [classStudents]
  )

  const gradeOptions = useMemo(() => {
    const grades = (students ?? []).map((s) => s.grade).filter((g): g is string => !!g)
    return [...new Set(grades)].sort()
  }, [students])

  const filtered = useMemo(() => {
    return (students ?? []).filter((s) => {
      const nameMatch = !searchName || s.name.includes(searchName)
      const gradeMatch = !searchGrade || s.grade === searchGrade
      const classMatch = !searchClass || classStudentIds.has(s.id)
      return nameMatch && gradeMatch && classMatch
    })
  }, [students, searchName, searchGrade, searchClass, classStudentIds])

  const hasFilter = !!(searchName || searchGrade || searchClass)

  function resetFilters() {
    setSearchName('')
    setSearchGrade('')
    setSearchClass('')
  }

  function handleEdit(s: Student) {
    setEditTarget(s)
    setDialogOpen(true)
  }

  function handleDelete(id: string) {
    if (confirm('학생을 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) {
      deleteStudent.mutate(id)
    }
  }

  function handleCreate() {
    setEditTarget(undefined)
    setDialogOpen(true)
  }

  async function handleExportExcel() {
    if (!students || !classes) return

    // 반별 학생 목록 병렬 조회
    const classStudentsList = await Promise.all(
      classes.map(async (c) => {
        const res = await fetch(`/api/classes/${c.id}/students`)
        if (!res.ok) return { classId: c.id, studentIds: [] as string[] }
        const data: { student_id: string }[] = await res.json()
        return { classId: c.id, studentIds: data.map((d) => d.student_id) }
      })
    )

    const assignedIds = new Set(classStudentsList.flatMap((cl) => cl.studentIds))

    const wb = XLSX.utils.book_new()

    const COLS = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
    const TAB_COLORS = [
      '4F81BD', 'C0504D', '9BBB59', '8064A2',
      '4BACC6', 'F79646', '17375E', '953734',
    ]

    const toRow = (s: Student) => ({
      이름: s.name,
      학생연락처: s.phone ?? '',
      어머니연락처: s.mother_phone ?? '',
      아버지연락처: s.father_phone ?? '',
    })

    const makeSheet = (rows: ReturnType<typeof toRow>[]) => {
      const ws = XLSX.utils.json_to_sheet(rows, {
        header: ['이름', '학생연락처', '어머니연락처', '아버지연락처'],
      })
      ws['!cols'] = COLS
      ws['!freeze'] = { xSplit: 0, ySplit: 1 }
      return ws
    }

    let sheetIdx = 0

    // 반별 시트
    for (const c of classes) {
      const entry = classStudentsList.find((cl) => cl.classId === c.id)
      const rows = (entry?.studentIds ?? [])
        .map((id) => students.find((s) => s.id === id))
        .filter((s): s is Student => !!s)
        .map(toRow)
      if (rows.length === 0) continue
      XLSX.utils.book_append_sheet(wb, makeSheet(rows), c.name.slice(0, 31))
      if (!wb.Workbook) wb.Workbook = { Sheets: [] }
      if (!wb.Workbook.Sheets) wb.Workbook.Sheets = []
      wb.Workbook.Sheets[sheetIdx] = { TabColor: { rgb: TAB_COLORS[sheetIdx % TAB_COLORS.length] } } as XLSX.SheetProps
      sheetIdx++
    }

    // 미배정 학생 시트
    const unassigned = students.filter((s) => !assignedIds.has(s.id)).map(toRow)
    if (unassigned.length > 0) {
      XLSX.utils.book_append_sheet(wb, makeSheet(unassigned), '미배정')
      if (!wb.Workbook) wb.Workbook = { Sheets: [] }
      if (!wb.Workbook.Sheets) wb.Workbook.Sheets = []
      wb.Workbook.Sheets[sheetIdx] = { TabColor: { rgb: '808080' } } as XLSX.SheetProps
    }

    XLSX.writeFile(wb, `학생목록_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">학생 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            전체 {students?.length ?? 0}명
            {hasFilter && ` · 검색 결과 ${filtered.length}명`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportExcel} disabled={!students?.length}>
            <Download className="mr-2 h-4 w-4" />
            엑셀 내보내기
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            학생 등록
          </Button>
        </div>
      </div>

      {/* 검색 필터 */}
      <div className="mt-5 flex flex-wrap gap-2">
        <div className="relative w-44">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="이름 검색"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={searchGrade}
          onChange={(e) => setSearchGrade(e.target.value)}
          className="rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">전체 학년</option>
          {gradeOptions.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <select
          value={searchClass}
          onChange={(e) => setSearchClass(e.target.value)}
          className="rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">전체 반</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            초기화
          </Button>
        )}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <Users className="mb-3 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">
              {students?.length === 0 ? '등록된 학생이 없어요' : '검색 결과가 없어요'}
            </p>
            {students?.length === 0 && (
              <Button variant="outline" className="mt-4" onClick={handleCreate}>
                첫 학생 등록하기
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <Card key={s.id} className="group">
                <CardContent className="flex items-center gap-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <div className="flex gap-3 mt-0.5">
                      {s.grade && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <School className="h-3 w-3" />{s.school ? `${s.school} ` : ''}{s.grade}
                        </span>
                      )}
                      {s.father_phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Phone className="h-3 w-3" />부 {s.father_phone}
                        </span>
                      )}
                      {s.mother_phone && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Phone className="h-3 w-3" />모 {s.mother_phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-blue-500 hover:text-blue-600" onClick={() => window.open(`/share/${s.share_token}`, '_blank')} title="학부모 공유 페이지">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-red-500 hover:text-red-600" disabled={deleteStudent.isPending} onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <StudentFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editTarget={editTarget} />
    </div>
  )
}
