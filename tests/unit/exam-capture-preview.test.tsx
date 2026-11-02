// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExamStudentConfirmPreview } from '@/app/dev/exam-student-confirm/preview'

vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: async (file: File) => ({
  base64: btoa(file.name.split('-').slice(0, 2).join('-')), mimeType: 'image/png', originalBytes: 1, bytes: 1, width: 1, height: 1,
}) }))
const request = vi.fn<typeof fetch>()
beforeEach(() => {
  request.mockClear()
  vi.stubGlobal('fetch', request)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:sample') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => { expect(request).not.toHaveBeenCalled(); cleanup(); vi.unstubAllGlobals() })

it.each(['독해', '단어'])('%s 실제 일괄 다이얼로그로 샘플 사진·학생 확인·처리를 체험한다', async (subject) => {
  render(<ExamStudentConfirmPreview />)
  fireEvent.click(screen.getByText(`${subject} 시험`, { selector: 'button' }))
  fireEvent.click(screen.getByText('일괄 촬영 열기', { selector: 'button' }))
  await waitFor(() => expect((screen.getByRole('button', { name: '파일 추가' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '파일 추가' }))
  await screen.findByText(/2장 기기에 보관됨/)
  fireEvent.click(screen.getByText('2장 학생 확인', { selector: 'button' }))
  const first = await screen.findByLabelText('사진 1: 김대영 학생 확인')
  await waitFor(() => expect((first as HTMLButtonElement).disabled).toBe(false))
  const start = screen.getByText(subject === '독해' ? '2명 답안 인식' : '2명 채점 시작', { selector: 'button' }) as HTMLButtonElement
  expect(start.disabled).toBe(true)
  fireEvent.click(first)
  fireEvent.click(screen.getByLabelText('사진 2: 김민성 학생 확인'))
  expect(start.disabled).toBe(false)
  fireEvent.click(start)
  await screen.findByText(subject === '독해' ? '닫기' : '성적표 보기', { selector: 'button' })
  fireEvent.click(screen.getByText(subject === '독해' ? '닫기' : '성적표 보기', { selector: 'button' }))
  expect(await screen.findByLabelText('샘플 처리 결과')).toBeTruthy()
})

it.each(['독해', '단어'])('%s 학생 상세는 촬영을 중복 제공하지 않는다', async (subject) => {
  render(<ExamStudentConfirmPreview />)
  fireEvent.click(screen.getByText(`${subject} 시험`, { selector: 'button' }))
  fireEvent.click(screen.getByText('개별 촬영', { selector: 'button' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sample-minseong' } })
  fireEvent.click(screen.getByText('김민성 개별 촬영 열기', { selector: 'button' }))
  expect(screen.getByText(`김민성 · ${subject}`, { selector: 'h2' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '사진 선택' })).toBeNull()
  expect(screen.queryByRole('button', { name: '카메라로 촬영 채점' })).toBeNull()
  expect(screen.queryByRole('button', { name: '저장 사진 재판독' })).toBeNull()
})
