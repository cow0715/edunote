'use client'

import { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { GradeRow } from '@/hooks/use-grade'
import { ExamQuestion } from '@/lib/types'
import { cn } from '@/lib/utils'
import { acceptedObjectiveAnswers, gradeObjective } from '@/lib/objective-grading'
import { gradeOXAnswer, oxNotation } from '@/lib/ox-grading'
import { ScoreToggleField } from './score-toggle-field'
import { AnswerKey, CorrectChip, OXInput } from './question-inputs'
import { SourceImagePreview } from './source-image-preview'
import { ExamPhotoButton, ExamOcrResult } from './exam-photo-button'

/**
 * 진단평가 채점지 — 인쇄 답안지(answer-sheet/print)와 같은 표.
 *   [번호] | ① ② ③ ④ ⑤            (객관식)
 *   [번호] | (a) ①②③④⑤ (b) ①②③④⑤ (소문항, 가로)
 *   [번호] | O / X  수정답: ____     (O/X)
 *   [번호] | ______________          (서술형)
 * 학생이 쓴 종이를 위에서 아래로 훑으며 그대로 옮겨 적는 흐름. 순서·행 구성은 답안지와 동일.
 */

type AnswerLike = GradeRow['answers'][number] | undefined
const CHOICES = [1, 2, 3, 4, 5] as const

function ObjectiveMarks({ q, answer, disabled, onChange }: {
  q: ExamQuestion
  answer: AnswerLike
  disabled: boolean
  onChange: (n: number | null) => void
}) {
  const value = answer?.student_answer ?? null
  const accepted = acceptedObjectiveAnswers(q)
  const hasKey = accepted.size > 0 || q.all_correct
  // 미입력도 오답 — 서버가 저장하는 값(`gradeObjective(...) ?? false`)과 같은 규칙.
  // 정답키가 없거나 무효 문항일 때만 판정을 보류한다.
  const result = q.is_void ? undefined : hasKey ? (gradeObjective(q, value) ?? false) : undefined

  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-1">
        {CHOICES.map((n) => {
          const selected = value === n
          const isAccepted = accepted.has(n)
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(selected ? null : n)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                selected
                  ? result === true
                    ? 'bg-emerald-500 text-white'
                    : result === false
                      ? 'bg-rose-500 text-white'
                      : 'bg-indigo-600 text-white'
                  : isAccepted && !q.is_void
                    ? 'bg-white text-emerald-600 ring-1 ring-inset ring-emerald-400 hover:bg-emerald-50'
                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
              )}
            >
              {n}
            </button>
          )
        })}
      </div>
      <span className={cn('w-4 shrink-0 text-center text-xs font-bold', result === true ? 'text-green-500' : result === false ? 'text-red-400' : 'text-transparent')}>
        {result === true ? '✓' : result === false ? '✗' : '·'}
      </span>
    </div>
  )
}

/** 서술형/오류교정 — 타이핑은 로컬, 부모 sync 는 blur (QuestionRow 와 같은 패턴) */
function TextAnswerCell({ q, answer, disabled, onChangeText }: {
  q: ExamQuestion
  answer: AnswerLike
  disabled: boolean
  onChangeText: (t: string) => void
}) {
  const externalText = answer?.student_answer_text ?? ''
  const [localText, setLocalText] = useState(externalText)
  const [syncedExternal, setSyncedExternal] = useState(externalText)
  if (syncedExternal !== externalText) {
    setSyncedExternal(externalText)
    setLocalText(externalText)
  }
  const isFindError = q.question_style === 'find_error'
  const correction = q.correct_answer_text?.split(':')[1]?.trim() ?? ''
  const isSymbolCorr = !!q.correct_answer_text && /^[a-z]:.+$/i.test(q.correct_answer_text.trim())
  const placeholder = isFindError
    ? (q.correct_answer_text ? `기호:고친 표현 (예: ${q.correct_answer_text.trim()})` : '기호:고친 표현')
    : isSymbolCorr ? `수정어만 입력 (예: ${correction})` : '답안 입력'
  const hasAnswer = !!answer?.student_answer_text

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <Textarea
        value={localText}
        onChange={(e) => setLocalText(e.target.value)}
        onBlur={() => onChangeText(localText)}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="min-h-8 text-sm resize-none py-1"
      />
      <div className="flex flex-wrap items-center gap-2">
        {/* 빈칸은 오답. 답을 쓴 뒤 AI 판정 대기 중(undefined)일 때만 칩을 숨긴다 */}
        <CorrectChip isCorrect={hasAnswer ? answer?.is_correct : false} needsReview={answer?.needs_review === true} feedback={answer?.ai_feedback} />
        <AnswerKey q={q} />
      </div>
    </div>
  )
}

