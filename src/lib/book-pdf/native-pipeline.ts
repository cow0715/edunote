import { bookVisualRegions } from './visual-regions'
import { MODEL_IDS } from '../llm/models'
import { ZodError } from 'zod'
import { enrichVerifiedMaterialDetailed } from '../llm/material-enrichment'
import { isContentFilterError, isJsonParseError } from '../llm/client'
import { getPdfWorkerContext, reportPdfStage } from '../pdf-import/context'
import { auditAndRepairSource } from './audit-source'
import { readLayoutSource } from './layout-source'
import { mapBookSource } from './map-source'
import { bindBookMapping, nativeBookExtraction, validateNativeBookUnit } from './native-unit'
import { bookFingerprint, bookProofMatches, bookSourceFingerprint, bookSourceProofMatches, bookSourceArchiveMatches } from './proof'
import { renderBookSourceImages } from './render-source'
import { resolveSourceMap, sourceMapSchema } from './source-map'
import { NATIVE_RECOVERY_REVISION } from './recovery-policy'
import { BookBatchRequestFailed } from './batch-policy'
import { bookExtractionSchema } from './types'
import type { ProfileSource } from './profile-preflight'
import type { BookEnrichment, BookExtraction, BookUnitManifest, BookValidation, BookVerification } from './types'
import { readBookUnitStage, writeBookUnitStage, reportBookUnitProgress } from './unit-progress'
import { PdfBatchStopped } from '../pdf-import/batch-policy'
import { knownSourcePolicy, correctKnownSource, KNOWN_SOURCE_REVISION } from './known-source-policy'

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
  const sourceHash = bookSourceFingerprint(unit), policy = knownSourcePolicy(pdfHash, sourceHash)
  const legacyScope = { pdfHash, sourceHash }
  const scope = { ...legacyScope, ...(policy ? { sourceRevision: KNOWN_SOURCE_REVISION } : {}) }, questionKeys = unit.questions.map(q => q.key)
  const complete = await readBookUnitStage<NativeBookResult>(scope, 'complete')
  if (complete) {
    if (complete.verification?.pdf_hash !== pdfHash || !bookProofMatches({ ...complete, manifest: unit, version: 1, verified_version: 1 })) throw new PdfBatchStopped('완료된 문항의 검증 기록이 달라 새 요청을 중지했습니다.')
    await reportBookUnitProgress(scope, questionKeys, 'complete', 'complete')
    return complete
  }
  // Historical identities name the Sonnet image auditor, not the mapping or
  // enrichment model. Keep them stable; proofs record the models actually used.
  const sourceKey = bookFingerprint({ pipeline: 'native-image-v1', unit: bookSourceFingerprint(unit), pdfHash, model: MODEL_IDS.sonnet55, render: 'poppler-2000' })
  const layoutKey = bookFingerprint({ pipeline: 'native-image-v1', layout: 1, unit: bookSourceFingerprint(unit), pdfHash, model: MODEL_IDS.sonnet55, render: 'poppler-2000' })
  const revisedKey = policy ? bookFingerprint({ sourceKey, revision: KNOWN_SOURCE_REVISION }) : sourceKey
  let archived: SourceResult | null = null
  if (policy) {
    for (const saved of [await readBookUnitStage<SourceResult>(legacyScope, 'source'), await readBookUnitStage<SourceResult>(legacyScope, 'complete'),
      await context?.read<SourceResult>(sourceKey), await context?.read<SourceResult>(layoutKey)]) {
      if (saved?.extraction && saved.verification?.pdf_hash === pdfHash && bookSourceArchiveMatches(saved.verification, saved.extraction, unit)) { archived = saved; break }
    }
  }
  let source = await readBookUnitStage<SourceResult>(scope, 'source')
  if (source && (!source.extraction || source.verification?.pdf_hash !== pdfHash || !bookSourceProofMatches(source.verification, source.extraction, unit) || source.validation.errors.length)) throw new PdfBatchStopped('원본 검증 완료 기록이 달라 재파싱을 중지했습니다.')
  // Deployments must not invalidate paid, image-verified source material merely
  // because paragraph-layout support was added or removed from the request.
  for (const key of [revisedKey, sourceKey, layoutKey]) {
    if (source) break
    const saved = await context?.read<SourceResult>(key)
    if (saved?.extraction && saved.verification?.pdf_hash === pdfHash && bookSourceProofMatches(saved.verification, saved.extraction, unit)
      && Array.isArray(saved.validation?.errors) && !saved.validation.errors.length) { source = saved; break }
  }
  if (!source) {
    source = await parseSource()
    context?.signal.throwIfAborted()
    if (source.verification.status === 'passed') await context?.write(revisedKey, source)
  }
  if (!source.extraction || source.verification.status !== 'passed') {
    return { ...source, enrichment: null }
  }
  await writeBookUnitStage(scope, 'source', source)
  await context?.quality?.(unit.key, 'passed')
  // JSONB restores object keys in a different order. Match the fresh extraction's
  // schema order before JSON.stringify, otherwise a resumed supplement gets a
  // different request identity and the completed batch response cannot be reused.
  const enrichmentSource = context?.batchCall ? bookExtractionSchema.parse(source.extraction) : source.extraction
  await reportPdfStage(`${unit.questions[0].label}: 검증된 원문으로 풀이·어휘를 보완하는 중`)
  await reportBookUnitProgress(scope, questionKeys, 'enrichment', 'waiting')
  try {
    const { supplement, model } = await enrichVerifiedMaterialDetailed(enrichmentSource)
    const enrichment: BookEnrichment = { ...supplement, protocol: 1, status: 'complete', source_hash: bookFingerprint(source.extraction), model }
    const result = { ...source, enrichment, verification: { ...source.verification,
      models: [...new Set([...source.verification.models, model])], enrichment_hash: bookFingerprint(enrichment) } }
    await writeBookUnitStage(scope, 'complete', result)
    await reportBookUnitProgress(scope, questionKeys, 'complete', 'complete')
    return result
  } catch (error) {
    if (!qualityError(error) && !(error instanceof BookBatchRequestFailed)) throw error
    await reportBookUnitProgress(scope, questionKeys, 'enrichment', 'held', [error instanceof Error ? error.message : 'invalid_supplement'])
    await context?.quality?.(unit.key, 'failed')
    return { ...source, enrichment: null, verification: { ...source.verification, status: 'unresolved', exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION,
      issues: [error instanceof BookBatchRequestFailed ? error.message : '원문 검증은 완료했지만 풀이·어휘 보완 응답을 확정하지 못했습니다.'] } }
  }

  async function parseSource(): Promise<SourceResult> {
    let extraction: BookExtraction | null = null
    const base: BookVerification = { protocol: 2, pipeline: 'native-image-v1', status: 'unresolved', attempts: 0,
      exhausted: true, recovery_revision: NATIVE_RECOVERY_REVISION, models: [MODEL_IDS.sonnet55], issues: [], source_hash: bookSourceFingerprint(unit), pdf_hash: pdfHash, extraction_hash: null, checks: null }
    if (policy) base.source_revision = KNOWN_SOURCE_REVISION
    async function unresolved(issues: string[], stage: 'mapping' | 'audit' = 'mapping') {
      await reportBookUnitProgress(scope, questionKeys, stage, 'held', issues)
      await context?.quality?.(unit.key, 'failed')
      return { extraction, validation: { errors: issues, warnings: [], english_coverage: 0, translation_coverage: 0 },
        verification: { ...base, issues, extraction_hash: extraction ? bookFingerprint(extraction) : null } }
    }
    if (!unit.pages.length || unit.pages.length > 4) return unresolved(['지문 묶음이 이미지 검증 범위(1~4페이지)를 벗어났습니다. 원문을 잘라 처리하지 않습니다.'])
    await reportPdfStage(`${unit.questions[0].label}: 원문 좌표 추출·연결을 확인하는 중`)
    const pages = input.prepared?.pages ?? await readLayoutSource(input.bytes, unit.pages), pdf = Buffer.from(input.bytes).toString('base64')
    const targets = unit.questions.map(({ key, label }) => ({ key, label }))
    type MappingProgress = { nativeHash: string; attempt: number; previous?: unknown; errors: string[]; mapping: unknown; model?: string | null }
    const nativeHash = bookFingerprint(pages)
    let savedMapping = await readBookUnitStage<MappingProgress>(scope, 'mapping')
    if (!savedMapping && policy) {
      const old = await readBookUnitStage<MappingProgress>(legacyScope, 'mapping')
      if (old?.mapping && old.nativeHash === nativeHash) savedMapping = old
    }
    if (savedMapping && (savedMapping.nativeHash !== nativeHash || !Number.isInteger(savedMapping.attempt) || savedMapping.attempt < 0 || savedMapping.attempt > 2)) throw new PdfBatchStopped('문항 연결의 원문 좌표가 바뀌어 새 요청을 중지했습니다.')
    let previous: unknown = savedMapping?.previous, errors: string[] = savedMapping?.errors ?? [], mapping: ReturnType<typeof sourceMapSchema.parse> | null = null
    if (savedMapping?.mapping) {
      mapping = bindBookMapping(unit, sourceMapSchema.parse(savedMapping.mapping))
      if (resolveSourceMap(pages, mapping).errors.some(e => !pages.flatMap(p => p.issues).includes(e))) throw new PdfBatchStopped('저장된 문항 연결이 유효하지 않아 새 요청을 중지했습니다.')
      if (savedMapping.model) base.models = [...new Set([...base.models, savedMapping.model])]
    }
    let mappingModel = savedMapping?.model ?? null
    const saveMapping = (attempt: number) => writeBookUnitStage(scope, 'mapping', { nativeHash, attempt, previous, errors, mapping, model: mappingModel })
    for (let attempt = savedMapping?.attempt ?? 0; !mapping && attempt < 2; attempt++) {
      await reportBookUnitProgress(scope, questionKeys, 'mapping', 'waiting')
      try {
        const mapped = await mapBookSource({ pages, pdf, targets, ...(input.prepared ? { profileMapping: input.prepared.mapping } : {}), ...(attempt ? { repair: { previous, errors } } : {}) })
        previous = mapped.mapping
        const warnings = new Set(pages.flatMap((p) => p.issues))
        errors = mapped.resolved.errors.filter((e) => !warnings.has(e))
        if (errors.length) { await saveMapping(attempt + 1); await context?.quality?.(unit.key, 'repair'); continue }
        mapping = bindBookMapping(unit, sourceMapSchema.parse(mapped.mapping))
        if (mapped.model) { mappingModel = mapped.model; base.models = [...new Set([...base.models, mapped.model])] }
        await saveMapping(attempt + 1)
        await context?.quality?.(unit.key, 'mapped')
        break
      } catch (error) {
        if (error instanceof BookBatchRequestFailed) return unresolved([error.message])
        if (!qualityError(error) && !(error instanceof Error && /대상 지문|문항 식별자/.test(error.message))) throw error
        errors = [error instanceof Error ? error.message : '원문 매핑 형식 오류']
        await saveMapping(attempt + 1)
        await context?.quality?.(unit.key, 'repair')
      }
    }
    if (!mapping) return unresolved(errors.length ? errors : ['원문 구역 연결을 확정하지 못했습니다.'])
    const images = await renderBookSourceImages(input.bytes, unit.pages), initial = resolveSourceMap(pages, mapping).groups
    if (policy && archived?.extraction) {
      const fixed = correctKnownSource(policy, archived.extraction, bookFingerprint(archived.extraction))
      initial[0].extraction = nativeBookExtraction(unit, fixed.extraction)
      base.local_correction = { revision: KNOWN_SOURCE_REVISION, base_hash: bookFingerprint(archived.extraction), replayed: fixed.replayed }
    } else initial[0].extraction = nativeBookExtraction(unit, initial[0].extraction)
    await reportPdfStage(`${unit.questions[0].label}: 원본 이미지 대조·부분 복구 중`)
    try {
      await reportBookUnitProgress(scope, questionKeys, 'audit', 'waiting')
      const result = await auditAndRepairSource({ pages, images, mapping, draft: initial, checkpoint: scope })
      base.attempts = result.audits.length
      base.models = [...new Set([...base.models, ...(result.models ?? [])])]
      if (result.groups.length === 1) extraction = nativeBookExtraction(unit, result.groups[0].extraction)
      if (result.status !== 'audited' || !extraction) return unresolved(result.errors.length ? result.errors : ['원본 이미지 검증을 통과하지 못했습니다.'], 'audit')
      const validation = validateNativeBookUnit(unit, extraction)
      if (validation.errors.length) return unresolved(validation.errors, 'audit')
      const extractionHash = bookFingerprint(extraction)
      await context?.quality?.(unit.key, 'passed')
      return { extraction, validation, verification: { ...base, source_regions: bookVisualRegions(pages, result.mapping, unit.visual_required), status: 'passed', exhausted: false, issues: [], extraction_hash: extractionHash,
        checks: { boundaries: true, legibility: true, formatting: true, visual_reference: true },
        audit: { pages: [...unit.pages], image_hashes: Object.fromEntries(images.map((i) => [i.page, i.sha256])), native_hash: bookFingerprint(pages),
          mapping_hash: bookFingerprint(result.mapping), rounds: result.audits.length, last_status: 'pass', extraction_hash: extractionHash } } }
    } catch (error) {
      if (error instanceof BookBatchRequestFailed) return unresolved([error.message], 'audit')
      if (!qualityError(error)) throw error
      return unresolved(['원본 이미지 대조·복구 응답이 완결되지 않았습니다.'], 'audit')
    }
  }
}
