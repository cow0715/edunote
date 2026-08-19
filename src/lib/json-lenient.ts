/**
 * LLM 이 텍스트로 낸 JSON 의 흔한 결함 — 문자열 값 안의 큰따옴표를 이스케이프하지 않은 것 — 을 기계적으로 고친다.
 *
 * 실측: 문제지 파서가 지문 속 대화("Before receiving...", "I can't do that!")를 그대로 넣어
 * `"passage": "... told him, "Before ..." (b) He replied, "I can't ..." ..."` 형태로 내면
 * jsonrepair 는 첫 내부 따옴표에서 문자열이 끝난 줄 알고 "Colon expected" 로 실패한다.
 *
 * 규칙: 문자열 안에서 만난 `"` 는 뒤에 (공백 건너뛰고) 구조 문자가 올 때만 닫는 따옴표로 본다.
 *   - `:`  → 닫힘 (키였음)
 *   - `}` `]` → 닫힘
 *   - `,`  → 콤마 뒤 첫 비공백이 다음 값/키 시작(`"` `{` `[` `}` `]` 숫자 t f n)이면 닫힘, 아니면 본문
 *   - 입력 끝 → 닫힘
 *   - 그 외 → 본문의 따옴표 → `\"` 로 이스케이프
 * 한계: `He said "yes", "no"` 처럼 따옴표 뒤에 `, "` 가 오는 본문은 구분 못 한다 (드묾).
 * 정상 JSON 은 그대로 통과한다 — 닫는 따옴표 뒤엔 항상 구조 문자가 오므로.
 */
export function fixUnescapedQuotesInJson(input: string): string {
  let out = ''
  let inString = false
  const n = input.length

  const isValueStart = (ch: string) => ch === '"' || ch === '{' || ch === '[' || ch === '}' || ch === ']'
    || ch === '-' || (ch >= '0' && ch <= '9') || ch === 't' || ch === 'f' || ch === 'n'

  for (let i = 0; i < n; i += 1) {
    const ch = input[i]
    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }
    if (ch === '\\') {
      // 이스케이프 시퀀스는 그대로 (다음 글자 포함)
      out += ch
      if (i + 1 < n) { out += input[i + 1]; i += 1 }
      continue
    }
    if (ch !== '"') {
      out += ch
      continue
    }
    // 문자열 안의 따옴표: 닫는 것인지 판단
    let j = i + 1
    while (j < n && (input[j] === ' ' || input[j] === '\t' || input[j] === '\r' || input[j] === '\n')) j += 1
    const next = j < n ? input[j] : ''
    let closes: boolean
    if (next === '') closes = true
    else if (next === ':' || next === '}' || next === ']') closes = true
    else if (next === ',') {
      let k = j + 1
      while (k < n && (input[k] === ' ' || input[k] === '\t' || input[k] === '\r' || input[k] === '\n')) k += 1
      closes = k >= n || isValueStart(input[k])
    } else closes = false

    if (closes) {
      out += '"'
      inString = false
    } else {
      out += '\\"'
    }
  }
  return out
}
