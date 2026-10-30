import { bookVisualRegions } from './visual-regions'
import { MODEL_IDS } from '../llm/models'
import { ZodError } from 'zod'
import { enrichVerifiedMaterial } from '../llm/material-enrichment'
import { isContentFilterError, isJsonParseError } from '../llm/client'
import { getPdfWorkerContext, reportPdfStage } from '../pdf-import/context'
import { auditAndRepairSource } from './audit-source'
import { readLayoutSource } from './layout-source'
import { mapBookSource } from './map-source'
import { bindBookMapping, nativeBookExtraction, validateNativeBookUnit } from './native-unit'
import { bookFingerprint, bookSourceFingerprint, bookSourceProofMatches } from './proof'
import { renderBookSourceImages } from './render-source'
import { resolveSourceMap, sourceMapSchema } from './source-map'
import { NATIVE_RECOVERY_REVISION } from './recovery-policy'
import { BookBatchRequestFailed } from './batch-policy'
import { bookExtractionSchema } from './types'
import type { ProfileSource } from './profile-preflight'
import type { BookEnrichment, BookExtraction, BookUnitManifest, BookValidation, BookVerification } from './types'

type SourceResult = { extraction: BookExtraction | null; validation: BookValidation; verification: BookVerification }
export type NativeBookResult = SourceResult & { enrichment: BookEnrichment | null }
function qualityError(error: unknown) {
  return error instanceof ZodError || isJsonParseError(error) || isContentFilterError(error)
    || (error instanceof Error && /not complete|incomplete|완결되지|보완 풀이·어휘의/.test(error.message))
}

/** Source parsing and enrichment are separate checkpoints. A failed enrichment
 * never sends a verified PDF back through paid mapping/image-audit calls. */
