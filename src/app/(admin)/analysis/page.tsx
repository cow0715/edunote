'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { useClasses } from '@/hooks/use-classes'
import { useClassOverview, useTeacherMemos, useCreateMemo, useDeleteMemo } from '@/hooks/use-overview'
import { Student, Week } from '@/lib/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Users, Copy, Check, Trash2, Link2, StickyNote, TrendingUp, BookOpen, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type SortColumn = 'name' | 'vocab' | 'reading' | 'homework'
type SortDirection = 'asc' | 'desc'

// ── 출결 배지 ──────────────────────────────────────────────
function AttendanceBadge({ status }: { status?: string }) {
  if (!status) return <span className="inline-flex h-6 w-9 items-center justify-center rounded text-[10px] font-medium bg-gray-100 text-gray-400">-</span>
  const map: Record<string, { label: string; cls: string }> = {
    present: { label: '출석', cls: 'bg-indigo-50 text-indigo-600' },
    late:    { label: '지각', cls: 'bg-yellow-50 text-yellow-600' },
    absent:  { label: '결석', cls: 'bg-red-50 text-red-500' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={cn('inline-flex h-6 w-9 items-center justify-center rounded text-[10px] font-medium', cls)}>{label}</span>
}

// ── 전화번호 복사 버튼 ─────────────────────────────────────
function CopyPhone({ phone }: { phone: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!phone) return <span className="text-gray-300 text-sm">-</span>
  function handleCopy() {
    navigator.clipboard.writeText(phone!)
    setCopied(true)
    toast.success('복사됨')
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 text-sm text-gray-700 hover:text-indigo-600 transition-colors group">
      <span>{phone}</span>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 text-gray-400" />}
    </button>
  )
}

// ── 스파크라인 ─────────────────────────────────────────────
function Sparkline({ data }: { data: (number | null)[] }) {
  const points = data.map((v, i) => ({ i, v: v ?? null })).filter((p) => p.v !== null)
  if (points.length < 2) return <span className="text-xs text-gray-300">-</span>
  return (
    <ResponsiveContainer width={80} height={28}>
      <LineChart data={points}>
        <Line type="monotone" dataKey="v" stroke="#6366f1" strokeWidth={1.5} dot={false} />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
          formatter={(v) => [`${v}`, '점수']}
          labelFormatter={() => ''}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── 강사 메모 탭 ───────────────────────────────────────────
function MemoTab({ studentId }: { studentId: string }) {
  const [text, setText] = useState('')
  const { data: memos, isLoading } = useTeacherMemos(studentId)
  const { mutate: createMemo, isPending: saving } = useCreateMemo(studentId)
  const { mutate: deleteMemo } = useDeleteMemo(studentId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  function handleSave() {
    if (!text.trim()) return
    createMemo(text.trim(), {
      onSuccess: () => {
        setText('')
        textareaRef.current?.focus()
      },
    })
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메모 입력... (Ctrl+Enter로 저장)"
          className="resize-none text-sm"
          rows={3}
        />
        <Button size="sm" onClick={handleSave} disabled={!text.trim() || saving} className="self-end">
          저장
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400 text-center py-4">불러오는 중...</p>
      ) : !memos?.length ? (
        <p className="text-xs text-gray-400 text-center py-6">작성된 메모가 없습니다</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {memos.map((memo) => (
            <li key={memo.id} className="group flex items-start gap-2 rounded-lg border bg-gray-50 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400 mb-0.5">
                  {new Date(memo.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{memo.content}</p>
              </div>
              <button
                onClick={() => deleteMemo(memo.id)}
                className="opacity-0 group-hover:opacity-100 mt-0.5 text-gray-300 hover:text-red-400 transition-all shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 학생 상세 Sheet ────────────────────────────────────────
function StudentSheet({
  student,
  weeks,
  scores,
  attendance,
  open,
  onClose,
}: {
  student: Student | null
  weeks: Week[]
  scores: { student_id: string; week_id: string; vocab_correct: number | null; reading_correct: number | null; homework_done: number | null }[]
  attendance: { student_id: string; date: string; status: string }[]
  open: boolean
  onClose: () => void
}) {
  if (!student) return null

  const studentScores = scores.filter((s) => s.student_id === student.id)
  const weekScoreMap = new Map(studentScores.map((s) => [s.week_id, s]))

  const weekAttMap = new Map(
    attendance
      .filter((a) => a.student_id === student.id)
      .map((a) => {
        const week = weeks.find((w) => w.start_date === a.date)
        return week ? [week.id, a.status] : null
      })
      .filter(Boolean) as [string, string][]
  )

  const scoreData = weeks.map((w) => {
    const sc = weekScoreMap.get(w.id)
    if (!sc || sc.reading_correct === null || w.reading_total === 0) return null
    return Math.round(sc.reading_correct / w.reading_total * 100)
  })

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[400px] sm:w-[480px] flex flex-col p-0 gap-0 overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-lg">{student.name}</SheetTitle>
              <p className="text-sm text-gray-500 mt-0.5">
                {[student.grade, student.school].filter(Boolean).join(' · ')}
              </p>
            </div>
            <a
              href={`/share/${student.share_token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 transition-colors border rounded-md px-2.5 py-1.5"
            >
              <Link2 className="h-3.5 w-3.5" />
              공유 링크
            </a>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-16 shrink-0 text-gray-400 text-xs">학생</span>
              <CopyPhone phone={student.phone} />
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-16 shrink-0 text-gray-400 text-xs">부</span>
              <CopyPhone phone={student.father_phone} />
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-16 shrink-0 text-gray-400 text-xs">모</span>
              <CopyPhone phone={student.mother_phone} />
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue="scores" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 w-full rounded-none border-b bg-transparent h-10 px-4 justify-start gap-1">
            <TabsTrigger value="scores" className="text-xs data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 rounded-none">
              <TrendingUp className="h-3.5 w-3.5 mr-1" />성적 이력
            </TabsTrigger>
            <TabsTrigger value="attendance" className="text-xs data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 rounded-none">
              <BookOpen className="h-3.5 w-3.5 mr-1" />출결 이력
            </TabsTrigger>
            <TabsTrigger value="memos" className="text-xs data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 rounded-none">
              <StickyNote className="h-3.5 w-3.5 mr-1" />강사 메모
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            {/* 성적 이력 */}
            <TabsContent value="scores" className="mt-0 p-4 flex flex-col gap-3">
              {weeks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">등록된 주차가 없습니다</p>
              ) : (
                <>
                  {scoreData.filter((v) => v !== null).length >= 2 && (
                    <div className="rounded-xl border bg-white p-3">
                      <p className="text-xs text-gray-400 mb-2">시험 점수 추이</p>
                      <ResponsiveContainer width="100%" height={60}>
                        <LineChart data={weeks.map((w, i) => ({ name: `${w.week_number}차`, v: scoreData[i] })).filter((d) => d.v !== null)}>
                          <Line type="monotone" dataKey="v" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => [`${v}`, '점']} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="rounded-xl border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="text-left px-3 py-2">차시</th>
                          <th className="text-center px-3 py-2">시험</th>
                          <th className="text-center px-3 py-2">어휘</th>
                          <th className="text-center px-3 py-2">과제</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...weeks].reverse().map((week) => {
                          const sc = weekScoreMap.get(week.id)
                          return (
                            <tr key={week.id} className="border-t">
                              <td className="px-3 py-2 text-gray-600 font-medium">{week.week_number}차시</td>
                              <td className="px-3 py-2 text-center">
                                {sc && sc.reading_correct !== null && week.reading_total > 0
                                  ? <span className={cn('font-medium', (sc.reading_correct / week.reading_total) < 0.5 ? 'text-red-500' : 'text-gray-800')}>
                                      {Math.round(sc.reading_correct / week.reading_total * 100)}%
                                    </span>
                                  : <span className="text-gray-300">-</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {sc && sc.vocab_correct !== null && week.vocab_total > 0
                                  ? <span className={cn('font-medium', (sc.vocab_correct / week.vocab_total) < 0.5 ? 'text-red-500' : 'text-gray-800')}>
                                      {Math.round(sc.vocab_correct / week.vocab_total * 100)}%
                                    </span>
                                  : <span className="text-gray-300">-</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {sc?.homework_done !== null && sc?.homework_done !== undefined && week.homework_total > 0
                                  ? <span className={cn('font-medium', (sc.homework_done / week.homework_total) < 0.5 ? 'text-red-500' : 'text-gray-800')}>
                                      {Math.round(sc.homework_done / week.homework_total * 100)}%
                                    </span>
                                  : <span className="text-gray-300">-</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>

            {/* 출결 이력 */}
            <TabsContent value="attendance" className="mt-0 p-4">
              {weeks.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">등록된 주차가 없습니다</p>
              ) : (
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-2">차시</th>
                        <th className="text-left px-3 py-2">날짜</th>
                        <th className="text-center px-3 py-2">출결</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...weeks].reverse().map((week) => {
                        const status = weekAttMap.get(week.id)
                        return (
                          <tr key={week.id} className="border-t">
                            <td className="px-3 py-2 font-medium text-gray-600">{week.week_number}차시</td>
                            <td className="px-3 py-2 text-gray-500">{week.start_date ?? '-'}</td>
                            <td className="px-3 py-2 text-center">
                              <AttendanceBadge status={status} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* 강사 메모 */}
            <TabsContent value="memos" className="mt-0">
              <MemoTab studentId={student.id} />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

// ── 정렬 헤더 버튼 ────────────────────────────────────────
function SortHeader({
  label,
  column,
  sortCol,
  sortDir,
  onSort,
  className,
}: {
  label: string
  column: SortColumn
  sortCol: SortColumn
  sortDir: SortDirection
  onSort: (col: SortColumn) => void
  className?: string
}) {
  const active = sortCol === column
  return (
    <button
      onClick={() => onSort(column)}
      className={cn('flex items-center gap-0.5 hover:text-indigo-600 transition-colors', active && 'text-indigo-600', className)}
    >
      {label}
      {active ? (
        sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )
}

// ── 메인 페이지 ────────────────────────────────────────────
export default function AnalysisPage() {
  const [selectedClassId, setSelectedClassId] = useState<string>('')
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [sortCol, setSortCol] = useState<SortColumn>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')

  const { data: classes, isLoading: classesLoading } = useClasses()
  const { data: overview, isLoading: overviewLoading } = useClassOverview(selectedClassId)

  const weeks = overview?.weeks ?? []
  const scores = overview?.scores ?? []
  const attendance = overview?.attendance ?? []

  // 가장 최근 수업 주차 (weeks는 week_number 오름차순으로 정렬되어 있다고 가정)
  const latestWeek = weeks.length > 0 ? weeks[weeks.length - 1] : null

  function handleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const rawStudents = (overview?.students ?? []).map((cs) => cs.student)

  // 정렬을 위해 최근 주차 데이터 미리 계산
  const studentsWithLatest = rawStudents.map((student) => {
    const studentScores = scores.filter((s) => s.student_id === student.id)
    const weekScoreMap = new Map(studentScores.map((s) => [s.week_id, s]))
    const latestSc = latestWeek ? weekScoreMap.get(latestWeek.id) : undefined

    const vocab = latestSc && latestSc.vocab_correct !== null && latestWeek && latestWeek.vocab_total > 0
      ? Math.round(latestSc.vocab_correct / latestWeek.vocab_total * 100)
      : null
    const reading = latestSc && latestSc.reading_correct !== null && latestWeek && latestWeek.reading_total > 0
      ? Math.round(latestSc.reading_correct / latestWeek.reading_total * 100)
      : null
    const homework = latestSc && latestSc.homework_done !== null && latestWeek && latestWeek.homework_total > 0
      ? Math.round(latestSc.homework_done / latestWeek.homework_total * 100)
      : null

    return { student, weekScoreMap, vocab, reading, homework }
  })

  const students = [...studentsWithLatest].sort((a, b) => {
    if (sortCol === 'name') {
      const cmp = a.student.name.localeCompare(b.student.name, 'ko')
      return sortDir === 'asc' ? cmp : -cmp
    }
    const av = a[sortCol]
    const bv = b[sortCol]
    // null은 항상 뒤로
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return sortDir === 'asc' ? av - bv : bv - av
  })

  function handleClassSelect(classId: string) {
    setSelectedClassId(classId)
    setSelectedStudent(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-5">
        <Users className="h-6 w-6 text-indigo-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">학생 현황</h1>
          <p className="mt-0.5 text-sm text-gray-500">반별 학생 누적 성적 및 출결 현황</p>
        </div>
      </div>

      {/* 반 선택 탭 */}
      {classesLoading ? (
        <div className="flex gap-2 mb-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-9 w-24 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-4">
          {(classes ?? []).map((cls) => (
            <button
              key={cls.id}
              onClick={() => handleClassSelect(cls.id)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                selectedClassId === cls.id
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
              )}
            >
              {cls.name}
            </button>
          ))}
        </div>
      )}

      {/* 컨텐츠 */}
      {!selectedClassId ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Users className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">반을 선택하면 학생 현황이 표시됩니다</p>
        </div>
      ) : overviewLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <Users className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">등록된 학생이 없습니다</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs text-gray-500">
                <th className="px-4 py-3 text-left w-10">#</th>
                <th className="px-4 py-3 text-left min-w-[100px]">
                  <SortHeader label="이름" column="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-left w-24">성적 추이</th>
                <th className="px-3 py-3 text-center w-16">
                  <div className="flex flex-col items-center gap-0.5">
                    <SortHeader label="단어" column="vocab" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="justify-center" />
                    {latestWeek && <span className="text-[10px] text-gray-400 font-normal">{latestWeek.week_number}차시</span>}
                  </div>
                </th>
                <th className="px-3 py-3 text-center w-16">
                  <div className="flex flex-col items-center gap-0.5">
                    <SortHeader label="시험" column="reading" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="justify-center" />
                    {latestWeek && <span className="text-[10px] text-gray-400 font-normal">{latestWeek.week_number}차시</span>}
                  </div>
                </th>
                <th className="px-3 py-3 text-center w-16">
                  <div className="flex flex-col items-center gap-0.5">
                    <SortHeader label="과제율" column="homework" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="justify-center" />
                    {latestWeek && <span className="text-[10px] text-gray-400 font-normal">{latestWeek.week_number}차시</span>}
                  </div>
                </th>
                <th className="px-4 py-3 text-left min-w-[130px]">부 전화</th>
                <th className="px-4 py-3 text-left min-w-[130px]">모 전화</th>
                <th className="px-4 py-3 text-left min-w-[130px]">학생 전화</th>
                {weeks.map((w) => (
                  <th key={w.id} className="px-2 py-3 text-center w-14">
                    {w.week_number}차
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map(({ student, weekScoreMap, vocab, reading, homework }, idx) => {
                const sparkData = weeks.map((w) => {
                  const sc = weekScoreMap.get(w.id)
                  if (!sc || sc.reading_correct === null || w.reading_total === 0) return null
                  return Math.round(sc.reading_correct / w.reading_total * 100)
                })

                const weekAttMap = new Map(
                  attendance
                    .filter((a) => a.student_id === student.id)
                    .map((a) => {
                      const week = weeks.find((w) => w.start_date === a.date)
                      return week ? [week.id, a.status] : null
                    })
                    .filter(Boolean) as [string, string][]
                )

                return (
                  <tr
                    key={student.id}
                    className={cn(
                      'border-t cursor-pointer transition-colors hover:bg-indigo-50/50',
                      selectedStudent?.id === student.id && 'bg-indigo-50'
                    )}
                    onClick={() => setSelectedStudent(student)}
                  >
                    <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{student.name}</td>
                    <td className="px-4 py-3">
                      <Sparkline data={sparkData} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      {vocab !== null
                        ? <span className={cn('text-xs font-semibold', vocab < 50 ? 'text-red-500' : vocab < 70 ? 'text-yellow-600' : 'text-emerald-600')}>
                            {vocab}%
                          </span>
                        : <span className="text-gray-300 text-xs">-</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {reading !== null
                        ? <span className={cn('text-xs font-semibold', reading < 50 ? 'text-red-500' : reading < 70 ? 'text-yellow-600' : 'text-emerald-600')}>
                            {reading}%
                          </span>
                        : <span className="text-gray-300 text-xs">-</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {homework !== null
                        ? <span className={cn('text-xs font-semibold', homework < 50 ? 'text-red-500' : homework < 70 ? 'text-yellow-600' : 'text-emerald-600')}>
                            {homework}%
                          </span>
                        : <span className="text-gray-300 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <CopyPhone phone={student.father_phone} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <CopyPhone phone={student.mother_phone} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <CopyPhone phone={student.phone} />
                    </td>
                    {weeks.map((w) => (
                      <td key={w.id} className="px-2 py-3 text-center">
                        <AttendanceBadge status={weekAttMap.get(w.id)} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 학생 상세 패널 */}
      <StudentSheet
        student={selectedStudent}
        weeks={weeks}
        scores={scores}
        attendance={attendance}
        open={!!selectedStudent}
        onClose={() => setSelectedStudent(null)}
      />
    </div>
  )
}
