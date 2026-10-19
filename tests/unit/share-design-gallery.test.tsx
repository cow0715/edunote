// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ShareDesignGallery from '@/components/dev/share-design-gallery'
import { parseShareDesignContext, SHARE_DESIGN_CONTEXT_MESSAGE } from '@/components/dev/share-design-registry'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a>,
}))

afterEach(cleanup)

function frame() {
  return screen.getByTitle(/^Share .+ 전체 화면$/) as HTMLIFrameElement
}

function params() {
  return new URL(frame().getAttribute('src')!, window.location.origin).searchParams
}

function context(periodId: string | null, tab: string) {
  return { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId, tab }
}

function sendMessage(data: unknown, options: { origin?: string; source?: MessageEventSource } = {}) {
  fireEvent(window, new MessageEvent('message', {
    data,
    origin: options.origin ?? window.location.origin,
    source: options.source ?? frame().contentWindow,
  }))
}

function chooseDesign(name: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name }))
}

function loadShare(input: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '실제 학생 공유 링크' }), { target: { value: input } })
  fireEvent.click(screen.getByRole('button', { name: '학생 기록 불러오기' }))
}

describe('개발자 Share 디자인의 탐색 맥락 보존', () => {
  it('선택 프레임의 기간·탭 메시지만으로 재로딩하지 않고 디자인과 테마를 바꿀 때 선택을 보존한다', () => {
    render(<ShareDesignGallery />)
    const original = frame()
    const originalSrc = original.getAttribute('src')
    sendMessage(context('september', 'wrongnote'))
    expect(frame()).toBe(original)
    expect(frame().getAttribute('src')).toBe(originalSrc)

    chooseDesign(/목록 중심/)
    expect(params().get('design')).toBe('list')
    expect(params().get('periodId')).toBe('september')
    expect(params().get('tab')).toBe('wrongnote')

    const beforeTheme = frame()
    sendMessage(context('october', 'score'))
    expect(frame()).toBe(beforeTheme)
    fireEvent.change(screen.getByRole('combobox', { name: '미리보기 화면 모드' }), { target: { value: 'dark' } })
    expect(params().get('theme')).toBe('dark')
    expect(params().get('periodId')).toBe('october')
    expect(params().get('tab')).toBe('score')
  })

  it('화면만 열기 링크는 내부 최신 기간·탭을 반영하면서 기존 프레임은 재로딩하지 않는다', () => {
    render(<ShareDesignGallery />)
    const original = frame()
    const originalSrc = original.getAttribute('src')
    sendMessage(context('september', 'wrongnote'))
    const href = screen.getByRole('link', { name: /화면만 열기/ }).getAttribute('href')!
    const url = new URL(href, window.location.origin)
    expect(url.pathname).toBe('/dev/share-design/frame')
    expect(url.searchParams.get('periodId')).toBe('september')
    expect(url.searchParams.get('tab')).toBe('wrongnote')
    expect(frame()).toBe(original)
    expect(frame().getAttribute('src')).toBe(originalSrc)
  })

  it('외부 origin이나 다른 window가 보낸 메시지로 선택을 덮어쓰지 않는다', () => {
    render(<ShareDesignGallery />)
    sendMessage(context('september', 'score'))
    sendMessage(context('untrusted-period', 'vocab'), { origin: 'https://untrusted.example' })
    sendMessage(context('another-window', 'home'), { source: window })
    chooseDesign(/추이 중심/)
    expect(params().get('periodId')).toBe('september')
    expect(params().get('tab')).toBe('score')
  })

  it('교체된 이전 프레임에서 늦게 도착한 메시지를 무시한다', () => {
    render(<ShareDesignGallery />)
    const previousWindow = frame().contentWindow!
    chooseDesign(/목록 중심/)
    // 분리된 jsdom Window를 검사 출력에서 순회하면 location getter가 실패한다.
    expect(frame().contentWindow === previousWindow).toBe(false)
    sendMessage(context('september', 'wrongnote'))
    sendMessage(context('october', 'vocab'), { source: previousWindow })
    fireEvent.change(screen.getByRole('combobox', { name: '미리보기 화면 모드' }), { target: { value: 'dark' } })
    expect(params().get('periodId')).toBe('september')
    expect(params().get('tab')).toBe('wrongnote')
  })

  it('선택 프레임에서도 형식이 잘못된 메시지는 현재 선택을 바꾸지 않는다', () => {
    render(<ShareDesignGallery />)
    sendMessage(context('september', 'analysis'))
    sendMessage({ type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: '/share/other', tab: 'home' })
    sendMessage({ type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: 'october', tab: 'unknown-tab' })
    chooseDesign(/목록 중심/)
    expect(params().get('periodId')).toBe('september')
    expect(params().get('tab')).toBe('analysis')
  })

  it('화면 폭만 바꾸면 같은 프레임을 유지하며 다음 디자인에도 내부 선택을 전달한다', () => {
    render(<ShareDesignGallery />)
    const original = frame()
    sendMessage(context('september', 'vocab'))
    fireEvent.change(screen.getByRole('combobox', { name: '미리보기 화면 폭' }), { target: { value: '430' } })
    expect(frame()).toBe(original)
    expect(frame().style.width).toBe('430px')
    chooseDesign(/추이 중심/)
    expect(params().get('periodId')).toBe('september')
    expect(params().get('tab')).toBe('vocab')
  })

  it('처음부터 보기에서는 최신 선택 기간을 유지하고 분석 탭부터 다시 연다', () => {
    render(<ShareDesignGallery />)
    const original = frame()
    sendMessage(context('october', 'wrongnote'))
    fireEvent.click(screen.getByRole('button', { name: '리포트 처음부터 보기' }))
    expect(frame()).not.toBe(original)
    expect(params().get('periodId')).toBe('october')
    expect(params().get('tab')).toBe('analysis')
  })

  it('입력 불량은 오류를 안내하고 보고 있던 프레임을 유지한다', () => {
    render(<ShareDesignGallery />)
    const original = frame()
    const originalSrc = original.getAttribute('src')
    loadShare('javascript:alert(1)')
    expect(screen.getByRole('alert').textContent).toContain('학생 공유 링크 또는 공유 토큰')
    expect(screen.getByRole('textbox', { name: '실제 학생 공유 링크' }).getAttribute('aria-invalid')).toBe('true')
    expect(frame()).toBe(original)
    expect(frame().getAttribute('src')).toBe(originalSrc)
    expect(screen.queryByText('실제 학생 기록으로 보는 중')).toBeNull()
  })

  it('정상 실제 링크는 입력 오류를 지우고 지정된 기간·분석 탭으로 학생 기록을 연다', () => {
    render(<ShareDesignGallery />)
    sendMessage(context('september', 'vocab'))
    loadShare('/retake/not-a-share-link')
    loadShare('https://external.example/share/student-token?periodId=period-fall')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('실제 학생 기록으로 보는 중')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '학습 상황' })).toBeNull()
    expect(params().get('token')).toBe('student-token')
    expect(params().get('periodId')).toBe('period-fall')
    expect(params().get('tab')).toBe('analysis')
    expect(params().has('scenario')).toBe(false)
    sendMessage(context('period-winter', 'home'))
    chooseDesign(/목록 중심/)
    expect(params().get('token')).toBe('student-token')
    expect(params().get('periodId')).toBe('period-winter')
    expect(params().get('tab')).toBe('home')
  })

  it('실제 기록에서 돌아오면 실제 토큰·기간·탭을 제거하고 선택했던 가상 상황을 복원한다', () => {
    render(<ShareDesignGallery />)
    fireEvent.change(screen.getByRole('combobox', { name: '학습 상황' }), { target: { value: 'recovery' } })
    loadShare('/share/student-token?periodId=period-fall')
    sendMessage(context('period-winter', 'vocab'))
    fireEvent.click(screen.getByRole('button', { name: '미리보기 기록으로 돌아가기' }))
    expect(params().has('token')).toBe(false)
    expect(params().get('scenario')).toBe('recovery')
    expect(params().get('periodId')).toBe('semester')
    expect(params().get('tab')).toBe('analysis')
    expect((screen.getByRole('combobox', { name: '학습 상황' }) as HTMLSelectElement).value).toBe('recovery')
  })
})

describe('Share 프레임 메시지 형식 검증', () => {
  it('다섯 실제 탭과 기본 기간을 허용하며 메시지의 나머지 필드는 전달하지 않는다', () => {
    for (const tab of ['home', 'score', 'analysis', 'wrongnote', 'vocab']) {
      expect(parseShareDesignContext({ ...context(null, tab), token: 'ignored-token', design: 'ignored-design' })).toEqual({ periodId: null, tab })
      expect(parseShareDesignContext(context('period_123-456', tab))).toEqual({ periodId: 'period_123-456', tab })
    }
  })

  it.each([
    null, undefined, false, 'context', [], {},
    { type: 'different-message', periodId: null, tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: 123, tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: '', tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: '../other', tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: 'period?token=other', tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: 'a'.repeat(129), tab: 'analysis' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: null, tab: 'retake' },
    { type: SHARE_DESIGN_CONTEXT_MESSAGE, periodId: null, tab: null },
  ])('잘못된 프레임 메시지를 거절한다: %j', (value) => {
    expect(parseShareDesignContext(value)).toBeNull()
  })
})
