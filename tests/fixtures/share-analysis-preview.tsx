import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnalysisTab } from '@/app/share/[token]/tabs/analysis-tab'
import { TagDrawer, type DrawerTag } from '@/app/share/[token]/tag-drawer'
import { useShareModel } from '@/app/share/[token]/use-share-model'
import { analysisAnswer, analysisData, analysisFixture, analysisWeek, insightFixture, manyTypesFixture } from './share-analysis'

// Distinct rates let the comparison layout be reviewed without altering the equal-rate fixture.
const comparisonCounts = [[2, 1, 1, 1], [2, 2, 2, 3], [2, 3, 3, 3], [3, 3, 3, 4], [3, 4, 4, 4], [4, 4, 4, 4]]
const comparison = analysisData(manyTypesFixture.studentAnswers.map((answer) => {
  const tagId = answer.exam_question?.exam_question_tag[0]?.concept_tag?.id ?? ''
  const typeIndex = Number(tagId.replace('many-', ''))
  const counts = comparisonCounts[typeIndex]
  if (!counts || !answer.exam_question) return answer
  const weekIndex = manyTypesFixture.weeks.findIndex((week) => week.id === answer.exam_question!.week_id)
  const question = (answer.exam_question.question_number - 1) % 5
  return { ...answer, is_correct: question < counts[weekIndex] }
}), manyTypesFixture.weeks)
const recentWeeks = Array.from({ length: 12 }, (_, index) => analysisWeek(`recent-${index + 1}`, index + 1,
  new Date(Date.UTC(2026, 6, 6 + index * 7)).toISOString().slice(0, 10)))
const recentWarning = analysisData(recentWeeks.flatMap((week, index) =>
  Array.from({ length: index < 8 ? 10 : 4 }, (_, question) => analysisAnswer(`${week.id}-${question}`, week.id, index < 8 || question === 0))), recentWeeks)
const recoveryWeeks = recentWeeks.slice(0, 8)
const recovered = analysisData(recoveryWeeks.flatMap((week, index) =>
  Array.from({ length: 5 }, (_, question) => analysisAnswer(`${week.id}-${question}`, week.id, index >= 4 || question === 0))), recoveryWeeks)
const cases = {
  compare: { label: '기본 분석', data: comparison },
  short: { label: '기록 부족', data: analysisFixture },
  warning: { label: '최근 오답 증가', data: recentWarning },
  recovered: { label: '최근 회복', data: recovered },
  perfect: { label: '모두 정답', data: analysisData(insightFixture.studentAnswers.map((answer) => ({ ...answer, is_correct: true })), insightFixture.weeks) },
}

type PreviewCase = keyof typeof cases

// This isolated preview runs in the browser, without Next.js or server rendering.
// Query options also let screenshots reproduce a specific sample and appearance.
const initialQuery = new URLSearchParams(window.location.search)
const initialSample = initialQuery.get('sample')
const initialCase: PreviewCase = initialSample && Object.hasOwn(cases, initialSample)
  ? initialSample as PreviewCase
  : 'compare'
const initialDark = initialQuery.get('theme') === 'dark'
const capture = initialQuery.get('capture') === '1'
document.documentElement.classList.toggle('dark', initialDark)

function updatePreviewQuery(sample: PreviewCase, dark: boolean) {
  const url = new URL(window.location.href)
  url.searchParams.set('sample', sample)
  url.searchParams.set('theme', dark ? 'dark' : 'light')
  window.history.replaceState(null, '', url)
}

function Preview() {
  const [selected, setSelected] = useState<PreviewCase>(initialCase)
  const [dark, setDark] = useState(initialDark)
  const [tag, setTag] = useState<DrawerTag | null>(null)
  const model = useShareModel(cases[selected].data)
  const periodLabel = selected === 'warning' || selected === 'recovered' ? '7–9월' : '9월'
  const answers = cases[selected].data.studentAnswers.filter((answer) => !answer.is_correct && (!tag?.id || answer.exam_question?.exam_question_tag.some(({ concept_tag }) => concept_tag?.id === tag.id)))

  function changeSample(sample: PreviewCase) {
    setSelected(sample)
    setTag(null)
    updatePreviewQuery(sample, dark)
  }

  function changeTheme() {
    const nextDark = !dark
    setDark(nextDark)
    document.documentElement.classList.toggle('dark', nextDark)
    updatePreviewQuery(selected, nextDark)
  }

  return (
    <div className="min-h-screen bg-[var(--share-canvas)] text-[var(--share-ink)]">
      {!capture && (
        <aside aria-label="시안 검토 도구" className="border-b border-[var(--share-line)]">
          <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
            <div>
              <p className="text-[13px] font-bold">분석 시안</p>
              <p className="mt-0.5 text-[11px] text-[var(--share-muted)]">가상 기록으로 학습 상황을 살펴보세요.</p>
            </div>
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
                <span className="shrink-0 text-[var(--share-muted)]">학습 상황</span>
                <select aria-label="시안 학습 상황" value={selected} onChange={(event) => changeSample(event.target.value as PreviewCase)} className="min-h-11 min-w-0 flex-1 rounded-xl bg-[var(--control-bg)] px-3 text-[var(--control-fg)] sm:min-w-36">
                  {Object.entries(cases).map(([id, sample]) => <option key={id} value={id}>{sample.label}</option>)}
                </select>
              </label>
              <button type="button" aria-pressed={dark} onClick={changeTheme} className="min-h-11 shrink-0 rounded-xl bg-[var(--control-bg)] px-3 text-[12px] font-bold text-[var(--control-fg)]">{dark ? '라이트로 전환' : '다크로 전환'}</button>
            </div>
          </div>
        </aside>
      )}
      <main aria-label="김민준 학생의 학습 분석 시안" className="mx-auto max-w-[430px] px-4 pt-6 pb-12 sm:pt-9">
        <header className="mb-3 flex items-start justify-between gap-4 border-b border-[var(--share-line)] px-1.5 pb-5">
          <div>
            <p className="text-[12px] text-[var(--share-muted)]">고2 · 가상 학생</p>
            <p className="mt-1 text-[20px] leading-tight font-extrabold">김민준</p>
          </div>
          <div className="pt-1 text-right">
            <p className="text-[12px] font-bold">{periodLabel} 학습 분석</p>
            <p className="mt-1 text-[11px] text-[var(--share-muted)]">가상 학습 기록</p>
          </div>
        </header>
        <AnalysisTab key={selected} model={model} periodLabel={periodLabel} onTagClick={(id, name) => setTag({ id, name })} onOpenWrongNote={() => setTag({ id: '', name: '전체' })} />
      </main>
      <TagDrawer tag={tag} answers={answers} token="preview" weekLabelByWeekId={model.weekLabelByWeekId} onClose={() => setTag(null)} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
