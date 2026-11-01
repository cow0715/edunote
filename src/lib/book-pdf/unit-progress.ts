import { bookFingerprint } from './proof'
import { getPdfWorkerContext } from '../pdf-import/context'
import { PdfBatchStopped } from '../pdf-import/batch-policy'

export type BookUnitScope = { pdfHash: string; sourceHash: string }
export type BookUnitStage = 'mapping' | 'audit' | 'source' | 'enrichment' | 'complete' | 'progress'
export function bookUnitStageKey(scope: BookUnitScope, stage: BookUnitStage) {
  return `book-unit-stage:v1:${bookFingerprint({ ...scope, stage })}`
}

/** A serialized value preserves candidate order through JSONB, including legacy
 * request hashes. Stage identity deliberately excludes prompts/model routing. */
export async function readBookUnitStage<T>(scope: BookUnitScope, stage: BookUnitStage): Promise<T | null> {
  const saved = await getPdfWorkerContext()?.read<{ version: number; scope: BookUnitScope; stage: string; json: string; hash: string }>(bookUnitStageKey(scope, stage))
  if (saved == null) return null
  if (saved.version !== 1 || saved.stage !== stage || bookFingerprint(saved.scope) !== bookFingerprint(scope) || typeof saved.json !== 'string') {
    throw new PdfBatchStopped('교재 문항 진행 기록의 원문 연결이 달라 새 요청을 중지했습니다.')
  }
  try {
    const value = JSON.parse(saved.json) as T
    if (bookFingerprint(value) !== saved.hash) throw Error('hash mismatch')
    return value
  } catch { throw new PdfBatchStopped('교재 문항 진행 기록을 복원하지 못해 새 요청을 중지했습니다.') }
}

export async function writeBookUnitStage(scope: BookUnitScope, stage: BookUnitStage, value: unknown) {
  const context = getPdfWorkerContext()
  const json = JSON.stringify(value)
  await (context?.writeBookProgress ?? context?.write)?.(bookUnitStageKey(scope, stage), {
    version: 1, scope, unitKey: context?.unitKey ?? null, stage, json, hash: bookFingerprint(JSON.parse(json)),
  })
}

export async function reportBookUnitProgress(scope: BookUnitScope, questions: string[], stage: BookUnitStage, status: 'waiting' | 'complete' | 'held', reasons: string[] = []) {
  await writeBookUnitStage(scope, 'progress', { questions, stage, status, reasons })
}
