import { describe, expect, it } from 'vitest'
import { splitStoragePath } from '@/lib/storage-path'

describe('splitStoragePath', () => {
  it('폴더가 있는 경로를 쪼갠다', () => {
    expect(splitStoragePath('week-123/photo.jpg')).toEqual({ dir: 'week-123', name: 'photo.jpg' })
  })

  it('중첩 폴더도 처리한다', () => {
    expect(splitStoragePath('a/b/c/photo.jpg')).toEqual({ dir: 'a/b/c', name: 'photo.jpg' })
  })

  it('루트 파일은 dir 이 빈 문자열', () => {
    expect(splitStoragePath('photo.jpg')).toEqual({ dir: '', name: 'photo.jpg' })
  })

  it('앞의 슬래시를 무시한다', () => {
    expect(splitStoragePath('/week-123/photo.jpg')).toEqual({ dir: 'week-123', name: 'photo.jpg' })
  })

  it('파일명에 점이나 공백이 있어도 그대로 둔다', () => {
    expect(splitStoragePath('w/2026-08-07 시험지.jpg')).toEqual({ dir: 'w', name: '2026-08-07 시험지.jpg' })
  })

  it('빈 문자열이면 빈 결과', () => {
    expect(splitStoragePath('')).toEqual({ dir: '', name: '' })
  })
})
