import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ mkdir:vi.fn(),read:vi.fn(),list:vi.fn(),remove:vi.fn(),write:vi.fn(),spawn:vi.fn() }))
vi.mock('node:fs/promises', () => ({ mkdtemp:mocks.mkdir,readFile:mocks.read,readdir:mocks.list,rm:mocks.remove,writeFile:mocks.write }))
vi.mock('node:child_process', () => ({ spawn:mocks.spawn }))
import { renderBookSourceImages } from '@/lib/book-pdf/render-source'
const dir = join(tmpdir(),'edunote-book-test')
beforeEach(() => {
  vi.clearAllMocks();mocks.mkdir.mockResolvedValue(dir);mocks.list.mockResolvedValue(['page-2.png','page-1.png','source.pdf'])
  mocks.read.mockResolvedValue(Buffer.from('original rendered pixels'));mocks.write.mockResolvedValue(undefined);mocks.remove.mockResolvedValue(undefined)
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(),{stderr:new EventEmitter()})
    queueMicrotask(() => child.emit('close',0));return child
  })
})
describe('independent bounded source-image rendering', () => {
  it('renders only a bounded unit, maps page order and hashes original PNG bytes', async () => {
    const r = await renderBookSourceImages(new Uint8Array([1]),[96,97])
    expect(r.map((i) => i.page)).toEqual([96,97]);expect(r[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.spawn.mock.calls[0][1]).toContain('2000')
    expect(mocks.read.mock.calls[0][0]).toBe(join(dir,'page-1.png'))
    expect(mocks.remove).toHaveBeenCalledWith(dir,{recursive:true,force:true})
  })
  it('cleans temporary originals on renderer failure and rejects missing images', async () => {
    mocks.spawn.mockImplementation(() => {
      const child=Object.assign(new EventEmitter(),{stderr:new EventEmitter()})
      queueMicrotask(() => child.emit('close',1));return child
    })
    await expect(renderBookSourceImages(new Uint8Array([1]),[2])).rejects.toThrow('렌더링 실패')
    expect(mocks.remove).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized units before writing files', async () => {
    await expect(renderBookSourceImages(new Uint8Array([1]),[1,2,3,4,5])).rejects.toThrow('1~4페이지')
    expect(mocks.mkdir).not.toHaveBeenCalled()
  })
})
