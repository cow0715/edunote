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
