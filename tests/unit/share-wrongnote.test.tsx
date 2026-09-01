// @vitest-environment jsdom
//
// 학부모 공유 화면의 오답노트 경로 테스트.
//
// tsc 도 next build 도 이 경로를 "실행" 하지는 않는다. 널 참조나 prop 오배선은
// 렌더해봐야 드러나므로 여기서 태운다.
//
// 특히 예문 유형(빈칸·선택)은 실데이터에서만 나오는 조합이 많아 픽스처로 고정해둔다.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RetakeActionRow, WrongAnswerCard, WrongVocabRow } from '@/app/share/[token]/wrong-answer-card'
import { WrongNoteTab } from '@/app/share/[token]/tabs/wrongnote-tab'
import type { ShareModel } from '@/app/share/[token]/use-share-model'
import { splitCommonQuestionText, splitQuestionTexts } from '@/app/share/[token]/share-utils'
import type { StudentAnswer, VocabAnswer, VocabWord, Week, WeekScore } from '@/app/share/[token]/share-types'

afterEach(cleanup)

// ── 픽스처 ──────────────────────────────────────────────────────────────────
function makeWord(over: Partial<VocabWord> = {}): VocabWord {
  return {
    id: 'w1', week_id: 'wk1', number: 3, passage_label: 'A',
    english_word: 'abandon', part_of_speech: 'v.',
    correct_answer: '버리다', synonyms: null, antonyms: null, derivatives: null,
    example_sentence: null, example_translation: null,
    ...over,
  }
}

function makeVocabAnswer(over: Partial<VocabAnswer> = {}): VocabAnswer {
  return {
    id: 'va1', week_score_id: 's1', is_correct: false,
    test_number: 3, test_word: 'abandon', test_source: 'meaning',
    test_prompt: null, example_answer: null, choice_meanings: null,
    student_answer: '모으다', retake_answer: null, retake_is_correct: null,
    vocab_word: makeWord(),
    ...over,
  }
}

function makeWeek(over: Partial<Week> = {}): Week {
  return {
    id: 'wk1', class_id: 'c1', week_number: 9, start_date: '2026-05-01',
    vocab_total: 20, reading_total: 28, homework_total: 5,
    ...over,
  }
}

function makeScore(over: Partial<WeekScore> = {}): WeekScore {
  return {
    id: 's1', week_id: 'wk1', reading_correct: 8, vocab_correct: 14,
    homework_done: 5, memo: null, vocab_retake_correct: null,
    ...over,
  }
}

function makeStudentAnswer(over: Partial<StudentAnswer['exam_question']> = {}, top: Partial<StudentAnswer> = {}): StudentAnswer {
  return {
    id: 'a1', week_score_id: 's1', is_correct: false,
    student_answer: 3, student_answer_text: null, ai_feedback: null,
    exam_question: {
      id: 'q1', week_id: 'wk1', question_number: 18, sub_label: null,
      exam_type: 'reading', question_style: 'objective',
      correct_answer: 5, correct_answer_text: null,
      explanation: null, question_text: '다음 글의 목적으로 가장 적절한 것은?',
      question_stem: null, passage: null, choices: null,
      needs_source_image: false, source_image_reason: null,
      source_page: null, source_image_path: null,
      exam_question_tag: [{ concept_tag: { id: 't1', name: '글의 목적 파악', category_id: null, category_name: null } }],
      ...over,
    },
    ...top,
  }
}

// ── 단어 오답 행 ────────────────────────────────────────────────────────────
describe('WrongVocabRow — 뜻쓰기', () => {
  it('단어 · 내 답 · 정답을 한 줄로 보여준다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer()} />)
    expect(screen.getByText('abandon')).toBeTruthy()
    expect(screen.getByText('모으다')).toBeTruthy()
    expect(screen.getByText('버리다')).toBeTruthy()
    expect(screen.getByText('#3')).toBeTruthy()
  })

  it('학생이 비워냈으면 "미작성"으로 표시한다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({ student_answer: null })} />)
    expect(screen.getByText('미작성')).toBeTruthy()
  })

  it('vocab_word 가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<WrongVocabRow answer={makeVocabAnswer({ vocab_word: null })} />)
    expect(container.innerHTML).toBe('')
  })

  it('시험지 단어가 원본과 다르면 원본을 함께 보여준다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({ test_word: 'abandoned' })} />)
    expect(screen.getByText('원본 abandon')).toBeTruthy()
  })
})

