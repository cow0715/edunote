import { normalizeFindErrorKeyText } from './find-error-grading'
import type { ParsedAnswer } from './llm/week'

const bundledCorrections = /(?:^|[\n/,;])\s*(?:\(?[a-z0-9]{1,2}\)?|[①-⑳ⓐ-ⓩ])\s*[:：]/i

const ordinal = (symbol: string) => {
  const value = symbol.normalize('NFKC').replace(/[()]/g, '').toLowerCase()
  return /^[a-z]$/.test(value) ? value.charCodeAt(0) - 96 : Number(value)
}

/** Inspect response structure, never solve a question or invent a correction. */
export function weekAnswerContractIssues(answers: readonly ParsedAnswer[]): string[] {
  const groups = new Map<number, ParsedAnswer[]>()
  for (const q of answers) groups.set(q.question_number, [...(groups.get(q.question_number) ?? []), q])
  const issues: string[] = []
  for (const [number, group] of groups) {
    const instruction = [...new Set(group.map(q => q.question_stem?.trim() || q.question_text?.split(/\n\s*\n/)[0]?.trim() || ''))].join('\n')
    if (!/고[쳐치]|수정/.test(instruction)) continue
    const styles = new Set(group.map(q => q.question_style))
    const fail = (text: string) => issues.push(`${number}번: ${text}`)
    const binary = /맞으면\s*[OT]|틀리면\s*[XF]|O\s*[/·,]\s*X|O.*X.*(?:표기|표시|쓰)|T\s*[/·,]\s*F/i.test(instruction)
    if (binary) {
      if (styles.size !== 1 || !styles.has('ox')) fail('원문이 O/X 또는 T/F 표시를 요구하면 ox로 추출하세요.')
      continue
    }
    const everyItem = /(?:옳은|맞는|올바른)\s*(?:것|표현|문장)?[^\n]*그대로/.test(instruction)
    const composite = /(?:우리말|한글)\s*뜻|뜻을\s*(?:쓰|적)/.test(instruction)
    if (everyItem || composite) {
      if (styles.size !== 1 || !styles.has('subjective')) fail('모든 항목의 표현 또는 복합 답안을 쓰는 문항은 subjective로 추출하세요. O/X나 틀린 기호만 선택하는 형식이 아닙니다.')
      continue
    }
    if (!/(?:틀린|잘못|어색|맞지|적절하지|부적절)/.test(instruction) || !/(?:골라|고르|찾|선택)/.test(instruction)) continue
    const source = group.map(q => [q.question_text, q.passage].filter(Boolean).join('\n')).join('\n')
    const marked = /번호|기호|[①-⑳ⓐ-ⓩ]|\([A-Za-z]\)\s*[~～〜–-]/.test(instruction) ||
      new Set(source.match(/[①-⑳ⓐ-ⓩ]|\([A-Za-z]\)/g) ?? []).size >= 2
    const expectedStyle = marked ? 'find_error' : 'subjective'
    if (styles.size !== 1 || !styles.has(expectedStyle)) fail(marked
      ? '번호·기호를 골라 고치는 문항은 find_error입니다. 수정 표현까지 각 기호별로 분리하세요.'
      : '기호 없는 단어·문장 교정은 subjective입니다. 번호·기호를 만들지 말고 원문 답안 형식을 유지하세요.')
    const grounded = group.every(q => q.answer_status === 'found' && !!q.correct_answer_text?.trim())
    if (!grounded) continue // Missing source answers stay unresolved; never force a guessed key.
    const counts: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }
    const count = instruction.match(/(\d+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*개/)
    const required = count ? Number(count[1]) || counts[count[1]] : null
    if (required && group.length !== required) fail(`수정할 답 ${required}개를 각각 별도 객체로 추출하세요. 현재 ${group.length}개입니다.`)
    const symbols = new Set<number>()
    for (const q of group) {
      const key = q.correct_answer_text ?? ''
      if (bundledCorrections.test(key.replace(/^[a-z0-9]+\s*:\s*/i, ''))) {
        fail('한 정답에 여러 기호의 답을 묶지 마세요. 각 기호별 객체로 다시 추출하세요.')
      }
      if (expectedStyle !== 'find_error') continue
      const prefix = key.match(/^([a-z]|[1-9][0-9]?)\s*:\s*\S/i)?.[1]
      const symbol = prefix ? ordinal(prefix) : NaN
      if (!prefix || !q.sub_label || symbol !== ordinal(q.sub_label)) fail('오류교정 정답은 실제 기호와 일치하는 sub_label 및 기호:수정어 형식이어야 합니다.')
      if (symbols.has(symbol)) fail('같은 오류 기호를 여러 소문항으로 중복 추출했습니다.')
      symbols.add(symbol)
    }
  }
  return [...new Set(issues)]
}

