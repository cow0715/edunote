// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { OXInput } from '@/components/grade/question-inputs'

afterEach(cleanup)

// OXInput 은 "렌더 중 조정"으로 수정어를 기억한다.
//   if (currentCorr && currentCorr !== rememberedCorr) setRememberedCorr(currentCorr)
// 잘못 쓰면 무한 렌더로 터지므로 실제로 마운트해서 확인한다.
// (무한 루프면 이 테스트가 통과하지 못하고 죽는다.)

/** 부모가 값을 들고 있는 실제 사용 형태를 흉내낸다 (controlled component) */
function ControlledOX({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <span data-testid="value">{value}</span>
      <OXInput textValue={value} onChange={setValue} disabled={false} />
    </div>
  )
}

const oButton = () => screen.getByRole('button', { name: 'O' })
const xButton = () => screen.getByRole('button', { name: 'X' })
const currentValue = () => screen.getByTestId('value').textContent

describe('OXInput — 기본 동작', () => {
  it('빈 상태에서 O 를 누르면 O 가 된다', () => {
    render(<ControlledOX />)
    fireEvent.click(oButton())
    expect(currentValue()).toBe('O')
  })

  it('빈 상태에서 X 를 누르면 수정어 없이 X 가 된다', () => {
    render(<ControlledOX />)
    fireEvent.click(xButton())
    expect(currentValue()).toBe('X')
  })

  it('선택된 버튼을 다시 누르면 해제된다', () => {
    render(<ControlledOX initial="O" />)
    fireEvent.click(oButton())
    expect(currentValue()).toBe('')
  })

  it('X 일 때만 수정어 입력칸이 보인다', () => {
    render(<ControlledOX initial="O" />)
    expect(screen.queryByPlaceholderText('수정어')).toBeNull()

    fireEvent.click(xButton())
    expect(screen.getByPlaceholderText('수정어')).toBeTruthy()
  })
})

describe('OXInput — 수정어 기억 (렌더 중 조정)', () => {
  it('X 로 시작한 값에서 수정어를 읽어 기억한다', () => {
    render(<ControlledOX initial="X was" />)
    // O 로 바꿔도 기억한 수정어가 옆에 표시된다
    fireEvent.click(oButton())
    expect(currentValue()).toBe('O')
    expect(screen.getByText('was')).toBeTruthy()
  })

  it('X → O → X 로 돌아오면 수정어가 복원된다', () => {
    render(<ControlledOX initial="X was" />)
    fireEvent.click(oButton())
    expect(currentValue()).toBe('O')

    fireEvent.click(xButton())
    expect(currentValue()).toBe('X was')
  })

  it('수정어를 입력하면 즉시 X 값에 반영된다', () => {
    render(<ControlledOX />)
    fireEvent.click(xButton())
    fireEvent.change(screen.getByPlaceholderText('수정어'), { target: { value: 'were' } })
    expect(currentValue()).toBe('X were')
  })

  it('수정어를 바꾼 뒤 O 를 거쳐 돌아오면 마지막 수정어가 복원된다', () => {
    render(<ControlledOX initial="X was" />)
    fireEvent.change(screen.getByPlaceholderText('수정어'), { target: { value: 'were' } })
    expect(currentValue()).toBe('X were')

    fireEvent.click(oButton())
    fireEvent.click(xButton())
    expect(currentValue()).toBe('X were')
  })

  // 이게 렌더 중 조정이 실제로 필요한 케이스다.
  // 마운트 이후 부모가 값을 갈아끼우는 상황 (저장된 답안을 나중에 불러오는 경우).
  // 조정 코드가 없으면 rememberedCorr 는 마운트 시점의 빈 값에 머문다.
  it('마운트 뒤 부모가 넣어준 수정어도 기억한다', () => {
    const onChange = vi.fn()
    const harness = (value: string) => <OXInput textValue={value} onChange={onChange} disabled={false} />

    const { rerender } = render(harness(''))
    rerender(harness('X was')) // 외부에서 주입 — 컴포넌트가 만든 값이 아니다
    rerender(harness('O'))

    fireEvent.click(xButton())
    expect(onChange).toHaveBeenLastCalledWith('X was')
  })

  it('수정어를 지워도 기억한 값은 남지 않는다 (빈 값은 기억하지 않음)', () => {
    render(<ControlledOX initial="X was" />)
    fireEvent.change(screen.getByPlaceholderText('수정어'), { target: { value: '' } })
    expect(currentValue()).toBe('X')

    fireEvent.click(oButton())
    fireEvent.click(xButton())
    expect(currentValue()).toBe('X')
  })
})

describe('OXInput — disabled', () => {
  it('disabled 면 버튼이 눌리지 않는다', () => {
    render(<ControlledOX />)
    cleanup()

    function Disabled() {
      const [value, setValue] = useState('')
      return (
        <div>
          <span data-testid="value">{value}</span>
          <OXInput textValue={value} onChange={setValue} disabled />
        </div>
      )
    }
    render(<Disabled />)
    fireEvent.click(oButton())
    expect(currentValue()).toBe('')
  })
})
