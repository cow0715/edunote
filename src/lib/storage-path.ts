/**
 * Supabase Storage 경로 유틸.
 *
 * storage.list() 는 "폴더 + 파일명" 을 따로 받는다.
 * 저장된 경로 문자열을 그 형태로 쪼갠다.
 */

export type StoragePathParts = {
  /** list() 의 첫 인자로 넘길 폴더 경로. 루트면 빈 문자열 */
  dir: string
  /** 파일명 */
  name: string
}

export function splitStoragePath(path: string): StoragePathParts {
  const trimmed = path.replace(/^\/+/, '')
  const lastSlash = trimmed.lastIndexOf('/')
  if (lastSlash < 0) return { dir: '', name: trimmed }
  return { dir: trimmed.slice(0, lastSlash), name: trimmed.slice(lastSlash + 1) }
}
