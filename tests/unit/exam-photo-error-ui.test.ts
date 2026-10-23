// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { ExamPhotoButton } from '@/components/grade/exam-photo-button'

vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: async () => ({ base64: 'YQ==', mimeType: 'image/jpeg' }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('사진 저장 실패 표시', () => {
  it.each(['답안지 사진 저장에 실패했습니다.', '사진 파일은 저장됐지만 학생과 연결하지 못했습니다.'])('개별 촬영에서 오류를 알리고 답안을 반영하지 않는다: %s', async (error) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error }) })))
    const onResult = vi.fn()
    const { container } = render(createElement(ExamPhotoButton, { weekId: 'week', studentId: 'student', disabled: false, onResult }))
    fireEvent.change(container.querySelector('input')!, { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } })
    expect((await screen.findByRole('alert')).textContent).toBe(error)
    expect(onResult).not.toHaveBeenCalled()
  })
})
