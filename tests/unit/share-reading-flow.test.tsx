// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReadingReview, type ReviewQuestion } from '@/app/share/[token]/reading-review'

vi.mock('@/app/share/[token]/share-ui', () => ({ CountUp: ({ value }: { value: number }) => <>{value}%</> }))
vi.mock('@/components/grade/source-image-preview', () => ({ SourceImagePreview: () => <div>원본 자료</div> }))

beforeEach(() => {
  // jsdom에는 네이티브 dialog/스크롤 API가 없다. 포커스 트랩·실제 레이아웃은 브라우저 검증 대상이다.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = '' })

const question: ReviewQuestion = {
  id: 'q1', number: 1, numberLabel: '1번', typeName: '독해',
  stem: '글의 목적으로 알맞은 것은?', passage: 'A long passage. '.repeat(80),
  choices: ['첫 번째 선택지', '두 번째 선택지'], correct: 2, mine: 1,
  explanation: '두 번째 선택지가 적절한 이유입니다. '.repeat(50),
}
function setup(questions = [question]) {
  const onClose = vi.fn()
  const onGoWrongNote = vi.fn()
  const view = render(<ReadingReview questions={questions} token="fixture" onClose={onClose} onGoWrongNote={onGoWrongNote} />)
  return { ...view, onClose, onGoWrongNote }
}

describe('모바일 문제 복습 흐름', () => {
  it('긴 지문과 원본 자료보다 발문을 먼저 읽는다', () => {
    setup([{ ...question, sourceImage: { source_image_path: 'fixture.png', source_page: 1, needs_source_image: true } }])
    const content = screen.getByLabelText('문제와 해설').textContent!
    expect(content.indexOf(question.stem)).toBeLessThan(content.indexOf('A long passage.'))
    expect(content.indexOf('A long passage.')).toBeLessThan(content.indexOf('원본 자료'))
    expect(content.indexOf('원본 자료')).toBeLessThan(content.indexOf(question.choices[0]))
    expect((screen.getByRole('button', { name: '정답 확인' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('정답 확인 후 같은 본문에서 해설을 읽고 원문으로 돌아간다', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /① 첫 번째/ }))
    fireEvent.click(screen.getByRole('button', { name: '정답 확인' }))
    const feedback = within(screen.getByLabelText('문제와 해설')).getByRole('status')
    expect(feedback.textContent).toContain('정답은 ②')
    expect(feedback.textContent).toContain(question.explanation)
    expect(document.activeElement).toBe(feedback)
    expect((screen.getByRole('button', { name: /② 두 번째/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '문제 처음으로' }))
    expect(document.activeElement?.textContent).toContain(question.stem)
    expect(Element.prototype.scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('다음 문항의 선택을 초기화하고 OX 및 오답만 재복습한다', () => {
    setup([question, { ...question, id: 'q2', numberLabel: '2번', stem: '맞는 문장인가요?', choices: ['맞는 문장', '틀린 문장'], markers: ['O', 'X'], correct: 1 }])
    fireEvent.click(screen.getByRole('button', { name: /① 첫 번째/ }))
    fireEvent.click(screen.getByRole('button', { name: '정답 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '다음 문항' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: '정답 확인' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'O 맞는 문장' }))
    fireEvent.click(screen.getByRole('button', { name: '정답 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '결과 보기' }))
    expect(screen.getByText('2문항 중 1개 정답')).toBeTruthy()
    expect(screen.getByText(/성적에는 저장되지 않아요/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '틀린 것만 다시 (1)' }))
    expect(screen.getByText(question.stem)).toBeTruthy()
    expect(screen.queryByText('맞는 문장인가요?')).toBeNull()
  })

  it('나가기와 모달 취소를 처리하고 배경 스크롤을 복원한다', () => {
    document.body.style.overflow = 'auto'
    const { onClose, unmount } = setup()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: '← 나가기' }))
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
