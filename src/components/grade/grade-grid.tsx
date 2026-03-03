'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGradeData, useSaveGrade, GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'

function AnswerCell({
  value,
  onChange,
  disabled,
}: {
  value: number | null
  onChange: (n: number | null) => void
  disabled: boolean
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
          className={`flex h-7 w-7 items-center justify-center rounded text-xs font-semibold transition-colors
            ${disabled ? 'cursor-not-allowed opacity-30' : ''}
            ${!disabled && value === n ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

interface Props {
  weekId: string
  vocabTotal: number
  homeworkTotal: number
}

export function GradeGrid({ weekId, vocabTotal, homeworkTotal }: Props) {
  const { data, isLoading } = useGradeData(weekId)
  const saveGrade = useSaveGrade(weekId)
  const [rows, setRows] = useState<GradeRow[]>([])

  useEffect(() => {
    if (!data) return
    const { classStudents, weekScores, questions } = data
    type ScoreRecord = { student_id: string; id: string; vocab_correct: number; homework_done: number; memo: string | null; student_answer: { exam_question_id: string; student_answer: number | null }[] }
    const scoreMap = new Map<string, ScoreRecord>(weekScores?.map((s: ScoreRecord) => [s.student_id, s]))

    setRows(
      (classStudents ?? []).map((cs: { student_id: string; student: { name: string } }) => {
        const score = scoreMap.get(cs.student_id)
        return {
          student_id: cs.student_id,
          present: !!score,
          vocab_correct: score?.vocab_correct ?? 0,
          homework_done: score?.homework_done ?? 0,
          memo: score?.memo ?? '',
          answers: (questions ?? []).map((q: ExamQuestion) => ({
            exam_question_id: q.id,
            student_answer: score?.student_answer?.find(
              (a: { exam_question_id: string }) => a.exam_question_id === q.id
            )?.student_answer ?? null,
          })),
        }
      })
    )
  }, [data])

  function updateRow(studentId: string, key: keyof GradeRow, value: unknown) {
    setRows((prev) =>
      prev.map((r) => (r.student_id === studentId ? { ...r, [key]: value } : r))
    )
  }

  function updateAnswer(studentId: string, questionId: string, value: number | null) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return {
          ...r,
          answers: r.answers.map((a) =>
            a.exam_question_id === questionId ? { ...a, student_answer: value } : a
          ),
        }
      })
    )
  }

  function togglePresent(studentId: string, present: boolean) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.student_id !== studentId) return r
        return {
          ...r,
          present,
          vocab_correct: present ? r.vocab_correct : 0,
          homework_done: present ? r.homework_done : 0,
          memo: present ? r.memo : '',
          answers: r.answers.map((a) => ({ ...a, student_answer: present ? a.student_answer : null })),
        }
      })
    )
  }

  if (isLoading) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />

  const questions: ExamQuestion[] = data?.questions ?? []
  const students = data?.classStudents ?? []

  if (students.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">수강 학생이 없어요. 먼저 학생을 배정해주세요.</p>
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left min-w-[80px]">출석</th>
              <th className="sticky left-[80px] bg-gray-50 px-3 py-2 text-left min-w-[90px]">학생</th>
              {questions.map((q) => (
                <th key={q.id} className="px-2 py-2 text-center min-w-[130px]">
                  {q.question_type?.name ?? '독해'} {q.question_number}번
                </th>
              ))}
              <th className="px-3 py-2 text-center min-w-[100px]">
                단어정답수
                {vocabTotal > 0 && <span className="ml-1 text-gray-400">/{vocabTotal}</span>}
              </th>
              <th className="px-3 py-2 text-center min-w-[100px]">
                숙제완료
                {homeworkTotal > 0 && <span className="ml-1 text-gray-400">/{homeworkTotal}</span>}
              </th>
              <th className="px-3 py-2 text-left min-w-[120px]">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const student = students.find((cs: { student_id: string; student: { name: string } }) => cs.student_id === row.student_id)?.student
              return (
                <tr key={row.student_id} className={row.present ? '' : 'bg-gray-50 opacity-60'}>
                  {/* 출석 */}
                  <td className="sticky left-0 bg-white px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.present}
                      onChange={(e) => togglePresent(row.student_id, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  {/* 학생 이름 */}
                  <td className="sticky left-[80px] bg-white px-3 py-2 font-medium text-gray-900">
                    {student?.name ?? '-'}
                  </td>
                  {/* 독해 답안 */}
                  {row.answers.map((a) => (
                    <td key={a.exam_question_id} className="px-2 py-1.5">
                      <AnswerCell
                        value={a.student_answer}
                        onChange={(n) => updateAnswer(row.student_id, a.exam_question_id, n)}
                        disabled={!row.present}
                      />
                    </td>
                  ))}
                  {/* 단어 정답 수 */}
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={vocabTotal || 999}
                      value={row.vocab_correct}
                      onChange={(e) => updateRow(row.student_id, 'vocab_correct', Number(e.target.value))}
                      disabled={!row.present}
                      className="h-8 w-20 text-center"
                    />
                  </td>
                  {/* 숙제 완료 */}
                  <td className="px-3 py-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={homeworkTotal || 999}
                      value={row.homework_done}
                      onChange={(e) => updateRow(row.student_id, 'homework_done', Number(e.target.value))}
                      disabled={!row.present}
                      className="h-8 w-20 text-center"
                    />
                  </td>
                  {/* 메모 */}
                  <td className="px-3 py-1.5">
                    <Input
                      value={row.memo}
                      onChange={(e) => updateRow(row.student_id, 'memo', e.target.value)}
                      disabled={!row.present}
                      placeholder="특이사항"
                      className="h-8 min-w-[100px]"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          출석 {rows.filter((r) => r.present).length} / 전체 {rows.length}명
        </p>
        <Button onClick={() => saveGrade.mutate(rows)} disabled={saveGrade.isPending}>
          {saveGrade.isPending ? '저장 중...' : '채점 저장'}
        </Button>
      </div>
    </div>
  )
}
