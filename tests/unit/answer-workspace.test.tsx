// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnswerWorkspace } from '@/components/grade/answer-workspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function viewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches:desktop,addEventListener:vi.fn(),removeEventListener:vi.fn()}))
}
it('keeps desktop editor nonmodal and does not block the student list', () => {
  viewport(true)
  const select = vi.fn()
  render(<><button onClick={select}>다른 학생</button><AnswerWorkspace open busy={false} onClose={vi.fn()}><input aria-label="answer" /></AnswerWorkspace></>)
  expect(screen.getByRole('region', {name:'학생 답안 채점'})).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button'))
  expect(select).toHaveBeenCalledOnce()
})
it('uses a modal on narrow screens and mounts one editor only', () => {
  viewport(false)
  render(<AnswerWorkspace open busy={false} onClose={vi.fn()}><input aria-label="answer" /></AnswerWorkspace>)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
})