describe('WrongVocabRow — 재시험 표시', () => {
  it('아직 재시험을 안 봤으면 뱃지가 없다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({ retake_is_correct: null })} />)
    expect(screen.queryByText(/재시험/)).toBeNull()
  })

  it('재시험을 맞췄으면 ✓ 뱃지가 뜨고 흐려진다', () => {
    const { container } = render(<WrongVocabRow answer={makeVocabAnswer({ retake_is_correct: true })} />)
    expect(screen.getByText('재시험 ✓')).toBeTruthy()
    expect(container.firstElementChild?.className).toContain('opacity-60')
  })

  it('재시험도 틀렸으면 ✗ 뱃지가 뜬다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({ retake_is_correct: false })} />)
    expect(screen.getByText('재시험 ✗')).toBeTruthy()
  })
})

describe('WrongVocabRow — 예문 유형', () => {
  it('빈칸형은 문장 속 빈칸에 학생 답을 채워 보여주고 정답은 따로 둔다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({
      test_source: 'example',
      test_prompt: 'They had to _____ the ship.',
      example_answer: 'abandon',
      student_answer: 'gather',
    })} />)
    // 문장 속 빈칸 자리에 학생 답
    expect(screen.getByText('gather')).toBeTruthy()
    // 정답은 별도로 (예문 유형은 단어 원형·뜻도 참고로 함께 띄우므로 여러 번 등장한다)
    expect(screen.getAllByText('abandon').length).toBeGreaterThan(0)
    expect(screen.getByText('버리다')).toBeTruthy()
    // 문장에 이미 학생 답이 들어갔으므로 "내 답" 라벨은 중복 표시하지 않는다
    expect(screen.queryByText('내 답')).toBeNull()
  })

  it('선택형은 두 후보를 뜻과 함께 나란히 보여준다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({
      test_source: 'example_choice',
      test_prompt: 'They had to [ abandon / gather ] the ship.',
      example_answer: 'abandon',
      student_answer: 'gather',
      choice_meanings: ['버리다', '모으다'],
    })} />)
    expect(screen.getAllByText('abandon').length).toBeGreaterThan(0)
    expect(screen.getByText('버리다')).toBeTruthy()
    expect(screen.getByText('모으다')).toBeTruthy()
  })

  it('예문 유형이면 하단 예문 박스를 중복해서 그리지 않는다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({
      test_source: 'example',
      test_prompt: 'They had to _____ the ship.',
      example_answer: 'abandon',
      vocab_word: makeWord({ example_sentence: 'They had to abandon the ship.' }),
    })} />)
    expect(screen.queryAllByText('They had to abandon the ship.')).toHaveLength(0)
  })

  it('예문 유형이 아니면 하단에 예문 박스를 보여준다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({
      vocab_word: makeWord({ example_sentence: 'They had to abandon the ship.', example_translation: '그들은 배를 버려야 했다.' }),
    })} />)
    expect(screen.getByText('They had to abandon the ship.')).toBeTruthy()
    expect(screen.getByText('그들은 배를 버려야 했다.')).toBeTruthy()
  })
})

describe('WrongVocabRow — 유의어/반의어 라벨', () => {
  // 예전에는 오답노트가 '유/반', 단어장이 '유의/반의' 로 갈려 있었다. 공용 컴포넌트로 통일한 뒤의 회귀 방지.
  it('단어장과 같은 "유의 / 반의" 라벨을 쓴다', () => {
    render(<WrongVocabRow answer={makeVocabAnswer({
      vocab_word: makeWord({ synonyms: ['desert'], antonyms: ['keep'] }),
    })} />)
    expect(screen.getByText('유의 desert')).toBeTruthy()
    expect(screen.getByText('반의 keep')).toBeTruthy()
  })
})

