import { describe, expect, it } from 'vitest'
import { imageFindingsAudit } from '@/lib/book-pdf/image-audit-input'

const reviewed = { content: true, mapping: true, formatting: true, inventory: true }
const finding = { target: { g: 0, q: null, field: 'passage', choice: null }, kind: 'native_text', pages: [78],
  result: 'mismatch', original: 'printed word', candidate: 'different word', reason: '단어 불일치' }

describe('image findings verdict contract', () => {
  it('derives pass only from all reviewed categories and an empty findings list', () => {
    expect(imageFindingsAudit({ reviewed, findings: [] })).toEqual({ status: 'pass', checks: reviewed, issues: [] })
    expect(imageFindingsAudit({ reviewed: { ...reviewed, content: false }, findings: [] })).toBeNull()
    expect(imageFindingsAudit({ findings: [] })).toBeNull()
  })
  it('rejects contradictory global verdicts rather than overriding them', () => {
    expect(imageFindingsAudit({ reviewed, findings: [], status: 'repair' })).toBeNull()
    expect(imageFindingsAudit({ status: 'repair', checks: { ...reviewed, content: false }, issues: [] })).toBeNull()
  })
  it('holds a real mismatch with its original and candidate evidence', () => {
    const audit = imageFindingsAudit({ reviewed, findings: [finding] })
    expect(audit?.status).toBe('repair')
    expect(audit?.checks.content).toBe(false)
    expect(audit?.issues[0].reason).toContain('원본: printed word; 후보: different word')
  })
  it.each(['printed word', ' printed  word\n'])('rejects identical/space-only evidence without manufacturing a pass: %s', candidate => {
    expect(imageFindingsAudit({ reviewed, findings: [{ ...finding, candidate }] })).toBeNull()
  })
  it('does not erase word boundaries, hyphens, punctuation or underline differences', () => {
    for (const [original, candidate] of [['a part', 'apart'], ['re-sign', 'resign'], ['word,', 'word'], ['<u>그녀</u>는', '<u>그녀는</u>']]) {
      expect(imageFindingsAudit({ reviewed, findings: [{ ...finding, original, candidate }] })?.status).toBe('repair')
    }
  })
  it('unreadable remains held even if other findings are actionable', () => {
    expect(imageFindingsAudit({ reviewed, findings: [finding, { ...finding, result: 'unreadable', original: '(판독 불가)' }] })?.status).toBe('unreadable')
  })
})
