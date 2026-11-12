// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileCapture } from '@/components/grade/mobile-capture'
import { captureDraft, type CapturePhoto } from '@/lib/capture-draft'
import { compressImageForUpload } from '@/lib/image-compress'

vi.mock('@/lib/capture-draft', () => ({ captureDraft: vi.fn() }))
vi.mock('@/lib/image-compress', () => ({ compressImageForUpload: vi.fn() }))

const drafts = new Map<string, CapturePhoto[]>()
const stop = vi.fn()
const media = { getTracks: () => [{ stop }] }
let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  drafts.clear()
  vi.clearAllMocks()
  vi.mocked(captureDraft).mockImplementation(async (key, photos) => {
    if (photos !== undefined) drafts.set(key, photos)
    return drafts.get(key) ?? []
  })
  vi.mocked(compressImageForUpload).mockResolvedValue({ base64: 'YQ==', mimeType: 'image/jpeg', originalBytes: 1, bytes: 1, width: 1, height: 1 })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  getUserMedia = vi.fn().mockResolvedValue(media)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
})
afterEach(cleanup)

async function ready() { await screen.findByText(/장 기기에 보관됨/) }
async function addPhoto() {
  fireEvent.change(screen.getByLabelText('보관함에 사진 추가'), { target: { files: [new File(['photo'], 'answer.jpg', { type: 'image/jpeg' })] } })
  await screen.findByRole('button', { name: '사진 1 크게 확인' })
}

describe('연속 촬영 사진 보관함', () => {
  it('사진은 기기에 저장하고, 확인 전에는 판독하지 않는다. 재마운트 후 복구한다', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const first = render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    await addPhoto()
    expect(drafts.get('exam:week1')).toHaveLength(1)
    expect(onConfirm).not.toHaveBeenCalled()
    first.unmount()
    render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '1장 학생 확인' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm.mock.calls[0][0][0]).toBeInstanceOf(File)
    // Retain until explicit deletion, including refresh during name recognition/grading.
    expect(drafts.get('exam:week1')).toHaveLength(1)
  })

  it('주차와 시험 종류가 다른 사진을 섞지 않는다', async () => {
    drafts.set('vocab:week1', [{ id: 'one', blob: new Blob(['a']), name: 'a.jpg', lastModified: 0 }])
    render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    expect(screen.queryByRole('button', { name: '사진 1 크게 확인' })).toBeNull()
  })

  it('저장 실패를 성공으로 표시하지 않고 기존 사진을 보존한다', async () => {
    const onConfirm = vi.fn()
    render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    await addPhoto()
    vi.mocked(captureDraft).mockRejectedValueOnce(new Error('quota'))
    fireEvent.change(screen.getByLabelText('보관함에 사진 추가'), { target: { files: [new File(['b'], 'b.jpg', { type: 'image/jpeg' })] } })
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '사진 2 크게 확인' })).toBeNull()
    expect(drafts.get('exam:week1')).toHaveLength(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('확대 확인 후 삭제한 사진은 다음 복구에서도 제외한다', async () => {
    render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    await addPhoto()
    fireEvent.click(screen.getByRole('button', { name: '사진 1 크게 확인' }))
    fireEvent.click(screen.getByRole('button', { name: '이 사진 삭제' }))
    await waitFor(() => expect(drafts.get('exam:week1')).toEqual([]))
    await waitFor(() => expect(screen.queryByAltText('선택한 답안지 확대')).toBeNull())
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('연속 촬영 중 두 장을 저장하고 촬영 완료 시 카메라를 끈다', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['a'], { type: 'image/jpeg' })))
    const onConfirm = vi.fn()
    render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '연속 촬영' }))
    const video = await screen.findByLabelText('답안지 카메라 미리보기')
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } })
    fireEvent.click(screen.getByRole('button', { name: '촬영' }))
    await screen.findByText(/1장 기기에 보관됨/)
    fireEvent.click(screen.getByRole('button', { name: '촬영' }))
    await screen.findByText(/2장 기기에 보관됨/)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '촬영 완료 · 학생 확인' }))
    expect(stop).toHaveBeenCalled()
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm.mock.calls[0][0]).toHaveLength(2)
  })

  it('카메라 권한 거부 시 기본 카메라와 앨범을 사용할 수 있다', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '연속 촬영' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('기본 카메라로 촬영').getAttribute('capture')).toBe('environment')
    expect(screen.getByRole('button', { name: '사진 추가' }).hasAttribute('disabled')).toBe(false)
  })
  it('사진 전달이 실패해도 보관한 사진으로 바로 다시 시도할 수 있다', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
    render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    await addPhoto()
    fireEvent.click(screen.getByRole('button', { name: '1장 학생 확인' }))
    await screen.findByRole('alert')
    expect(drafts.get('exam:week1')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '1장 학생 확인' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  })
  it('창을 닫았다 열어도 연속 촬영을 다시 시작할 수 있다', async () => {
    const onConfirm = vi.fn()
    const view = render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '연속 촬영' }))
    await screen.findByLabelText('답안지 카메라 미리보기')
    view.rerender(<MobileCapture draftKey="exam:week1" active={false} onConfirm={onConfirm} />)
    expect(stop).toHaveBeenCalled()
    view.rerender(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    expect((screen.getByRole('button', { name: '연속 촬영' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('화면을 닫은 후 도착한 카메라 권한 응답도 트랙을 해제한다', async () => {
    let grant!: (value: typeof media) => void
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const view = render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '연속 촬영' }))
    view.unmount()
    await act(async () => { grant(media) })
    expect(stop).toHaveBeenCalledOnce()
  })
})
