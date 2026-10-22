import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureDraft } from '@/lib/capture-draft'

afterEach(() => vi.unstubAllGlobals())

function database(result?: unknown) {
  const request = { result, onsuccess: null as null | (() => void) }
  const store = { get: vi.fn(() => request), put: vi.fn(() => request), delete: vi.fn(() => request) }
  const transaction = { objectStore: () => store, oncomplete: null as null | (() => void), onabort: null as null | (() => void), error: null as Error | null }
  const db = { transaction: vi.fn(() => transaction), close: vi.fn() }
  const open = { result: db, onsuccess: null as null | (() => void) }
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => open.onsuccess?.()); return open } })
  return { request, store, transaction, db }
}

describe('촬영 초안 IndexedDB', () => {
  it('없는 초안은 빈 목록으로 반환하고 DB를 닫는다', async () => {
    const mock = database()
    const pending = captureDraft('exam:week')
    await vi.waitFor(() => expect(mock.store.get).toHaveBeenCalledWith('exam:week'))
    mock.request.onsuccess?.()
    mock.transaction.oncomplete?.()
    expect(await pending).toEqual([])
    expect(mock.db.close).toHaveBeenCalledOnce()
  })

  it('쓰기 요청 성공만으로 저장 완료를 보고하지 않고 트랜잭션 커밋을 기다린다', async () => {
    const mock = database()
    const photos = [{ id: 'one', blob: new Blob(['a']), name: 'a.jpg', lastModified: 1 }]
    let completed = false
    const pending = captureDraft('vocab:week', photos).then((value) => { completed = true; return value })
    await vi.waitFor(() => expect(mock.store.put).toHaveBeenCalledWith(photos, 'vocab:week'))
    mock.request.onsuccess?.()
    await Promise.resolve()
    expect(completed).toBe(false)
    mock.transaction.oncomplete?.()
    expect(await pending).toEqual(photos)
  })

  it('공간 부족 등 트랜잭션 취소를 호출자에 전달한다', async () => {
    const mock = database()
    const pending = captureDraft('exam:week', [])
    const assertion = expect(pending).rejects.toThrow('quota')
    await vi.waitFor(() => expect(mock.store.delete).toHaveBeenCalledWith('exam:week'))
    mock.transaction.error = new Error('quota')
    mock.transaction.onabort?.()
    await assertion
    expect(mock.db.close).toHaveBeenCalledOnce()
  })
})