export async function processNativeBookUnit(input: { unit: BookUnitManifest; pdfHash: string; bytes: Uint8Array; prepared?: ProfileSource }): Promise<NativeBookResult> {
  const { unit, pdfHash } = input, context = getPdfWorkerContext()
  const sourceKey = bookFingerprint({ pipeline: 'native-image-v1', unit: bookSourceFingerprint(unit), pdfHash, model: MODEL_IDS.sonnet55, render: 'poppler-2000' })
  const layoutKey = bookFingerprint({ pipeline: 'native-image-v1', layout: 1, unit: bookSourceFingerprint(unit), pdfHash, model: MODEL_IDS.sonnet55, render: 'poppler-2000' })
  let source: SourceResult | null = null
  // Deployments must not invalidate paid, image-verified source material merely
  // because paragraph-layout support was added or removed from the request.
  for (const key of [sourceKey, layoutKey]) {
    const saved = await context?.read<SourceResult>(key)
    if (saved?.extraction && saved.verification?.pdf_hash === pdfHash && bookSourceProofMatches(saved.verification, saved.extraction, unit)
      && Array.isArray(saved.validation?.errors) && !saved.validation.errors.length) { source = saved; break }
  }
  if (!source) {
    source = await parseSource()
    context?.signal.throwIfAborted()
    if (source.verification.status === 'passed') await context?.write(sourceKey, source)
  }
  if (!source.extraction || source.verification.status !== 'passed') return { ...source, enrichment: null }
  await context?.quality?.(unit.key, 'passed')
  // JSONB restores object keys in a different order. Match the fresh extraction's
  // schema order before JSON.stringify, otherwise a resumed supplement gets a
  // different request identity and the completed batch response cannot be reused.
  const enrichmentSource = context?.batchCall ? bookExtractionSchema.parse(source.extraction) : source.extraction
  await reportPdfStage(`${unit.questions[0].label}: 검증된 원문으로 풀이·어휘를 보완하는 중`)
  try {
    const supplement = await enrichVerifiedMaterial(enrichmentSource)
    const enrichment: BookEnrichment = { ...supplement, protocol: 1, status: 'complete', source_hash: bookFingerprint(source.extraction), model: MODEL_IDS.sonnet55 }
    return { ...source, enrichment, verification: { ...source.verification, enrichment_hash: bookFingerprint(enrichment) } }
  } catch (error) {
    if (!qualityError(error) && !(error instanceof BookBatchRequestFailed)) throw error
    await context?.quality?.(unit.key, 'failed')
    return { ...source, enrichment: null, verification: { ...source.verification, status: 'unresolved', exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION,
      issues: [error instanceof BookBatchRequestFailed ? error.message : '원문 검증은 완료했지만 풀이·어휘 보완 응답을 확정하지 못했습니다.'] } }
  }

  async function parseSource(): Promise<SourceResult> {
    let extraction: BookExtraction | null = null
    const base: BookVerification = { protocol: 2, pipeline: 'native-image-v1', status: 'unresolved', attempts: 0,
      exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION, models: [MODEL_IDS.sonnet55], issues: [], source_hash: bookSourceFingerprint(unit), pdf_hash: pdfHash, extraction_hash: null, checks: null }
    async function unresolved(issues: string[]) {
      await context?.quality?.(unit.key, 'failed')
      return { extraction, validation: { errors: issues, warnings: [], english_coverage: 0, translation_coverage: 0 },
        verification: { ...base, issues, extraction_hash: extraction ? bookFingerprint(extraction) : null } }
    }
    if (!unit.pages.length || unit.pages.length > 4) return unresolved(['지문 묶음이 이미지 검증 범위(1~4페이지)를 벗어났습니다. 원문을 잘라 처리하지 않습니다.'])
    await reportPdfStage(`${unit.questions[0].label}: 원문 좌표 추출·연결을 확인하는 중`)
    const pages = input.prepared?.pages ?? await readLayoutSource(input.bytes, unit.pages), pdf = Buffer.from(input.bytes).toString('base64')
    const targets = unit.questions.map(({ key, label }) => ({ key, label }))
    let previous: unknown, errors: string[] = [], mapping: ReturnType<typeof sourceMapSchema.parse> | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const mapped = await mapBookSource({ pages, pdf, targets, ...(input.prepared ? { profileMapping: input.prepared.mapping } : {}), ...(attempt ? { repair: { previous, errors } } : {}) })
        previous = mapped.mapping
        const warnings = new Set(pages.flatMap((p) => p.issues))
        errors = mapped.resolved.errors.filter((e) => !warnings.has(e))
        if (errors.length) { await context?.quality?.(unit.key, 'repair'); continue }
        mapping = bindBookMapping(unit, sourceMapSchema.parse(mapped.mapping))
        await context?.quality?.(unit.key, 'mapped')
        break
      } catch (error) {
        if (error instanceof BookBatchRequestFailed) return unresolved([error.message])
        if (!qualityError(error) && !(error instanceof Error && /대상 지문|문항 식별자/.test(error.message))) throw error
        errors = [error instanceof Error ? error.message : '원문 매핑 형식 오류']
        await context?.quality?.(unit.key, 'repair')
      }
    }
    if (!mapping) return unresolved(errors.length ? errors : ['원문 구역 연결을 확정하지 못했습니다.'])
    const images = await renderBookSourceImages(input.bytes, unit.pages), initial = resolveSourceMap(pages, mapping).groups
    initial[0].extraction = nativeBookExtraction(unit, initial[0].extraction)
    await reportPdfStage(`${unit.questions[0].label}: 원본 이미지 대조·부분 복구 중`)
    try {
      const result = await auditAndRepairSource({ pages, images, mapping, draft: initial })
      base.attempts = result.audits.length
      if (result.groups.length === 1) extraction = nativeBookExtraction(unit, result.groups[0].extraction)
      if (result.status !== 'audited' || !extraction) return unresolved(result.errors.length ? result.errors : ['원본 이미지 검증을 통과하지 못했습니다.'])
      const validation = validateNativeBookUnit(unit, extraction)
      if (validation.errors.length) return unresolved(validation.errors)
      const extractionHash = bookFingerprint(extraction)
      await context?.quality?.(unit.key, 'passed')
      return { extraction, validation, verification: { ...base, source_regions: bookVisualRegions(pages, result.mapping, unit.visual_required), status: 'passed', exhausted: false, issues: [], extraction_hash: extractionHash,
        checks: { boundaries: true, legibility: true, formatting: true, visual_reference: true },
        audit: { pages: [...unit.pages], image_hashes: Object.fromEntries(images.map((i) => [i.page, i.sha256])), native_hash: bookFingerprint(pages),
          mapping_hash: bookFingerprint(result.mapping), rounds: result.audits.length, last_status: 'pass', extraction_hash: extractionHash } } }
    } catch (error) {
      if (error instanceof BookBatchRequestFailed) return unresolved([error.message])
      if (!qualityError(error)) throw error
      return unresolved(['원본 이미지 대조·복구 응답이 완결되지 않았습니다.'])
    }
  }
}