function AnswerCell({ q, answer, disabled, onChangeAnswer, onChangeText }: {
  q: ExamQuestion
  answer: AnswerLike
  disabled: boolean
  onChangeAnswer: (n: number | null) => void
  onChangeText: (t: string) => void
}) {
  if (q.question_style === 'objective') {
    return <ObjectiveMarks q={q} answer={answer} disabled={disabled} onChange={onChangeAnswer} />
  }
  if (q.question_style === 'ox') {
    const savedText = answer?.student_answer_text?.trim() ?? ''
    const isCorrect = gradeOXAnswer(q, savedText) === true
    return (
      <div className="flex flex-wrap items-center gap-2">
        <OXInput
          textValue={savedText}
          onChange={onChangeText}
          disabled={disabled}
          notation={oxNotation(q.correct_answer_text)}
        />
        {/* 미체크도 오답이라 표시를 숨기지 않는다 — 숨기면 아직 안 본 칸처럼 보인다 */}
        <span className={cn('text-xs font-bold', isCorrect ? 'text-green-500' : 'text-red-400')}>
          {isCorrect ? '✓' : '✗'}
        </span>
        <AnswerKey q={q} />
      </div>
    )
  }
  if (q.question_style === 'multi_select') {
    const hasAnswer = !!answer?.student_answer_text
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={answer?.student_answer_text ?? ''}
          onChange={(e) => onChangeText(e.target.value)}
          disabled={disabled}
          placeholder={`예: ${q.correct_answer_text ?? '1,3'}`}
          className="h-7 w-28 text-sm"
        />
        <CorrectChip isCorrect={hasAnswer ? answer?.is_correct : false} />
        <AnswerKey q={q} />
      </div>
    )
  }
  return <TextAnswerCell q={q} answer={answer} disabled={disabled} onChangeText={onChangeText} />
}

const STYLE_SHORT: Record<ExamQuestion['question_style'], string | null> = {
  objective: null,
  ox: 'O/X',
  subjective: '서술',
  multi_select: '복수',
  find_error: '교정',
}

