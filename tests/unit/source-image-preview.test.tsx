// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SourceImagePreview } from '@/components/grade/source-image-preview'

// 이 컴포넌트는 "대상 이미지가 바뀌면 이전 결과를 지운다"를 렌더 중 조정으로 한다.
//
// 주의: 아래 테스트는 "리셋이 일어난다"까지만 검증한다.
// 렌더 중 조정과 effect 의 한 프레임 차이는 이 환경에서 관측할 수 없다 —
// testing-library 의 rerender 가 act() 안에서 effect 를 동기 flush 하기 때문에
// 옛 effect 구현으로 되돌려도 이 테스트는 그대로 통과한다 (직접 확인함).
// 그래도 "리셋 자체가 사라지는" 회귀(= 이전 문항 이미지가 계속 남는 버그)는 잡는다.

function mockSignedUrl(resolver: (path: string) => Promise<{ ok: boolean; url?: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = decodeURIComponent(new URL(input, 'http://localhost').searchParams.get('path') ?? '')
    const result = await resolver(path)
    return {
      ok: result.ok,
      json: async () => ({ url: result.url }),
    } as Response
  }))
}

beforeEach(() => {
  mockSignedUrl(async (path) => ({ ok: true, url: `https://signed.example/${path}` }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const image = () => screen.queryByAltText('문항 원본 페이지') as HTMLImageElement | null

describe('SourceImagePreview — 이미지가 없을 때', () => {
  it('경로도 없고 필요 표시도 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <SourceImagePreview question={{ source_image_path: null, needs_source_image: false, source_page: null }} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('필요 표시만 있으면 안내 문구를 보여준다', () => {
    render(
      <SourceImagePreview question={{ source_image_path: null, needs_source_image: true, source_page: null }} />
    )
    expect(screen.getByText(/저장된 이미지가 없습니다/)).toBeTruthy()
  })
})

describe('SourceImagePreview — 불러오기', () => {
  it('서명 URL 을 받아 이미지를 그린다', async () => {
    render(
      <SourceImagePreview question={{ source_image_path: 'a.png', needs_source_image: false, source_page: 3 }} />
    )
    expect(screen.getByText('원본 이미지를 불러오는 중입니다.')).toBeTruthy()

    await waitFor(() => expect(image()).not.toBeNull())
    expect(image()!.src).toBe('https://signed.example/a.png')
  })

  it('원본 페이지 번호를 표시한다', () => {
    render(
      <SourceImagePreview question={{ source_image_path: 'a.png', needs_source_image: false, source_page: 3 }} />
    )
    expect(screen.getByText('원본 페이지 3')).toBeTruthy()
  })

  it('실패하면 실패 문구를 보여준다', async () => {
    mockSignedUrl(async () => ({ ok: false }))
    render(
      <SourceImagePreview question={{ source_image_path: 'bad.png', needs_source_image: false, source_page: null }} />
    )
    await waitFor(() => expect(screen.getByText('원본 이미지를 불러오지 못했습니다.')).toBeTruthy())
  })
})

describe('SourceImagePreview — 대상이 바뀔 때', () => {
  it('경로가 바뀌면 이전 이미지를 더 이상 보여주지 않는다', async () => {
    const { rerender } = render(
      <SourceImagePreview question={{ source_image_path: 'first.png', needs_source_image: false, source_page: null }} />
    )
    await waitFor(() => expect(image()).not.toBeNull())
    expect(image()!.src).toBe('https://signed.example/first.png')

    // 새 문항으로 교체 — 이 시점에 이전 이미지가 남아있으면 안 된다.
    rerender(
      <SourceImagePreview question={{ source_image_path: 'second.png', needs_source_image: false, source_page: null }} />
    )
    expect(image()).toBeNull()
    expect(screen.getByText('원본 이미지를 불러오는 중입니다.')).toBeTruthy()

    await waitFor(() => expect(image()).not.toBeNull())
    expect(image()!.src).toBe('https://signed.example/second.png')
  })

  it('실패 상태도 새 대상에서 초기화된다', async () => {
    mockSignedUrl(async (path) => (path === 'bad.png' ? { ok: false } : { ok: true, url: `https://signed.example/${path}` }))

    const { rerender } = render(
      <SourceImagePreview question={{ source_image_path: 'bad.png', needs_source_image: false, source_page: null }} />
    )
    await waitFor(() => expect(screen.getByText('원본 이미지를 불러오지 못했습니다.')).toBeTruthy())

    rerender(
      <SourceImagePreview question={{ source_image_path: 'good.png', needs_source_image: false, source_page: null }} />
    )
    expect(screen.queryByText('원본 이미지를 불러오지 못했습니다.')).toBeNull()

    await waitFor(() => expect(image()).not.toBeNull())
  })

  it('같은 경로로 다시 그리면 이미지를 유지한다 (불필요한 깜빡임 없음)', async () => {
    const { rerender } = render(
      <SourceImagePreview question={{ source_image_path: 'same.png', needs_source_image: false, source_page: null }} />
    )
    await waitFor(() => expect(image()).not.toBeNull())

    rerender(
      <SourceImagePreview question={{ source_image_path: 'same.png', needs_source_image: false, source_page: 9 }} />
    )
    expect(image()).not.toBeNull()
  })
})