// ── 재시험 액션 행 ──────────────────────────────────────────────────────────
describe('RetakeActionRow', () => {
  it('아직 재시험 전이면 "남음" 없이 문항 수만 보여준다', () => {
    render(<RetakeActionRow originalWrong={6} mastered={0} started={false} onStart={() => {}} />)
    expect(screen.getByText(/재시험 보기 · 6개$/)).toBeTruthy()
  })

  it('재시험을 본 적이 있으면 남은 개수로 표시한다', () => {
    render(<RetakeActionRow originalWrong={6} mastered={2} started onStart={() => {}} />)
    expect(screen.getByText(/재시험 보기 · 4개 남음/)).toBeTruthy()
  })

  it('다 맞췄으면 버튼 대신 완료 표시를 보여준다', () => {
    render(<RetakeActionRow originalWrong={6} mastered={6} started onStart={() => {}} />)
    expect(screen.getByText('6/6')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('버튼을 누르면 onStart 가 불린다', () => {
    const onStart = vi.fn()
    render(<RetakeActionRow originalWrong={6} mastered={0} started={false} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onStart).toHaveBeenCalledOnce()
  })
})

// ── 독해 오답 카드: 해설/첨삭 분기 (개발 DB 에 해설이 없어 미실행이던 경로) ──
describe('WrongAnswerCard', () => {
  it('문항번호 · 유형 · 내 답 · 정답을 보여준다', () => {
    render(<WrongAnswerCard answers={[makeStudentAnswer()]} token="tok" />)
    expect(screen.getByText(/18번/)).toBeTruthy()
    expect(screen.getByText('글의 목적 파악')).toBeTruthy()
    expect(screen.getByText('③')).toBeTruthy()
    expect(screen.getByText('⑤')).toBeTruthy()
  })

  it('해설과 첨삭이 있으면 라벨을 붙여 보여준다', () => {
    render(<WrongAnswerCard
      answers={[makeStudentAnswer({ explanation: '글의 마지막 문단이 요청을 담고 있다.' }, { ai_feedback: '지문 전체 흐름을 먼저 잡아보세요.' })]}
      token="tok"
    />)
    expect(screen.getByText('해설')).toBeTruthy()
    expect(screen.getByText('첨삭')).toBeTruthy()
    expect(screen.getByText('글의 마지막 문단이 요청을 담고 있다.')).toBeTruthy()
    expect(screen.getByText('지문 전체 흐름을 먼저 잡아보세요.')).toBeTruthy()
  })

  it('해설·첨삭이 없으면 빈 라벨을 그리지 않는다', () => {
    render(<WrongAnswerCard answers={[makeStudentAnswer()]} token="tok" />)
    expect(screen.queryByText('해설')).toBeNull()
    expect(screen.queryByText('첨삭')).toBeNull()
  })

  it('서술형은 학생이 쓴 문장을 그대로 보여준다', () => {
    render(<WrongAnswerCard
      answers={[makeStudentAnswer(
        { question_style: 'subjective', correct_answer: null, correct_answer_text: 'to request a refund' },
        { student_answer: null, student_answer_text: 'to complain' },
      )]}
      token="tok"
    />)
    expect(screen.getByText('to complain')).toBeTruthy()
    expect(screen.getByText('to request a refund')).toBeTruthy()
  })

  it('주차 라벨을 넘기면 문항번호 앞에 붙인다 (분석 탭 드로어용)', () => {
    render(<WrongAnswerCard answers={[makeStudentAnswer()]} token="tok" weekLabel="9주차" />)
    expect(screen.getByText('9주차')).toBeTruthy()
  })
})

// ── 오답노트 탭 통합 ────────────────────────────────────────────────────────
function makeModel(over: Partial<ShareModel> = {}): ShareModel {
  const week = makeWeek()
  return {
    wrongNoteGroups: [{ week, answers: [makeStudentAnswer()], className: '고1반' }],
    vocabWrongGroups: [{ week, answers: [makeVocabAnswer()], className: '고1반' }],
    wrongNoteSummary: { readingCount: 1, vocabCount: 1, retakeRemaining: 6 },
    scoreByWeek: new Map([['wk1', makeScore()]]),
    ...over,
  } as unknown as ShareModel
}

function renderTab(props: Partial<React.ComponentProps<typeof WrongNoteTab>> = {}) {
  const handlers = {
    onSubTabChange: vi.fn(),
    onToggleReadingWeek: vi.fn(),
    onToggleVocabWeek: vi.fn(),
    onOpenVocabList: vi.fn(),
    onStartRetake: vi.fn(),
  }
  render(
    <WrongNoteTab
      token="tok"
      model={makeModel()}
      subTab="reading"
      expandedReadingWeekIds={new Set(['wk1'])}
      expandedVocabWeekIds={new Set(['wk1'])}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe('WrongNoteTab', () => {
  it('세그먼트에 종류별 오답 개수를 함께 보여준다', () => {
    renderTab()
    const buttons = screen.getAllByRole('button')
    const reading = buttons.find((b) => b.textContent?.startsWith('진단평가'))!
    const vocab = buttons.find((b) => b.textContent?.startsWith('단어'))!
    expect(within(reading).getByText('1')).toBeTruthy()
    expect(vocab.getAttribute('aria-pressed')).toBe('false')
    expect(reading.getAttribute('aria-pressed')).toBe('true')
  })

  it('주차 아코디언에 aria-expanded 를 노출한다', () => {
    renderTab()
    const header = screen.getAllByRole('button').find((b) => b.textContent?.includes('9주차'))!
    expect(header.getAttribute('aria-expanded')).toBe('true')
  })

  it('재시험이 남았으면 요약 줄을 띄우고, 누르면 단어장의 "재시험 남은 단어"로 보낸다', () => {
    const h = renderTab()
    fireEvent.click(screen.getByText('재시험 6개 남음'))
    expect(h.onOpenVocabList).toHaveBeenCalledWith(null, 'retake_pending')
  })

  it('재시험이 없으면 요약 줄을 띄우지 않는다', () => {
    renderTab({ model: makeModel({ wrongNoteSummary: { readingCount: 1, vocabCount: 1, retakeRemaining: 0 } as ShareModel['wrongNoteSummary'] }) })
    expect(screen.queryByText(/재시험 .*남음/)).toBeNull()
  })

  it('단어 탭에서 "이 주차 단어장 전체 보기"가 해당 주차로 단어장을 연다', () => {
    const h = renderTab({ subTab: 'vocab' })
    fireEvent.click(screen.getByText('이 주차 단어장 전체 보기'))
    expect(h.onOpenVocabList).toHaveBeenCalledWith('wk1', 'all')
  })

  it('단어 탭에서 재시험 버튼이 해당 주차 재시험을 시작한다', () => {
    const h = renderTab({ subTab: 'vocab' })
    fireEvent.click(screen.getByText(/재시험 보기/))
    expect(h.onStartRetake).toHaveBeenCalledWith('wk1')
  })

  it('단어를 다 맞은 주차에는 재시험 행을 그리지 않는다', () => {
    renderTab({
      subTab: 'vocab',
      model: makeModel({ scoreByWeek: new Map([['wk1', makeScore({ vocab_correct: 20 })]]) as ShareModel['scoreByWeek'] }),
    })
    expect(screen.queryByText(/재시험 보기/)).toBeNull()
  })

  it('오답이 없으면 빈 상태를 보여준다', () => {
    renderTab({ model: makeModel({ wrongNoteGroups: [] as ShareModel['wrongNoteGroups'] }) })
    expect(screen.getByText('진단평가 오답 데이터가 없습니다')).toBeTruthy()
  })

  it('접힌 주차의 문항은 그리지 않는다', () => {
    renderTab({ expandedReadingWeekIds: new Set() })
    expect(screen.queryByText('글의 목적 파악')).toBeNull()
  })
})

// ── 소문항 묶음 ─────────────────────────────────────────────────────────────
//
// 내신은 한 지문에 소문항이 여러 개 달린다 (운영에 요약문 빈칸 7개짜리가 있다).
// 소문항마다 카드를 그리면 같은 지문이 7번 반복되므로 묶어서 그린다.
describe('WrongAnswerCard — 소문항 묶음', () => {
  const sub = (label: string, over: Partial<StudentAnswer['exam_question']> = {}, top: Partial<StudentAnswer> = {}) =>
    makeStudentAnswer(
      { sub_label: label, question_number: 8, question_text: '다음 글을 아래와 같이 요약할 때…', ...over },
      { id: `a-${label}`, ...top },
    )

  it('지문을 한 번만 그린다', () => {
    render(<WrongAnswerCard answers={[sub('a'), sub('b')]} token="tok" />)
    expect(screen.getAllByText(/다음 글을 아래와 같이 요약할 때/)).toHaveLength(1)
  })

  it('소문항이 여러 개면 개수를 알려준다', () => {
    render(<WrongAnswerCard answers={[sub('a'), sub('b'), sub('c')]} token="tok" />)
    expect(screen.getByText('소문항 3개')).toBeTruthy()
  })

  it('소문항 하나면 개수 표시를 붙이지 않는다', () => {
    render(<WrongAnswerCard answers={[sub('a')]} token="tok" />)
    expect(screen.queryByText(/소문항 \d+개/)).toBeNull()
  })

  it('답이 소문항마다 다르면 각각 (a) (b) 로 나열한다', () => {
    render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 2 }, { student_answer: 1 }),
      sub('b', { correct_answer: 4 }, { student_answer: 3 }),
    ]} token="tok" />)
    expect(screen.getByText('(a)')).toBeTruthy()
    expect(screen.getByText('(b)')).toBeTruthy()
    expect(screen.getAllByText('내 답')).toHaveLength(2)
  })

  it('답이 전부 같으면 한 줄만 그린다 — 조합 선택형 오분리 레거시', () => {
    // 8번(a)/8번(b) 가 둘 다 "내 답 ① 정답 ②" 인 실제 데이터 모양
    render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 2 }, { student_answer: 1 }),
      sub('b', { correct_answer: 2 }, { student_answer: 1 }),
    ]} token="tok" />)
    expect(screen.getAllByText('내 답')).toHaveLength(1)
    expect(screen.queryByText('(a)')).toBeNull()
  })

  it('소문항 태그가 다르면 모두 보여준다 (어법 문항)', () => {
    render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 2, exam_question_tag: [{ concept_tag: { id: 't-a', name: '관계사', category_id: null, category_name: null } }] }, { student_answer: 1 }),
      sub('b', { correct_answer: 4, exam_question_tag: [{ concept_tag: { id: 't-b', name: '분사', category_id: null, category_name: null } }] }, { student_answer: 3 }),
    ]} token="tok" />)
    expect(screen.getByText('관계사')).toBeTruthy()
    expect(screen.getByText('분사')).toBeTruthy()
  })

  it('같은 태그가 복제돼 있으면 칩을 한 번만 그린다', () => {
    render(<WrongAnswerCard answers={[sub('a'), sub('b')]} token="tok" />)
    expect(screen.getAllByText('글의 목적 파악')).toHaveLength(1)
  })

  it('해설은 소문항별로 다르면 모두, 같으면 한 번만 그린다', () => {
    render(<WrongAnswerCard answers={[
      sub('a', { explanation: '(A)는 exchange 가 적절' }),
      sub('b', { explanation: '(B)는 withstand 가 적절' }),
    ]} token="tok" />)
    expect(screen.getByText('(A)는 exchange 가 적절')).toBeTruthy()
    expect(screen.getByText('(B)는 withstand 가 적절')).toBeTruthy()

    cleanup()
    render(<WrongAnswerCard answers={[
      sub('a', { explanation: '같은 해설' }),
      sub('b', { explanation: '같은 해설' }),
    ]} token="tok" />)
    expect(screen.getAllByText('같은 해설')).toHaveLength(1)
  })

  it('빈 배열이면 아무것도 그리지 않는다', () => {
    const { container } = render(<WrongAnswerCard answers={[]} token="tok" />)
    expect(container.innerHTML).toBe('')
  })
})

