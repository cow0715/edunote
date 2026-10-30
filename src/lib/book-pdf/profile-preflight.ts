import { createCallLimiter, getPdfWorkerContext } from '../pdf-import/context'
import { PdfBatchStopped, PdfBundleDeferred } from '../pdf-import/batch-policy'
import { bookPageSlice } from './pdf'
import { readLayoutSource } from './layout-source'
import { bookFingerprint, bookSourceFingerprint } from './proof'
import { BOOK_PROFILE_VERSION, bookUnitProfile, mapBookProfile } from './profiles'
import type { SourceMap, SourcePage } from './source-map'
import type { BookManifest, BookUnitManifest } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PdfImportJob } from '../pdf-import/types'

export type ProfileSource = { pages: SourcePage[]; mapping: SourceMap | null; reasons: string[] }
export function profileSourceKey(unit: BookUnitManifest, pdfHash: string) {
  return bookFingerprint({ profile: BOOK_PROFILE_VERSION, pdfHash, source: bookSourceFingerprint(unit) })
}
/** Structural representatives, rather than the first few easy pages. */
export function bookPilotKeys(units: BookUnitManifest[], sources: Map<string, ProfileSource>) {
  const keys = new Set<string>()
  const add = (u?: BookUnitManifest) => { if (u && keys.size < 6) keys.add(u.key) }
  add(units[0]); add(units.at(-1)); add(units.find(u => u.questions.length > 1))
  add([...units].sort((a,b) => b.pages.length-a.pages.length)[0])
  add(units.find(u => !sources.get(u.key)?.mapping))
  for (const profile of new Set(units.map(bookUnitProfile))) add(units.find(u => bookUnitProfile(u) === profile))
  for (const u of units) { add(u); if (keys.size === 6) break }
  return [...keys]
}
/** Entire-file native preflight is durable and cannot create a model request. */
export async function prepareBookProfiles(bytes: Uint8Array, manifest: BookManifest, pdfHash: string) {
  if (manifest.errors.length || manifest.units.some(u => !bookUnitProfile(u) || u.pages.length > 4)) throw new PdfBatchStopped('교재 형식·문항 경계를 확인하지 못했습니다. AI 요청 전에 보류했습니다.')
  const context = getPdfWorkerContext(), sources = new Map<string, ProfileSource>(), limit = createCallLimiter(2)
  await Promise.all(manifest.units.map(unit => limit(async () => {
    const key = profileSourceKey(unit, pdfHash)
    let source = await context?.read<ProfileSource>(key)
    if (!source) {
      const pdf = await bookPageSlice(bytes, unit.pages)
      const pages = await readLayoutSource(new Uint8Array(Buffer.from(pdf, 'base64')), unit.pages)
      const result = mapBookProfile(pages, unit)
      source = { pages, mapping: result.mapping, reasons: result.reasons }
      await context?.write(key, source)
    }
    sources.set(unit.key, source)
  })))
  const ambiguous = manifest.units.filter(u => !sources.get(u.key)?.mapping)
  if (ambiguous.length > Math.max(3, Math.ceil(manifest.units.length * .25))) throw new PdfBatchStopped(`형식별 코드 연결을 확정하지 못한 지문이 ${ambiguous.length}/${manifest.units.length}개입니다. 범용 AI 전체 전환 없이 보류했습니다.`)
  const plan = { version: BOOK_PROFILE_VERSION, pdf_hash: pdfHash, question_count: manifest.question_count,
    unit_count: manifest.units.length, pilot_keys: bookPilotKeys(manifest.units, sources),
    ambiguous_units: ambiguous.map(u => u.key), snapshot_hash: bookFingerprint(manifest.units.map(u => [u.key, sources.get(u.key)])) }
  return { sources, plan }
}
export async function saveBookProfilePlan(db: SupabaseClient, job: PdfImportJob, plan: unknown) {
  const { data, error } = await db.rpc('book_pdf_profile_plan', { p_job: job.id, p_token: job.lease_token, p_plan: plan })
  if (error || !data) throw new PdfBatchStopped('묶음 교재 사전 검사 저장에 실패했습니다. 묶음 등록 SQL을 확인해주세요.')
  if (data.waiting) throw new PdfBundleDeferred()
  if (data.phase === 'held') throw new PdfBatchStopped(data.reason || '교재 준비 구간 검사에서 보류했습니다.')
  return data as { phase: 'pilot' | 'bulk'; pilot_keys: string[] }
}
