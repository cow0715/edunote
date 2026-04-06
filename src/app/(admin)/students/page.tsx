'use client'

import { useState, useMemo } from 'react'
import { Plus, Users, Pencil, Trash2, ExternalLink, Search, Download, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StudentFormDialog } from '@/components/students/student-form-dialog'
import { useStudents, useDeleteStudent, useClassStudents } from '@/hooks/use-students'
import { useClasses } from '@/hooks/use-classes'
import { Student, StudentWithEnrollments } from '@/lib/types'
import * as XLSX from 'xlsx'

type SortKey = 'name' | 'grade' | 'joined_at' | 'left_at'
type SortDir = 'asc' | 'desc'

function getJoinedAt(s: StudentWithEnrollments): string | null {
  const dates = s.class_student.map((e) => e.joined_at).filter(Boolean) as string[]
  if (dates.length === 0) return null
  return dates.sort()[0]
}

function getLeftAt(s: StudentWithEnrollments): string | null {
  const enrollments = s.class_student
  if (enrollments.length === 0) return null
  const allLeft = enrollments.every((e) => !!e.left_at)
  if (!allLeft) return null
  const dates = enrollments.map((e) => e.left_at).filter(Boolean) as string[]
  return dates.sort().at(-1) ?? null
}

function isWithdrawn(s: StudentWithEnrollments): boolean {
  const e = s.class_student
  if (e.length === 0) return false
  return e.every((en) => !!en.left_at)
}

function getActiveClasses(s: StudentWithEnrollments): string {
  return s.class_student
    .filter((e) => !e.left_at)
    .map((e) => e.class?.name ?? '')
    .filter(Boolean)
    .join(', ')
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-300 ml-1" />
  return sortDir === 'asc'
    ? <ChevronUp className="h-3.5 w-3.5 text-primary ml-1" />
    : <ChevronDown className="h-3.5 w-3.5 text-primary ml-1" />
}

function fmtDate(d: string | null): string {
  if (!d) return '-'
  return d.slice(0, 10)
}