// ── 소문항별 해설 배치 ──────────────────────────────────────────────────────
//
// 답 7줄 몰아놓고 해설 14개를 뒤에 붙이면 어느 해설이 어느 빈칸 것인지 알 수 없다.
// 소문항마다 [답 → 그 소문항 해설] 로 묶어 그린다.
describe('WrongAnswerCard — 소문항별 해설 배치', () => {
  const sub = (label: string, over: Partial<StudentAnswer['exam_question']> = {}, top: Partial<StudentAnswer> = {}) =>
    makeStudentAnswer(
      { sub_label: label, question_number: 3, question_text: '요약문 빈칸을 채우시오', ...over },
      { id: `a-${label}`, ...top },
    )

  it('각 소문항 해설이 그 소문항 답 바로 뒤에 온다', () => {
    const { container } = render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 1, explanation: 'a 해설' }, { student_answer: 2 }),
      sub('b', { correct_answer: 3, explanation: 'b 해설' }, { student_answer: 4 }),
    ]} token="tok" />)
    const text = container.textContent ?? ''
    expect(text.indexOf('(a)')).toBeLessThan(text.indexOf('a 해설'))
    expect(text.indexOf('a 해설')).toBeLessThan(text.indexOf('(b)'))
    expect(text.indexOf('(b)')).toBeLessThan(text.indexOf('b 해설'))
  })

  it('첨삭도 같은 소문항 묶음 안에 들어간다', () => {
    const { container } = render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 1, explanation: 'a 해설' }, { student_answer: 2, ai_feedback: 'a 첨삭' }),
      sub('b', { correct_answer: 3 }, { student_answer: 4 }),
    ]} token="tok" />)
    const text = container.textContent ?? ''
    expect(text.indexOf('a 첨삭')).toBeLessThan(text.indexOf('(b)'))
    expect(text.indexOf('a 해설')).toBeLessThan(text.indexOf('(b)'))
  })

  it('해설 없는 소문항은 답만 그린다', () => {
    render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 1 }, { student_answer: 2 }),
      sub('b', { correct_answer: 3, explanation: 'b 해설' }, { student_answer: 4 }),
    ]} token="tok" />)
    expect(screen.getAllByText('해설')).toHaveLength(1)
    expect(screen.getByText('b 해설')).toBeTruthy()
  })

  it('답이 전부 같으면(오분리) 답 한 줄 뒤에 해설을 모아 붙인다', () => {
    const { container } = render(<WrongAnswerCard answers={[
      sub('a', { correct_answer: 2, explanation: '(A)는 exchange' }, { student_answer: 1 }),
      sub('b', { correct_answer: 2, explanation: '(B)는 withstand' }, { student_answer: 1 }),
    ]} token="tok" />)
    expect(screen.queryByText('(a)')).toBeNull()
    expect(screen.getAllByText('내 답')).toHaveLength(1)
    const text = container.textContent ?? ''
    expect(text.indexOf('내 답')).toBeLessThan(text.indexOf('(A)는 exchange'))
    expect(screen.getByText('(B)는 withstand')).toBeTruthy()
  })
})

