import { sourceAuditFixture } from './book-source-audit'
import { extraction, manifest, pdfHash } from './book-pdf'
import { resolveSourceMap } from '@/lib/book-pdf/source-map'
import { bookFingerprint, bookSourceFingerprint } from '@/lib/book-pdf/proof'
import type { BookEnrichment, BookVerification } from '@/lib/book-pdf/types'

export function nativeFixture() {
  const f = sourceAuditFixture(), texts = [extraction.passage, extraction.translation, extraction.vocabulary, '[수능특강(영어) 1강 1번]',
    '발문', ...extraction.questions[0].choices, '[정답]②', '원문 소재', '원문 해설']
  f.pages[0].lines.forEach((l, i) => { l.text = texts[i] })
  f.mapping.groups[0].questions[0].id = '1:exercise:1'
  const unit = { ...structuredClone(manifest.units[0]), pages: [9] }, groups = resolveSourceMap(f.pages, f.mapping).groups
  const images = [{ page: 9, data: 'png', sha256: 'a'.repeat(64) }]
  const enrichment: BookEnrichment = { protocol: 1, status: 'complete', source_hash: bookFingerprint(extraction), model: 'claude-sonnet-5-5',
    questions: [{ key: '1:exercise:1', solution: '추가 설명', vocabulary: 'intact 온전한' }] }
  const proof: BookVerification = { protocol: 2, pipeline: 'native-image-v1', status: 'passed', attempts: 1, models: [enrichment.model], issues: [],
    source_hash: bookSourceFingerprint(unit), pdf_hash: pdfHash, extraction_hash: bookFingerprint(extraction), enrichment_hash: bookFingerprint(enrichment),
    checks: { boundaries: true, legibility: true, formatting: true, visual_reference: true },
    audit: { pages: unit.pages, image_hashes: { 9: images[0].sha256 }, native_hash: bookFingerprint(f.pages), mapping_hash: bookFingerprint(f.mapping),
      rounds: 1, last_status: 'pass', extraction_hash: bookFingerprint(extraction) } }
  return { ...f, unit, groups, images, enrichment, proof }
}
