import { createHash } from 'node:crypto'
import { bookExtractionSchema, type BookDraftUnit, type BookUnitManifest, type BookVerification } from './types'
import { validateMaterialSupplement } from '../llm/material-enrichment-contract'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function bookFingerprint(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex') }
export function bookSourceFingerprint(unit: BookUnitManifest) { return bookFingerprint(unit) }
export function bookSourceProofMatches(proof: BookVerification, extraction: unknown, manifest: BookUnitManifest) {
  const parsed = bookExtractionSchema.safeParse(extraction), audit = proof.audit, hash = /^[a-f0-9]{64}$/
  return parsed.success && proof.protocol === 2 && proof.pipeline === 'native-image-v1' && proof.status === 'passed'
    && proof.source_hash === bookSourceFingerprint(manifest) && proof.extraction_hash === bookFingerprint(parsed.data)
    && hash.test(proof.pdf_hash) && Array.isArray(proof.models) && proof.models.length > 0
    && Array.isArray(proof.issues) && !proof.issues.length && !!proof.checks
    && ['boundaries', 'legibility', 'formatting', 'visual_reference'].every((k) => proof.checks![k as keyof typeof proof.checks] === true)
    && !!audit && audit.last_status === 'pass' && Number.isInteger(audit.rounds) && audit.rounds >= 1 && audit.rounds <= 3
    && audit.rounds === proof.attempts && audit.extraction_hash === proof.extraction_hash
    && hash.test(audit.native_hash) && hash.test(audit.mapping_hash) && Array.isArray(audit.pages)
    && JSON.stringify(audit.pages) === JSON.stringify(manifest.pages)
    && !!audit.image_hashes && Object.keys(audit.image_hashes).length === manifest.pages.length
    && manifest.pages.every((p) => hash.test(audit.image_hashes[p] ?? ''))
}

export function bookProofMatches(unit: Pick<BookDraftUnit, 'extraction' | 'manifest' | 'verification' | 'version' | 'verified_version' | 'enrichment'>) {
  const proof: BookVerification | undefined = unit.verification
  const parsed = bookExtractionSchema.safeParse(unit.extraction)
  if (proof?.protocol === 2) {
    if (!parsed.success || unit.verified_version !== unit.version || !bookSourceProofMatches(proof, parsed.data, unit.manifest)) return false
    const enrichment = unit.enrichment
    if (!enrichment || enrichment.protocol !== 1 || enrichment.status !== 'complete' || !enrichment.model
      || !proof.models.includes(enrichment.model) || enrichment.source_hash !== proof.extraction_hash
      || proof.enrichment_hash !== bookFingerprint(enrichment)) return false
    try { validateMaterialSupplement(parsed.data, { questions: enrichment.questions }); return true } catch { return false }
  }
  return !!proof && parsed.success && proof.protocol === 1 && proof.status === 'passed'
    && unit.verified_version === unit.version && !!proof.checks && ['boundaries', 'legibility', 'formatting', 'visual_reference'].every((k) => proof.checks![k as keyof typeof proof.checks] === true)
    && Array.isArray(proof.models) && new Set(proof.models).size >= 2
    && Array.isArray(proof.issues) && proof.issues.length === 0 && proof.source_hash === bookSourceFingerprint(unit.manifest)
    && proof.extraction_hash === bookFingerprint(parsed.data)
}