// ── 공통 지문 분리 (T/F 5문장 중 1개만 보이던 회귀) ─────────────────────────
describe('splitCommonQuestionText', () => {
  it('공통 본문과 각자 꼬리를 나눈다', () => {
    const r = splitCommonQuestionText([
      '다음 글을 읽고 T/F 를 고르시오. 본문이 길게 이어진다. (1) 첫 번째 문장',
      '다음 글을 읽고 T/F 를 고르시오. 본문이 길게 이어진다. (2) 두 번째 문장',
    ])
    expect(r.shared).toContain('본문이 길게 이어진다')
    expect(r.shared).not.toContain('(1)')
    expect(r.tails).toEqual(['(1) 첫 번째 문장', '(2) 두 번째 문장'])
  })

  it('전부 같은 지문이면 꼬리가 비어 한 번만 그린다', () => {
    const same = '다음 글의 요약문을 완성하시오. 본문이 여기 길게 들어간다.'
    const r = splitCommonQuestionText([same, same])
    expect(r.shared).toBe(same)
    expect(r.tails).toEqual(['', ''])
  })

  it('공통부가 거의 없으면 각자 전문을 쓴다', () => {
    const r = splitCommonQuestionText(['서로 완전히 다른 문제 하나입니다', '전혀 다른 두 번째 문제입니다'])
    expect(r.shared).toBe('')
    expect(r.tails).toHaveLength(2)
    expect(r.tails[0]).toContain('서로 완전히')
  })

  it('단어 중간에서 자르지 않는다', () => {
    const r = splitCommonQuestionText([
      '공통으로 아주 길게 이어지는 앞부분 문장입니다 alpha 뒤',
      '공통으로 아주 길게 이어지는 앞부분 문장입니다 alphabet 뒤',
    ])
    expect(r.shared.endsWith('문장입니다')).toBe(true)
    expect(r.tails[0]).toBe('alpha 뒤')
  })

  it('소문항이 하나면 그대로 지문으로 쓴다', () => {
    const r = splitCommonQuestionText(['문제 하나뿐'])
    expect(r).toEqual({ shared: '문제 하나뿐', tails: [''] })
  })
})