export default function StudentsPage() {
  const { data: students, isLoading } = useStudents()
  const { data: classes = [] } = useClasses()
  const deleteStudent = useDeleteStudent()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Student | undefined>()
  const [searchName, setSearchName] = useState('')
  const [searchGrade, setSearchGrade] = useState('')
  const [searchClass, setSearchClass] = useState('')
  const [searchStatus, setSearchStatus] = useState<'all' | 'active' | 'withdrawn'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
    let list = (students ?? []).filter((s) => {
      const nameMatch = !searchName || s.name.includes(searchName)
      const gradeMatch = !searchGrade || s.grade === searchGrade
      const classMatch = !searchClass || classStudentIds.has(s.id)
      const withdrawn = isWithdrawn(s)
      const statusMatch =
        searchStatus === 'all' ||
        (searchStatus === 'active' && !withdrawn) ||
        (searchStatus === 'withdrawn' && withdrawn)
      return nameMatch && gradeMatch && classMatch && statusMatch
    })

    list = [...list].sort((a, b) => {
      let av: string = '', bv: string = ''
      if (sortKey === 'name') { av = a.name; bv = b.name }
      else if (sortKey === 'grade') { av = a.grade ?? ''; bv = b.grade ?? '' }
      else if (sortKey === 'joined_at') { av = getJoinedAt(a) ?? ''; bv = getJoinedAt(b) ?? '' }
      else if (sortKey === 'left_at') { av = getLeftAt(a) ?? ''; bv = getLeftAt(b) ?? '' }
      const cmp = av.localeCompare(bv, 'ko')
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [students, searchName, searchGrade, searchClass, searchStatus, classStudentIds, sortKey, sortDir])

  const hasFilter = !!(searchName || searchGrade || searchClass || searchStatus !== 'all')

  function resetFilters() {
    setSearchName('')
    setSearchGrade('')
    setSearchClass('')
    setSearchStatus('all')
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
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
    const TAB_COLORS = ['4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '17375E', '953734']

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
    for (const c of classes) {
      const entry = classStudentsList.find((cl) => cl.classId === c.id)
      const rows = (entry?.studentIds ?? [])
        .map((id) => students.find((s) => s.id === id))
        .filter((s): s is StudentWithEnrollments => !!s)
        .map(toRow)
      if (rows.length === 0) continue
      XLSX.utils.book_append_sheet(wb, makeSheet(rows), c.name.slice(0, 31))
      if (!wb.Workbook) wb.Workbook = { Sheets: [] }
      if (!wb.Workbook.Sheets) wb.Workbook.Sheets = []
      wb.Workbook.Sheets[sheetIdx] = { TabColor: { rgb: TAB_COLORS[sheetIdx % TAB_COLORS.length] } } as XLSX.SheetProps
      sheetIdx++
    }

    const unassigned = students.filter((s) => !assignedIds.has(s.id)).map(toRow)
    if (unassigned.length > 0) {
      XLSX.utils.book_append_sheet(wb, makeSheet(unassigned), '미배정')
      if (!wb.Workbook) wb.Workbook = { Sheets: [] }
      if (!wb.Workbook.Sheets) wb.Workbook.Sheets = []
      wb.Workbook.Sheets[sheetIdx] = { TabColor: { rgb: '808080' } } as XLSX.SheetProps
    }

    XLSX.writeFile(wb, `학생목록_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const thClass = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap'
  const thSortClass = `${thClass} cursor-pointer hover:text-gray-700 select-none`

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
        <select
          value={searchStatus}
          onChange={(e) => setSearchStatus(e.target.value as 'all' | 'active' | 'withdrawn')}
          className="rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">전체 상태</option>
          <option value="active">재원</option>
          <option value="withdrawn">퇴원</option>
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
              <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />
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
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/70">
                <tr>
                  <th
                    className={thSortClass}
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center">
                      이름
                      <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th
                    className={thSortClass}
                    onClick={() => handleSort('grade')}
                  >
                    <span className="flex items-center">
                      학교/학년
                      <SortIcon col="grade" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th className={thClass}>학생 연락처</th>
                  <th className={thClass}>부 연락처</th>
                  <th className={thClass}>모 연락처</th>
                  <th className={thClass}>반</th>
                  <th
                    className={thSortClass}
                    onClick={() => handleSort('joined_at')}
                  >
                    <span className="flex items-center">
                      입원일
                      <SortIcon col="joined_at" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th
                    className={thSortClass}
                    onClick={() => handleSort('left_at')}
                  >
                    <span className="flex items-center">
                      퇴원일
                      <SortIcon col="left_at" sortKey={sortKey} sortDir={sortDir} />
                    </span>
                  </th>
                  <th className={thClass}>상태</th>
                  <th className={`${thClass} text-right`}>액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((s) => {
                  const withdrawn = isWithdrawn(s)
                  return (
                    <tr key={s.id} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {s.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {[s.school, s.grade].filter(Boolean).join(' ') || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {s.phone || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {s.father_phone || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {s.mother_phone || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {getActiveClasses(s) || (withdrawn ? <span className="text-gray-400 text-xs">퇴원</span> : '-')}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {fmtDate(getJoinedAt(s))}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {fmtDate(getLeftAt(s))}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {withdrawn ? (
                          <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-500">퇴원</Badge>
                        ) : s.class_student.length === 0 ? (
                          <Badge variant="secondary" className="text-xs bg-yellow-50 text-yellow-600 border-yellow-200">미배정</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-600 border-blue-200">재원</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-blue-500 hover:text-blue-600"
                            onClick={() => window.open(`/share/${s.share_token}`, '_blank')}
                            title="학부모 공유 페이지"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleEdit(s)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-red-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            disabled={deleteStudent.isPending}
                            onClick={() => handleDelete(s.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StudentFormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editTarget={editTarget} />
    </div>
  )
}
