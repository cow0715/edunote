// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnswerPhotoDialog } from '@/components/grade/answer-photo-dialog'
afterEach(cleanup)
it('provides an accessible photo dialog and dismisses with Escape', () => {
  const close = vi.fn()
  render(<AnswerPhotoDialog open onOpenChange={close} url="https://example.com/photo.png" title="답안 원본" />)
  expect(screen.getByRole('dialog', { name: '답안 원본' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '답안 원본' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('button', { name: '원본 사진 닫기' }), { key: 'Escape' })
  expect(close).toHaveBeenCalledWith(false)
})