// 파싱이 passage 를 채워주면 휴리스틱을 쓰지 않는다 (2026-09-01 프롬프트 변경)
describe('splitQuestionTexts', () => {
  const PASSAGE = 'John was born in London in 1990. He studied engineering and moved to Seoul.'

  it('소문항이 같은 passage 를 들고 있으면 그대로 공통 지문으로 쓴다', () => {
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: 'Choose True or False. (1) John moved to Seoul in 1990.' },
      { passage: PASSAGE, question_stem: 'Choose True or False. (2) John studied engineering.' },
    ])
    // 공통 발문 + 지문이 한 덩어리로 올라간다
    expect(r.shared).toContain('Choose True or False.')
    expect(r.shared).toContain(PASSAGE)
    expect(r.tails[0]).toContain('(1) John moved to Seoul')
    expect(r.tails[1]).toContain('(2) John studied engineering')
    // 지문이 꼬리에 복제되면 소문항 수만큼 반복 출력된다
    expect(r.tails.join('')).not.toContain('born in London')
  })

  it('선지가 있으면 꼬리에 번호 기호를 붙여 담는다', () => {
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: '(1) 빈칸에 알맞은 것은?', choices: ['However', 'Therefore'] },
      { passage: PASSAGE, question_stem: '(2) 빈칸에 알맞은 것은?', choices: ['Thus', 'Moreover'] },
    ])
    expect(r.shared).toContain(PASSAGE)
    expect(r.tails[0]).toContain('① However')
  })

  it('passage 가 비어 있으면 예전처럼 question_text 통짜에서 잘라낸다', () => {
    const r = splitQuestionTexts([
      { question_text: '다음 글을 읽고 T/F 를 고르시오. 본문이 길게 이어진다. (1) 첫 번째 문장' },
      { question_text: '다음 글을 읽고 T/F 를 고르시오. 본문이 길게 이어진다. (2) 두 번째 문장' },
    ])
    expect(r.shared).toContain('본문이 길게 이어진다')
    expect(r.tails).toEqual(['(1) 첫 번째 문장', '(2) 두 번째 문장'])
  })

  it('지문을 첫 소문항에만 실어도 공통 지문으로 인식한다 (출력 길이 때문에 이게 기본형)', () => {
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: '(1) John moved to Seoul in 1990.' },
      { passage: null, question_stem: '(2) John studied engineering.' },
    ])
    expect(r.shared).toContain(PASSAGE)
    expect(r.tails).toEqual(['(1) John moved to Seoul in 1990.', '(2) John studied engineering.'])
  })

  it('공통 발문은 소문항마다 반복돼 와도 지문과 함께 한 번만 그린다', () => {
    // 8/25 T/F 문항 실제 형태: 발문(70자) + 지문(1100자) + (N) 문장(90자)
    const 발문 = 'Choose True or False (T/F) based on the content of the following text.'
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: `${발문} (1) The police used social media to find clues.` },
      { passage: null, question_stem: `${발문} (2) Ben Kuo is a professional satellite image analyst.` },
    ])
    expect(r.shared).toContain(발문)
    expect(r.shared).toContain('born in London')
    // 발문이 꼬리에 남으면 소문항 수만큼 반복 출력된다
    expect(r.tails[0]).toBe('(1) The police used social media to find clues.')
    expect(r.tails[1]).toBe('(2) Ben Kuo is a professional satellite image analyst.')
  })

  it('소문항 문장이 길어도 발문을 뽑아낸다 (비율 가드가 구조화 경로를 막지 않는다)', () => {
    // 통짜 경로의 0.3 비율 기준을 그대로 쓰면 문장이 길수록 발문이 안 뽑힌다
    const 발문 = 'Choose True or False.'
    const 긴문장 = (n: number) => `(${n}) ` + 'a'.repeat(300)
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: `${발문} ${긴문장(1)}` },
      { passage: null, question_stem: `${발문} ${긴문장(2)}` },
    ])
    expect(r.shared).toContain(발문)
    expect(r.tails[0]).toBe(긴문장(1))
  })

  it('소문항 문장(question_stem)이 하나라도 비면 휴리스틱으로 폴백한다', () => {
    // stem 이 비면 그 소문항 문장이 화면에서 통째로 사라진다 — 추측이라도 하는 편이 낫다
    const r = splitQuestionTexts([
      { passage: PASSAGE, question_stem: '(1) 문장', question_text: `${PASSAGE} (1) 문장` },
      { passage: null, question_stem: '', question_text: `${PASSAGE} (2) 문장` },
    ])
    expect(r.shared).toContain('born in London')
    expect(r.tails[1]).toContain('(2) 문장')
  })
})

