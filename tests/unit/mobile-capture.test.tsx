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
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: /^(촬영하기|더 촬영)$/ }).hasAttribute('disabled')).toBe(false))
}
function fileInput() { return screen.getAllByLabelText('파일 추가').find((element) => element.tagName === 'INPUT')! }
async function addPhoto() {
  fireEvent.change(fileInput(), { target: { files: [new File(['photo'], 'answer.jpg', { type: 'image/jpeg' })] } })
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
    fireEvent.click(screen.getByRole('button', { name: '1장 학생 확인하기' }))
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
    fireEvent.change(fileInput(), { target: { files: [new File(['b'], 'b.jpg', { type: 'image/jpeg' })] } })
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
    fireEvent.click(screen.getByRole('button', { name: '촬영하기' }))
    const video = await screen.findByLabelText('답안지 카메라 미리보기')
    Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } })
    fireEvent.click(screen.getByRole('button', { name: '답안지 촬영' }))
    await screen.findByText(/1장 기기에 보관됨/)
    fireEvent.click(screen.getByRole('button', { name: '답안지 촬영' }))
    await screen.findByText(/2장 기기에 보관됨/)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '완료 · 2장 확인' }))
    expect(stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '2장 학생 확인하기' })).toBeTruthy()
  })

  it('카메라 권한 거부 시 기본 카메라와 앨범을 사용할 수 있다', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '촬영하기' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('기본 카메라로 촬영').getAttribute('capture')).toBe('environment')
    expect(screen.getByRole('button', { name: '파일 추가' }).hasAttribute('disabled')).toBe(false)
  })

  it('화면을 닫은 후 도착한 카메라 권한 응답도 트랙을 해제한다', async () => {
    let grant!: (value: typeof media) => void
    getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const view = render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '촬영하기' }))
    view.unmount()
    await act(async () => { grant(media) })
    expect(stop).toHaveBeenCalledOnce()
  })
})


describe('정리된 답안 추가 흐름', () => {
  it('첫 화면은 촬영과 파일 추가만 제공하고 기본 카메라는 실패 후에만 보여준다', async () => {
    render(<MobileCapture draftKey="exam:week1" active onConfirm={vi.fn()} />)
    await ready()
    expect(screen.getByRole('button', { name: '촬영하기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '파일 추가' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '기본 카메라로 촬영' })).toBeNull()
    expect(screen.queryByRole('button', { name: /학생 확인하기/ })).toBeNull()
  })

  it('PDF도 같은 보관함과 확인 단계를 거치고 복구할 수 있다', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    vi.mocked(compressImageForUpload).mockResolvedValueOnce({ base64: 'YQ==', mimeType: 'application/pdf', originalBytes: 1, bytes: 1, width: 0, height: 0 })
    const view = render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    fireEvent.change(fileInput(), { target: { files: [new File(['a'], 'answer.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('PDF')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(drafts.get('exam:week1')?.[0].blob.type).toBe('application/pdf')
    view.unmount()
    render(<MobileCapture draftKey="exam:week1" active onConfirm={onConfirm} />)
    await ready()
    const next = await screen.findByRole('button', { name: '1장 학생 확인하기' })
    fireEvent.click(next)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    expect(onConfirm.mock.calls[0][0][0].type).toBe('application/pdf')
  })
})
