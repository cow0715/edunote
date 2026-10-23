'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { questionLabel } from '@/lib/question-presentation'
import { answerKey, type AnswerDraft, type ReviewAction } from '@/lib/week-answer-review'

const styleNames = { objective: '객관식', subjective: '서답형', ox: 'O/X · T/F', multi_select: '복수정답', find_error: '오류교정' }

function PdfSourcePage({ url }: { url: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  return <div className="h-[45vh] min-h-72 overflow-auto rounded-lg border bg-white lg:h-[65vh]">
    {status === 'loading' && <p role="status" className="p-4 text-sm text-gray-600">원문 페이지를 불러오는 중…</p>}
    {status === 'error' ? <div role="alert" className="space-y-3 p-4 text-sm text-gray-700"><p>원문 페이지를 표시하지 못했습니다. 다시 시도하거나 원본 PDF를 새 탭에서 열어 주세요.</p><Button variant="outline" onClick={() => { setStatus('loading'); setAttempt(v => v + 1) }}>페이지 다시 불러오기</Button></div>
      : <Image title="선택한 PDF 원문" alt="선택한 PDF 원문 페이지" src={`${url}&view=page&attempt=${attempt}`} width={900} height={1300} unoptimized className="h-auto w-full" onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />}
  </div>
}

export function AnswerReviewPanel({ draft, weekId, onConfirm, saving }: {
  draft: AnswerDraft; weekId: string; onConfirm: (actions: ReviewAction[]) => Promise<void>; saving: boolean
}) {
  const [edits, setEdits] = useState<Record<number, Partial<ReviewAction>>>({})
  const [acknowledged, setAcknowledged] = useState(false)
  const [filter, setFilter] = useState<'needs' | 'all'>('needs')
  const [sourceView, setSourceView] = useState({ index: 0, page: 1 })
  const confirmed = draft.status === 'confirmed'
  const rows = (confirmed ? draft.reviewed_answers ?? draft.answers : draft.answers).map(q => ({ ...q, correct_answer: q.correct_answer ?? 0 }))
  const sourcesUrl = (index: number, page?: number) => `/api/weeks/${weekId}/answer-review?draft=${draft.id}&source=${index}${page ? `&page=${page}` : ''}`
  const existing = new Map(draft.base_questions.map(q => [answerKey(q), q]))
  const actions = rows.map((q, index) => ({ index, reviewed: true as const, question_style: q.question_style,
    sub_label: q.sub_label, correct_answer: q.correct_answer, correct_answer_text: q.correct_answer_text, ...edits[index] }))
  const selectedKeys = new Set(actions.map((a, i) => answerKey({ ...rows[i], sub_label: a.sub_label })))
  const missingExisting = draft.base_questions.filter(q => !selectedKeys.has(answerKey(q)))
  const identityMismatch = existing.size > 0 && (missingExisting.length > 0 || selectedKeys.size !== existing.size)
  const update = (index: number, patch: Partial<ReviewAction>) => setEdits(previous => ({ ...previous, [index]: { ...previous[index], ...patch } }))
  const needsAttention = rows.map((q, i) => {
    const previous = existing.get(answerKey({ ...q, sub_label: actions[i].sub_label }))
    return !q.evidence_verified || !!q.extraction_issues?.length || existing.size > 0 && !previous || !!previous &&
      (previous.question_style !== q.question_style || previous.correct_answer !== q.correct_answer || previous.correct_answer_text !== q.correct_answer_text)
  })
  const incomplete = actions.map((a, i) => !a.keep_existing &&
    ((!rows[i].evidence_verified && !a.manual) || (a.question_style === 'objective' ? a.correct_answer < 1 || a.correct_answer > 5 : !a.correct_answer_text?.trim())))
  const unresolved = incomplete.filter(Boolean).length
  const attentionCount = needsAttention.filter(Boolean).length
  const visibleCount = confirmed || filter === 'all' ? rows.length : attentionCount
  const source = draft.sources[sourceView.index]
  const showSource = (i: number) => {
    const q = rows[i]
    const evidence = q.answer_evidence
    const cited = evidence && draft.sources[evidence.file_index - 1]
    if (evidence && cited && evidence.page > 0 && evidence.page <= cited.pageCount) {
      setSourceView({ index: evidence.file_index - 1, page: evidence.page })
    } else {
      const index = Math.max(0, draft.sources.findIndex(s => s.role !== 'answers'))
      setSourceView({ index, page: Math.max(1, Math.min(q.source_page ?? 1, draft.sources[index]?.pageCount ?? 1)) })
    }
  }


  return <section aria-label="정답 검토" className="space-y-4 rounded-[20px] border bg-card p-4 text-foreground">
    <div><h3 className="text-base font-semibold">{confirmed ? '확정한 정답 자료' : '2. 정답 확인하기'}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{confirmed ? '확정 기록과 원본 자료를 보관하고 있습니다.' : '확인이 필요한 정답부터 원문과 대조해 주세요. 입력한 내용은 확정 전까지 채점에 반영되지 않습니다.'}</p></div>
    {!confirmed && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-3">
      <p className="text-sm font-medium">총 {rows.length}문항 · 확인 필요 {attentionCount}개{unresolved > 0 ? ` · 정답 입력 대기 ${unresolved}개` : ' · 정답 입력 완료'}</p>
      <div className="flex gap-1" aria-label="문항 보기 필터">
        <Button variant={filter === 'needs' ? 'secondary' : 'ghost'} size="sm" aria-pressed={filter === 'needs'} onClick={() => setFilter('needs')}>확인 필요한 문항</Button>
        <Button variant={filter === 'all' ? 'secondary' : 'ghost'} size="sm" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체 문항</Button>
      </div>
    </div>}
    {!confirmed && existing.size > 0 && <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
      <p>기존 정답과 학생 답안은 보존합니다. 문항 구성이 달라진 시험은 새 주차에 등록해 주세요.</p>
      <Button variant="outline" size="sm" onClick={() => setEdits(Object.fromEntries(actions.map((a, i) => [i,
        existing.has(answerKey({ ...rows[i], sub_label: a.sub_label })) ? { ...a, keep_existing: true } : a])))}>일치하는 문항의 기존 정답 모두 유지</Button>
    </div>}
    {!confirmed && identityMismatch && <div role="alert" className="rounded-xl border border-destructive p-3 text-sm text-destructive">기존 문항과 연결되지 않은 항목이 있습니다. 소문항을 확인해 주세요. 다른 시험은 새 주차에 등록해 주세요.{missingExisting.length > 0 && <p className="mt-2">보존할 기존 문항: {missingExisting.map(q => questionLabel(q)).join(', ')}</p>}</div>}
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside aria-label="PDF 원문" className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-3 lg:sticky lg:top-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">PDF 원문</h4>
          {source && <a href={sourcesUrl(sourceView.index, sourceView.page)} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">새 탭에서 보기</a>}</div>
        <label className="block text-sm"><span className="sr-only">원본 자료 선택</span><select aria-label="원본 자료 선택" className="min-h-11 w-full rounded-md border bg-background px-2" value={sourceView.index} onChange={e => setSourceView({ index: Number(e.target.value), page: 1 })}>
          {draft.sources.map((s, i) => <option key={i} value={i}>{s.role === 'answers' ? '정답·해설지' : s.role === 'questions' ? '문제지' : '통합 자료'} · {s.fileName}</option>)}
        </select></label>
        {source && <>
          <div className="flex items-center justify-between gap-2 text-sm"><Button variant="outline" size="sm" disabled={sourceView.page <= 1} onClick={() => setSourceView(v => ({ ...v, page: v.page - 1 }))}>이전 쪽</Button>
            <span aria-live="polite">{sourceView.page} / {source.pageCount}쪽</span><Button variant="outline" size="sm" disabled={sourceView.page >= source.pageCount} onClick={() => setSourceView(v => ({ ...v, page: v.page + 1 }))}>다음 쪽</Button></div>
          <PdfSourcePage key={`${sourceView.index}:${sourceView.page}`} url={sourcesUrl(sourceView.index, sourceView.page)} />
        </>}
        <p className="text-xs text-muted-foreground">문항의 ‘원문 보기’를 누르면 해당 쪽으로 이동합니다. PDF가 보이지 않으면 새 탭에서 열어 주세요.</p>
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3">원본 자료 {draft.sources.length}개</summary><div className="space-y-2" aria-label="원본 자료 세트">{draft.sources.map((s, i) =>
          <a key={i} href={sourcesUrl(i)} target="_blank" rel="noopener noreferrer" className="block break-all underline underline-offset-4">{s.role === 'answers' ? '정답·해설지' : s.role === 'questions' ? '문제지' : '통합 자료'}: {s.fileName} · {s.pageCount}쪽</a>)}</div></details>
      </aside>
      <div className="min-w-0 divide-y" aria-label="정답 목록">
      {visibleCount === 0 && <div className="space-y-3 py-6"><p className="font-medium">따로 확인할 문항이 없습니다.</p><p className="text-sm text-muted-foreground">전체 문항에서 정답을 훑어본 뒤 아래에서 검토를 완료해 주세요.</p><Button variant="outline" onClick={() => setFilter('all')}>전체 정답 보기</Button></div>}
      {rows.map((q, i) => {
      const a = actions[i]
      const previous = existing.get(answerKey({ ...q, sub_label: a.sub_label }))
      const changed = previous && (previous.question_style !== q.question_style || (q.question_style === 'objective' && previous.correct_answer !== q.correct_answer) || previous.correct_answer_text !== q.correct_answer_text)
      const e = q.answer_evidence
      if (!confirmed && filter === 'needs' && !needsAttention[i]) return null
      return <details key={i} open={!confirmed && needsAttention[i]} className="py-4">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{questionLabel(q)}<span className="ml-3 text-sm font-normal text-muted-foreground">{a.keep_existing && previous ? `기존 정답 ${previous.correct_answer_text ?? previous.correct_answer ?? '미입력'} 유지` : a.question_style === 'objective' ? a.correct_answer ? `정답 ${a.correct_answer}` : '정답 입력 필요' : a.correct_answer_text || '정답 입력 필요'}</span></span>
          <span className={`text-xs ${!confirmed && incomplete[i] ? 'text-destructive' : 'text-muted-foreground'}`}>{confirmed ? '확정 완료' : incomplete[i] ? '확인 필요 · 펼치기' : needsAttention[i] ? '입력 완료 · 펼치기' : '근거 확인됨 · 펼치기'}</span>
        </summary>
        <div className="space-y-3 pt-3" aria-label={`${questionLabel(q)} 검토`}>
        <Button variant="outline" size="sm" onClick={() => showSource(i)}>{questionLabel(q)} 원문 보기</Button>
        {!confirmed && !!q.extraction_issues?.length && <p className="text-sm text-destructive">원문 문항 구조를 확인해 주세요. 정답을 확정하기 전에 원본 자료를 열어 대조해 주세요.</p>}
        {q.question_stem && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{q.question_stem}</p>}
        {e && <details className="rounded-xl bg-muted p-3 text-sm"><summary className="cursor-pointer">{q.evidence_verified ? '정답 근거' : '확인되지 않은 근거'} · 자료 {e.file_index}, {e.page}쪽</summary>
          <blockquote className="mt-2 whitespace-pre-wrap">{e.quote}</blockquote>
          <button type="button" className="mt-2 min-h-11 underline" onClick={() => showSource(i)}>이 근거를 PDF에서 보기</button>
        </details>}
        {confirmed && <p className="text-sm">정답: {q.question_style === 'objective' ? q.correct_answer : q.correct_answer_text}</p>}
        {!confirmed && <>
          {changed && <p className="text-sm text-destructive">기존 정답과 다릅니다. 기존 값: {previous.question_style === 'objective' ? previous.correct_answer : previous.correct_answer_text}</p>}
          {previous && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={a.keep_existing ?? false} onChange={event => update(i, { keep_existing: event.target.checked })} />기존 정답 유지</label>}
          <div className="space-y-3">
            <label className="block space-y-1 text-sm"><span className="block">정답</span><Input aria-label={`${questionLabel(q)} 정답`} value={a.keep_existing && previous ? previous.question_style === 'objective' ? previous.correct_answer ?? '' : previous.correct_answer_text ?? '' : a.question_style === 'objective' ? a.correct_answer || '' : a.correct_answer_text ?? ''} disabled={a.keep_existing}
              placeholder={a.question_style === 'objective' ? '1~5' : a.question_style === 'find_error' ? '기호:수정어 (예: b:struggle)' : '원문을 확인하고 입력'}
              onChange={event => update(i, a.question_style === 'objective' ? { correct_answer: Number(event.target.value) || 0, manual: true } : { correct_answer_text: event.target.value, manual: true })} /></label>
            <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">답안 유형·소문항 수정</summary><div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm"><span className="block">답안 유형</span><select aria-label={`${questionLabel(q)} 답안 유형`} className="min-h-11 rounded-md border bg-background px-2" value={a.keep_existing && previous ? previous.question_style : a.question_style} disabled={a.keep_existing} onChange={event => update(i, { question_style: event.target.value as ReviewAction['question_style'], manual: true })}>
              {Object.entries(styleNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select></label>
            <label className="w-24 space-y-1 text-sm"><span className="block">소문항</span><Input aria-label={`${questionLabel(q)} 소문항`} maxLength={1} value={a.sub_label ?? ''} disabled={a.keep_existing} onChange={event => update(i, { sub_label: event.target.value.toLowerCase() || null, keep_existing: false, manual: true })} /></label>
            </div></details>
          </div>
          {!q.evidence_verified && !a.keep_existing && <p className="text-xs text-muted-foreground">원문에서 확인한 정답을 입력해 주세요. AI가 추정한 정답은 사용하지 않습니다.</p>}
        </>}
        </div>
      </details>
    })}</div></div>
    {!confirmed && <div className="space-y-3 border-t pt-4">
      {unresolved > 0 && <p role="status" className="text-sm text-destructive">정답 확인이 필요한 항목 {unresolved}개</p>}
      <h4 className="font-semibold">3. 검토 완료하기</h4>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />전체 정답표와 원문을 확인했습니다</label>
      <Button disabled={!acknowledged || unresolved > 0 || identityMismatch || saving} onClick={() => void onConfirm(actions)}>{saving ? '확정 중…' : existing.size ? '기존 정답을 보존하여 확정' : '검토 완료하고 채점에 사용'}</Button>
    </div>}
  </section>
}