describe('WrongAnswerCard — 소문항 문장이 사라지지 않는다', () => {
  const tf = (label: string, n: number, correct: string) =>
    makeStudentAnswer(
      {
        sub_label: label, question_number: 1, question_style: 'ox',
        correct_answer: 0, correct_answer_text: correct,
        question_text: `Choose True or False based on the text. 본문이 아주 길게 이어지는 부분입니다. (${n}) 문장 ${n}`,
      },
      { id: `tf-${label}`, student_answer: null, ox_selection: n % 2 === 0 ? 'X' : 'O' },
    )

  it('T/F 5문항이면 (1)~(5) 문장이 모두 보인다', () => {
    render(<WrongAnswerCard
      answers={[tf('a', 1, 'T'), tf('b', 2, 'F'), tf('c', 3, 'T'), tf('d', 4, 'F'), tf('e', 5, 'F')]}
      token="tok"
    />)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(`(${n}) 문장 ${n}`)).toBeTruthy()
    }
  })

  it('공통 본문은 한 번만 그린다', () => {
    render(<WrongAnswerCard answers={[tf('a', 1, 'T'), tf('b', 2, 'F')]} token="tok" />)
    expect(screen.getAllByText(/본문이 아주 길게 이어지는 부분입니다/)).toHaveLength(1)
  })

  it('ox 답은 ox_selection 을 정답키 표기(T/F)로 보여준다', () => {
    render(<WrongAnswerCard answers={[tf('a', 1, 'T')]} token="tok" />)
    expect(screen.queryByText('미작성')).toBeNull()
    // 내 답 T · 정답 T 둘 다 T 라서 두 개 잡힌다
    expect(screen.getAllByText('T')).toHaveLength(2)
  })

  it('ox 인데 아무것도 안 골랐으면 미작성', () => {
    const blank = makeStudentAnswer(
      { sub_label: null, question_style: 'ox', correct_answer: 0, correct_answer_text: 'F' },
      { student_answer: null, ox_selection: null },
    )
    render(<WrongAnswerCard answers={[blank]} token="tok" />)
    expect(screen.getByText('미작성')).toBeTruthy()
  })
})