/** Preserve source symbols beyond e in new extraction; shared grading is unchanged. */
export function normalizeNewCorrectionKey(value: string | null): string | null {
  const pair = value?.normalize('NFKC').match(/^\(?([a-z]|[1-9][0-9]?)\)?\s*:\s*(\S[\s\S]*)$/i)
  if (!pair) return normalizeFindErrorKeyText(value)
  const correction = pair[2].trim()
  // Keep merged entries intact so validation can reject them; never truncate to the last key.
  const normalized = bundledCorrections.test(correction) ? correction : correction.split(/→|->/).at(-1)!.trim()
  return `${pair[1].toLowerCase()}:${normalized}`
}

export function canRepairCorrectionInventory(answers: readonly ParsedAnswer[]): boolean {
  if (!answers.length || weekAnswerContractIssues(answers).length) return false
  const instruction = answers.map(q => q.question_stem || q.question_text?.split(/\n\s*\n/)[0] || '').join('\n')
  return /고[쳐치]|수정/.test(instruction) && /골라|고르|찾|선택/.test(instruction) &&
    !/그대로|(?:우리말|한글)\s*뜻|뜻을\s*(?:쓰|적)/.test(instruction) &&
    answers.every(q => (q.question_style === 'find_error' || q.question_style === 'subjective') &&
      /^[a-z]$/.test(q.sub_label ?? '') && q.answer_status === 'found' && !!q.answer_evidence?.quote) &&
    new Set(answers.map(q => q.sub_label)).size === answers.length
}

export const NEW_CORRECTION_EXTRACTION_RULES = `신규 문항 답안 형식 검증 계약:
- 번호·기호 중 틀린 항목만 골라 고치면 find_error. 번호만 고르는 객관식/복수선택과 다릅니다.
- 번호·기호가 없는 틀린 단어→수정어, 기호 없는 문장 전체 교정, 수정문장+우리말 뜻은 subjective. 없는 번호를 만들지 마세요.
- 옳은 항목은 그대로 쓰고 모든 항목에 답하거나 순서대로 쓰면 subjective. 원문이 명시적으로 O/X 또는 T/F 표기를 요구할 때만 ox입니다.
- 여러 교정 답을 하나의 correct_answer_text에 묶지 말고 독립 채점 답마다 객체를 분리하세요. 기호가 있으면 실제 기호를 sub_label과 기호:수정어 정답키에 보존하세요. ⓕ/ⓖ도 f/g로 보존합니다.
- 기호 없는 교정 답이 여러 개면 원문 답안 칸 순서의 a,b,…로 분리합니다. 한 문장+그 문장의 뜻처럼 한 묶음으로 채점하는 복합 답안은 분리하지 않습니다.
- 지정 개수는 문제 지시와 원문 정답으로 대조하세요. 모두 선택형은 보기 수가 정답 수가 아닙니다. 틀린 기호의 원문 정답만 객체로 만들고, 옳은 보기나 남는 빈 슬롯을 정답 객체로 만들지 마세요.
- 문항 목록과 실제 교정 답 개수가 충돌하면 실제 원문 기호·답안 형식을 유지하세요. 정답 근거가 없으면 missing/ambiguous로 남기고 정답이나 수정어를 추론하지 마세요.`
