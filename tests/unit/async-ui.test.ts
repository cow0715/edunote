import { describe, expect, it, vi } from 'vitest'
import { errorMessage, runOrReport, runWithLoading } from '@/lib/async-ui'

describe('runWithLoading', () => {
  it('성공하면 true 를 주고 로딩을 켰다 끈다', async () => {
    const calls: boolean[] = []
    const ok = await runWithLoading((v) => calls.push(v), async () => {}, () => {})
    expect(ok).toBe(true)
    expect(calls).toEqual([true, false])
  })

  it('fn 이 throw 하면 onError 를 부르고 false — 로딩은 그래도 꺼진다', async () => {
    const calls: boolean[] = []
    const onError = vi.fn()
    const boom = new Error('실패')
    const ok = await runWithLoading((v) => calls.push(v), async () => { throw boom }, onError)
    expect(ok).toBe(false)
    expect(onError).toHaveBeenCalledWith(boom)
    expect(calls).toEqual([true, false])
  })

  it('fn 이 끝나기 전에는 로딩을 끄지 않는다', async () => {
    const calls: boolean[] = []
    let release = () => {}
    const pending = runWithLoading(
      (v) => calls.push(v),
      () => new Promise<void>((resolve) => { release = resolve }),
      () => {},
    )
    await Promise.resolve()
    expect(calls).toEqual([true])
    release()
    await pending
    expect(calls).toEqual([true, false])
  })
})

describe('runOrReport', () => {
  it('성공하면 true, onError 는 안 부른다', async () => {
    const onError = vi.fn()
    expect(await runOrReport(async () => {}, onError)).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('throw 하면 onError 에 원본 에러를 넘기고 false', async () => {
    const onError = vi.fn()
    const boom = new Error('네트워크')
    expect(await runOrReport(async () => { throw boom }, onError)).toBe(false)
    expect(onError).toHaveBeenCalledWith(boom)
  })
})

describe('errorMessage', () => {
  it('Error 의 message 를 쓴다', () => {
    expect(errorMessage(new Error('진짜 원인'), '기본')).toBe('진짜 원인')
  })

  it('Error 가 아니거나 message 가 비면 fallback', () => {
    expect(errorMessage('문자열', '기본')).toBe('기본')
    expect(errorMessage(new Error(''), '기본')).toBe('기본')
    expect(errorMessage(undefined, '기본')).toBe('기본')
  })
})