export function ExamSheetContent({ weekId, row, questions, readingTotal, examPhotoPath, updateRow, updateAnswer, updateAnswerText }: {
  weekId: string
  row: GradeRow
  questions: ExamQuestion[]
  readingTotal: number
  /** 저장된 답안지 사진 경로 (exam-photos 버킷) — 없으면 null */
  examPhotoPath?: string | null
  updateRow: (studentId: string, key: keyof GradeRow, value: unknown) => void
  updateAnswer: (studentId: string, questionId: string, value: number | null) => void
  updateAnswerText: (studentId: string, questionId: string, text: string) => void
}) {
  const hasSubjective = questions.some((q) => q.question_style === 'subjective')
  const disabled = !row.present || !row.reading_present
  const [openImageIds, setOpenImageIds] = useState<Set<string>>(new Set())
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [rereading, setRereading] = useState(false)

  // 사진 경로가 바뀌면 이전 서명 URL 을 즉시 지운다 — 렌더 중 조정 (다른 학생 사진이 잠깐 남는 것 방지)
  const [syncedPhotoPath, setSyncedPhotoPath] = useState<string | null | undefined>(examPhotoPath)
  if (syncedPhotoPath !== examPhotoPath) {
    setSyncedPhotoPath(examPhotoPath)
    setPhotoUrl(null)
  }
  useEffect(() => {
    if (!examPhotoPath) return
    // fetch 후(then 안) setState — 렌더 중 동기 호출이 아니라 규칙에 걸리지 않는다
    fetch(`/api/vocab-photo-url?bucket=exam-photos&path=${encodeURIComponent(examPhotoPath)}`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setPhotoUrl(d.url) })
      .catch(() => {})
  }, [examPhotoPath])

  // 저장된 사진으로 재판독 — 재촬영 없이 OCR 만 다시 돌려 답을 다시 채운다
  async function rereadFromStored() {
    setRereading(true)
    try {
      const resp = await fetch(`/api/weeks/${weekId}/ocr-exam-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: row.student_id, useStored: true }),
      })
      const data = await resp.json()
      if (data.ok) applyOcrResults(data.results)
    } catch {
      // 버튼 옆 상태 표시 없이 조용히 실패 — 재시도 가능
    } finally {
      setRereading(false)
    }
  }

  function applyOcrResults(results: ExamOcrResult[]) {
    for (const r of results) {
      const q = questions.find(
        (q) => q.question_number === r.question_number && (q.sub_label ?? null) === (r.sub_label ?? null)
      )
      if (!q) continue
      if (r.student_answer !== undefined) {
        updateAnswer(row.student_id, q.id, r.student_answer)
      } else if (r.student_answer_text !== undefined) {
        updateAnswerText(row.student_id, q.id, r.student_answer_text)
      }
    }
  }

  function toggleImage(id: string) {
    setOpenImageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const answerOf = (q: ExamQuestion): AnswerLike => row.answers.find((a) => a.exam_question_id === q.id)

  // 답안지와 같은 행 구성: 번호별로 묶고(소문항은 한 행에 가로), 번호 순서
  const groups = [...questions
    .reduce<Map<number, ExamQuestion[]>>((acc, q) => {
      const list = acc.get(q.question_number) ?? []
      list.push(q)
      acc.set(q.question_number, list)
      return acc
    }, new Map())
    .entries()]
    .sort(([a], [b]) => a - b)
    .map(([qNum, group]) => ({ qNum, group }))

  // 요약: 정 / 오 / 입력 수 (무효 문항 제외)
  const gradable = questions.filter((q) => !q.is_void)
  let correctCount = 0
  let wrongCount = 0
  let blankCount = 0
  for (const q of gradable) {
    const a = answerOf(q)
    const hasInput = q.question_style === 'objective'
      ? a?.student_answer !== null && a?.student_answer !== undefined
      : !!a?.student_answer_text?.trim()

    // 빈칸은 유형과 무관하게 오답이다 — 서버(grade route)도 전 유형에서 false 를 저장하고,
    // 학부모 오답노트에도 "미작성" 오답 카드로 나간다. 여기서만 미판정으로 빼면
    // 화면 규칙과 저장 규칙이 갈라진다 (8/25 T/F 오채점이 그 구조였다).
    // 단 "입력했는데 아직 판정 없음"(서술형 AI 대기)은 그대로 미판정으로 둔다 —
    // 답을 쓴 서술형까지 AI 채점 전에 오답으로 찍으면 안 된다.
    let result: boolean | undefined
    if (!hasInput) {
      blankCount += 1
      result = false
    } else if (q.question_style === 'objective') {
      result = gradeObjective(q, a?.student_answer)
    } else if (q.question_style === 'ox') {
      // 저장값 대신 서버와 같은 함수로 직접 판정 — 저장된 is_correct 가 낡아도 화면은 맞는다
      result = gradeOXAnswer(q, a?.student_answer_text)
    } else {
      result = a?.is_correct
    }

    if (result === undefined) continue
    if (result) correctCount += 1
    else wrongCount += 1
  }

  return (
    <div>
      {/* OCR 촬영 버튼 */}
      {questions.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50/30">
          <span className="text-xs text-gray-400 mr-1">답안 OCR</span>
          <ExamPhotoButton
            weekId={weekId}
            studentId={row.student_id}
            disabled={!row.present}
            onResult={applyOcrResults}
          />
          {photoUrl && (
            <>
              <button
                type="button"
                onClick={() => setPhotoOpen(true)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
              >
                <ImageIcon className="h-3 w-3" />
                원본 사진
              </button>
              <button
                type="button"
                disabled={rereading || !row.present}
                onClick={rereadFromStored}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 transition-colors shrink-0 disabled:text-gray-300"
              >
                {rereading ? '재판독 중...' : '저장 사진 재판독'}
              </button>
            </>
          )}
        </div>
      )}

      {/* 답안지 사진 전체보기 오버레이 */}
      {photoOpen && photoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPhotoOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="답안지 사진" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
            <button
              onClick={() => setPhotoOpen(false)}
              className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow text-gray-600 hover:bg-gray-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 미응시 토글 */}
      {(questions.length > 0 || readingTotal > 0) && (
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50/50">
          <Switch
            checked={row.reading_present}
            disabled={!row.present}
            onCheckedChange={(checked) => updateRow(row.student_id, 'reading_present', checked)}
          />
          <span className="text-xs text-gray-500">
            {row.reading_present ? '응시' : '미응시'}
          </span>
        </div>
      )}

      {/* 진단평가 직접 입력 (문항 없는 경우) */}
      {readingTotal > 0 && questions.length === 0 && row.reading_present && (
        <div className="px-4 py-3">
          <ScoreToggleField
            label="진단평가"
            total={readingTotal}
            value={row.reading_correct}
            nullLabel="미입력"
            disabled={!row.present}
            onChange={(v) => updateRow(row.student_id, 'reading_correct', v)}
          />
        </div>
      )}

      {questions.length === 0 && readingTotal === 0 && (
        <p className="px-4 py-6 text-xs text-gray-400 text-center">
          설정 → 해설지 탭에서 PDF를 올리면 문항이 표시됩니다.
        </p>
      )}

      {questions.length > 0 && (
        <div className={cn('p-4 space-y-2', !row.reading_present && 'opacity-40 pointer-events-none')}>
          {/* 요약 — 단어 정오표와 같은 형식 */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              <span className="text-green-600 font-medium">{correctCount}정</span>
              &nbsp;/&nbsp;
              <span className="text-red-400 font-medium">{wrongCount}오</span>
              {blankCount > 0 && <>&nbsp;/ 미작성 {blankCount}</>}
            </p>
            <p className="text-[11px] text-gray-300">
              <span className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-emerald-400 align-[-1px] mr-1" />정답
            </p>
          </div>

          {/* 답안지 표 */}
          <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <colgroup>
              <col className="w-11" />
              <col />
            </colgroup>
            <tbody>
              {groups.map(({ qNum, group }) => {
                const first = group[0]
                const hasSub = group.length > 1 || first.sub_label !== null
                const groupHasImage = group.some((q) => q.source_image_path || q.needs_source_image)
                const imageOpen = openImageIds.has(first.id)
                const anyVoid = group.some((q) => q.is_void)
                const anyAllCorrect = group.some((q) => q.all_correct)
                const styleLabel = STYLE_SHORT[first.question_style]
                return (
                  <tr key={qNum} className="border-b border-gray-200 last:border-b-0">
                    {/* 번호 칸 — 답안지의 주황 칸 */}
                    <td className="border-r border-gray-200 bg-orange-50 px-1 py-1.5 text-center align-top text-xs font-bold text-gray-800">
                      <div className="pt-1">{qNum}</div>
                      {styleLabel && <div className="text-[9px] font-medium text-gray-400">{styleLabel}</div>}
                    </td>
                    {/* 답 칸 */}
                    <td className="px-2 py-1.5 align-top">
                      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                        {group.map((q) => (
                          <div key={q.id} className={cn('flex items-center gap-1.5', !hasSub && 'min-w-0 flex-1')}>
                            {hasSub && (
                              <span className="w-6 shrink-0 text-center text-xs font-bold text-gray-500">({q.sub_label})</span>
                            )}
                            <AnswerCell
                              q={q}
                              answer={answerOf(q)}
                              disabled={disabled}
                              onChangeAnswer={(n) => updateAnswer(row.student_id, q.id, n)}
                              onChangeText={(t) => updateAnswerText(row.student_id, q.id, t)}
                            />
                          </div>
                        ))}
                        <div className="ml-auto flex items-center gap-1 self-center">
                          {anyVoid && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-400">무효</span>}
                          {!anyVoid && anyAllCorrect && <span className="rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">전원정답</span>}
                          {groupHasImage && (
                            <button
                              type="button"
                              onClick={() => toggleImage(first.id)}
                              title={first.source_image_path ? '원본 페이지 보기' : '원본 이미지 필요 (저장된 이미지 없음)'}
                              className={cn(
                                'shrink-0 rounded p-0.5 transition-colors',
                                imageOpen ? 'bg-slate-200 text-slate-600' : first.source_image_path ? 'text-gray-300 hover:text-gray-500' : 'text-amber-400 hover:text-amber-500',
                              )}
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {imageOpen && (
                        <div className="mt-2">
                          <SourceImagePreview question={first} compact />
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {hasSubjective && row.reading_present && (
        <p className="px-4 py-2 text-xs text-amber-600 border-t bg-amber-50/50">
          서술형은 채점 저장 버튼을 눌러야 AI 채점됩니다
        </p>
      )}
    </div>
  )
}
