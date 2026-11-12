// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { ExamPhotoButton } from '@/components/grade/exam-photo-button'
import { VocabPhotoButton } from '@/components/grade/vocab-photo-button'

vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: async () => ({ base64: 'YQ==', mimeType: 'image/jpeg' }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('사진 저장 실패 표시', () => {
  it.each(['exam', 'vocab', 'vocab-retake'])('%s individual uploads immediately process the selected student', async (kind) => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true, results: [],
      photoPath: 'week/student', vocab_correct: 1, vocab_total: 1 }))
    vi.stubGlobal('fetch', request)
    const onResult = vi.fn()
    const { container } = render(kind === 'exam'
      ? createElement(ExamPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, onResult })
      : createElement(VocabPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, hasExistingData: kind === 'vocab-retake', onResult }))
    const confirm = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByRole('button', { name: kind === 'exam' ? '답안지 촬영' : kind === 'vocab-retake' ? '재채점' : '사진 채점' }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
    fireEvent.change(container.querySelector('input')!, { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(onResult).toHaveBeenCalledOnce())
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toContain(kind === 'exam' ? 'ocr-exam-photo' : 'grade-vocab-photo')
    expect(JSON.parse(request.mock.calls[0][1]!.body as string).studentId).toBe('student')
    expect(screen.queryByRole('button', { name: /학생 확인/ })).toBeNull()
  })
  it.each([undefined, 'other/student'])('성공 응답이어도 학생의 사진 경로가 없거나 다르면 답안을 반영하지 않는다: %s', async (photoPath) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [], photoPath }) })))
    const onResult = vi.fn()
    const { container } = render(createElement(ExamPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, onResult }))
    fireEvent.change(container.querySelector('input')!, { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
    expect((await screen.findByRole('alert')).textContent).toContain('사진의 저장을 확인하지 못')
    expect(onResult).not.toHaveBeenCalled()
  })
  it('서버가 확인한 사진 경로를 답안과 함께 전달한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: [], photoPath: 'week/student' }) })))
    const onResult = vi.fn()
    const { container } = render(createElement(ExamPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, onResult }))
    fireEvent.change(container.querySelector('input')!, { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(onResult).toHaveBeenCalledWith([], 'week/student'))
  })
  it.each(['답안지 사진 저장에 실패했습니다.', '사진 파일은 저장됐지만 학생과 연결하지 못했습니다.'])('개별 촬영에서 오류를 알리고 답안을 반영하지 않는다: %s', async (error) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error }) })))
    const onResult = vi.fn()
    const { container } = render(createElement(ExamPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, onResult }))
    fireEvent.change(container.querySelector('input')!, { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
    expect((await screen.findByRole('alert')).textContent).toBe(error)
    expect(onResult).not.toHaveBeenCalled()
  })
})
