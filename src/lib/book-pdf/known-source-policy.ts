import corrections from './known-source-corrections.json'
import type { BookExtraction } from './types'

export const KNOWN_SOURCE_REVISION = 'source-review-20261101-v1'
export const KNOWN_SOURCE_POLICIES = [
  { pdfHash: 'e63ca425787882bcf77d60499e0d94ebd0daa195ce4f443f95de35623608606a', sourceHash: '7836115d29a2305659a060aef4e8ea1245cab08966bca192794b133a610e9de2',
    baseHash: '07e5acb6e90af5226bd1a73dfecc5c48072869a9b653c82f92b28b8c046c8037', unit: 'unit-57', label: '유형편 10강 2번', reason: '해석·해설의 쉼표와 마침표 위치가 원본과 다릅니다.', kind: 'punctuation' },
  { pdfHash: 'ec8b7227b1244680dae9ccc65353694eb8440b7385dc6ae68a1b6c953042f45c', sourceHash: '7b5ef8399febd6e609b86a21b5144c0ac9b479d7eed6e30da9d01fd92e4c1b9c',
    baseHash: 'a8bbededa2fbc7b91a1821c3210cb72caec2c23308a075d0088ed5a44d1456ae', unit: 'unit-24', label: '실전편 1회 41·42번', reason: '공유 지문의 42번 소재 연결이 빠져 있습니다.', kind: 'shared-intent' },
] as const
export function knownSourcePolicy(pdfHash: string, sourceHash: string) {
  return KNOWN_SOURCE_POLICIES.find(p => p.pdfHash === pdfHash && p.sourceHash === sourceHash)
}

/** Already-received Sonnet patches, visually checked against the original PDF.
 * This creates a candidate, never a pass. Exact preimage binding is mandatory;
 * a different candidate goes to the normal Sonnet audit without guessed edits. */
export function correctKnownSource(policy: typeof KNOWN_SOURCE_POLICIES[number], extraction: BookExtraction, hash: string) {
  if (hash !== policy.baseHash) return { extraction: structuredClone(extraction), replayed: false }
  const copy = structuredClone(extraction)
  if (policy.kind === 'shared-intent') {
    if (copy.questions.length !== 2 || copy.questions[0].intent !== '미리 형성된 좋은 기업 평판의 효과' || copy.questions[1].intent !== '') throw Error('Known shared intent preimage changed')
    copy.questions[1].intent = copy.questions[0].intent
  } else {
    for (const edit of corrections.typeEdits) {
      const field = edit.field === 'translation' ? 'translation' : 'solution'
      let text = field === 'translation' ? copy.translation : copy.questions[0].solution
      for (const patch of edit.patches) {
        if (text.split(patch.before).length !== 2) throw Error('Known source patch anchor changed')
        text = text.replace(patch.before, patch.after)
      }
      if (field === 'translation') copy.translation = text
      else copy.questions[0].solution = text
    }
  }
  return { extraction: copy, replayed: true }
}
