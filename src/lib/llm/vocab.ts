// ── 단어 시험: 사진 채점 · 이름 판독 · 단어 PDF 파싱 · 예문 생성 ─────────────

import {
  buildVocabOcrClovaPrompt, buildVocabOcrVisionPrompt,
  buildVocabGradingPrompt, VOCAB_PDF_PROMPT,
  VocabOcrExampleItem, VocabOcrExpectedItem,
} from '../prompts'
import { reconstructClovaLayout, ClovaField } from '../clova-layout'
import { gradeBlankAnswer, gradeChoiceAnswer } from '../vocab-blank-grading'
import { buildFileBlock, callClaudeText, callClaudeTextDetailed, MODELS, parseJsonArrayResponse, parseJsonObjectResponse } from './client'

export type VocabGradingResult = {
  number: number
  english_word: string
  student_answer: string | null
  is_correct: boolean
}

// ── CLOVA OCR ────────────────────────────────────────────────────────────
// CLOVA OCR API 호출 → 줄 단위 텍스트 반환
// 환경변수 미설정 시 null 반환 → 호출부에서 Claude Vision fallback
async function callClovaOCR(fileData: string, mimeType: string): Promise<string | null> {
  const apiUrl = process.env.CLOVA_OCR_API_URL
  const secret = process.env.CLOVA_OCR_SECRET
  if (!apiUrl || !secret) return null

  const format = mimeType.includes('png') ? 'png'
    : mimeType.includes('gif') ? 'gif'
    : mimeType.includes('webp') ? 'webp'
    : mimeType === 'application/pdf' ? 'pdf'
    : 'jpeg'

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OCR-SECRET': secret,
    },
    body: JSON.stringify({
      version: 'V2',
      requestId: crypto.randomUUID(),
      timestamp: Date.now(),
      lang: 'ko',
      images: [{ format, name: 'vocab', data: fileData }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`CLOVA OCR API 오류: ${res.status} ${errText}`)
  }

  const data = await res.json()
  const fields: ClovaField[] = data.images?.[0]?.fields ?? []

  if (fields.length === 0) {
    const inferResult = data.images?.[0]?.inferResult
    throw new Error(`CLOVA OCR 결과 없음 (inferResult: ${inferResult})`)
  }

  return reconstructClovaLayout(fields, (msg) => console.log(msg))
}

export type GradeVocabPhotoOptions = {
  /** 번호 → 정답 (뜻쓰기·예문뜻: 한글 뜻 / 예문빈칸: 영어 표면형) */
  correctAnswers?: Map<number, string | null>
  customRules?: string
  /** 예문 파트 문항 (인쇄 원문). OCR 파서에 인쇄 텍스트를 알려주는 용도 — 정답은 포함하지 않는다 */
  exampleItems?: VocabOcrExampleItem[]
  /** 시험지에 인쇄된 전체 문항 목록 — 사진 일부가 안 보여도 목록이 끊기지 않게 하는 앵커 */
  expectedItems?: VocabOcrExpectedItem[]
}

export async function gradeVocabPhoto(
  fileData: string,
  mimeType: string,
  options: GradeVocabPhotoOptions = {},
): Promise<VocabGradingResult[]> {
  const { correctAnswers, customRules, exampleItems, expectedItems } = options
  const fileContent = buildFileBlock(fileData, mimeType, '지원하지 않는 파일 형식 (이미지 또는 PDF만 가능)')

  // ── Step 1: OCR ───────────────────────────────────────────────────────
  // CLOVA 설정 있으면 CLOVA, 없으면 Claude Vision fallback
  const t0 = Date.now()
  const clovaText = await callClovaOCR(fileData, mimeType)
  const tOcr = Date.now()

  type OcrItem = { number: number; english_word: string; student_answer: string | null }
  let ocrItems: OcrItem[]

  if (clovaText !== null) {
    // CLOVA OCR 성공 → Claude Vision으로 구조 파싱 + 동그라미 감지
    console.log(`[gradeVocabPhoto] CLOVA OCR 사용, 텍스트 길이: ${clovaText.length} (${tOcr - t0}ms)`)
    const parsed = await callClaudeTextDetailed({
      model: MODELS.parse,
      maxTokens: 8192,
      content: [fileContent, { type: 'text', text: buildVocabOcrClovaPrompt(clovaText, exampleItems, expectedItems) }],
    })
    // max_tokens 로 끊긴 배열은 jsonrepair 가 부분 복구해 조용히 문항이 사라진다 — 잘림은 실패로 처리
    if (parsed.stopReason === 'max_tokens') throw new Error('OCR 응답이 길이 제한에 잘렸습니다. 다시 시도해주세요.')
    console.log(`[gradeVocabPhoto] 구조 파싱 raw length: ${parsed.text.length} (${Date.now() - tOcr}ms)`)
    ocrItems = parseJsonArrayResponse<OcrItem>(parsed.text, 'gradeVocabPhoto:구조파싱')
  } else {
    // CLOVA 미설정 → Claude Vision으로 직접 OCR
    console.log('[gradeVocabPhoto] Claude Vision OCR fallback')
    const visionParsed = await callClaudeTextDetailed({
      model: MODELS.parse,
      maxTokens: 8192,
      content: [fileContent, { type: 'text', text: buildVocabOcrVisionPrompt(exampleItems, expectedItems) }],
    })
    if (visionParsed.stopReason === 'max_tokens') throw new Error('OCR 응답이 길이 제한에 잘렸습니다. 다시 시도해주세요.')
    console.log('[gradeVocabPhoto] OCR raw length:', visionParsed.text.length)
    ocrItems = parseJsonArrayResponse<OcrItem>(visionParsed.text, 'gradeVocabPhoto:OCR')
  }

  // ── Step 2: 채점 ─────────────────────────────────────────────────────
  const itemsWithAnswer: VocabItem[] = correctAnswers
    ? ocrItems.map((item) => ({ ...item, correct_answer: correctAnswers.get(item.number) ?? null }))
    : ocrItems

  // 예문빈칸(영→영)·예문선택(동그라미)은 영어 비교라 LLM 없이 코드로 결정적으로 채점한다.
  // 나머지(뜻쓰기·예문뜻쓰기)는 한글 뜻 판정이라 기존 LLM 채점 규칙을 그대로 쓴다.
  const kindByNumber = new Map((exampleItems ?? []).map((item) => [item.number, item.kind]))
  const codeGradedItems = itemsWithAnswer.filter((item) => {
    const kind = kindByNumber.get(item.number)
    return kind === 'blank' || kind === 'choice'
  })
  const meaningItems = itemsWithAnswer.filter((item) => !codeGradedItems.includes(item))

  const codeResults: VocabGradingResult[] = codeGradedItems.map((item) => ({
    number: item.number,
    english_word: item.english_word,
    student_answer: item.student_answer,
    is_correct: kindByNumber.get(item.number) === 'choice'
      ? gradeChoiceAnswer(item.student_answer, item.correct_answer ?? null)
      : gradeBlankAnswer(item.student_answer, item.correct_answer ?? null),
  }))
  const tGrade = Date.now()
  const meaningResults = meaningItems.length > 0 ? await gradeVocabItems(meaningItems, customRules) : []
  console.log(`[gradeVocabPhoto] 채점 완료: LLM ${meaningItems.length}개 + 코드 ${codeGradedItems.length}개 (${Date.now() - tGrade}ms) · 총 ${Date.now() - t0}ms`)
  return [...meaningResults, ...codeResults].sort((a, b) => a.number - b.number)
}

type VocabItem = { number: number; english_word: string; student_answer: string | null; correct_answer?: string | null }

/**
 * 단어 뜻 채점은 light(Haiku) 를 쓴다 (2026-08-18 전환).
 * 42개 경계 사례(다의어·유사어·품사·오타·-ing/-ed) 3회 비교: Sonnet 40/42 · Haiku 39/42, 시간 11.3s → 4.9s.
 * 유일한 차이는 오타 관용(가셜→가설)이 Haiku 가 약간 박한 것. 채점이 짜다는 불만이 생기면
 * 이 model 기본값만 MODELS.parse 로 바꾼다.
 */
export async function gradeVocabItems(items: VocabItem[], customRules?: string, model: string = MODELS.light): Promise<{ number: number; english_word: string; student_answer: string | null; is_correct: boolean }[]> {
  const res = await callClaudeTextDetailed({
    model,
    maxTokens: 8192,
    content: buildVocabGradingPrompt(items, customRules),
  })
  // 잘린 배열을 부분 복구하면 뒷번호 채점이 조용히 사라진다 — 실패로 처리
  if (res.stopReason === 'max_tokens') throw new Error('채점 응답이 길이 제한에 잘렸습니다. 다시 시도해주세요.')
  return parseJsonArrayResponse(res.text, 'gradeVocabItems')
}

// ── 단어 시험지 이름란 판독 (일괄 채점 매칭용) ─────────────────────────────

export type VocabSheetNameResult = {
  /** 후보 명단 중 매칭된 이름. 확신 없으면 null */
  name: string | null
  /** 이미지에서 읽은 그대로 (매칭 실패 시 강사가 참고) */
  rawName: string | null
  confidence: 'high' | 'low' | 'none'
}

/** 두 문자열이 한 글자 차이(치환/누락/추가) 이내인지 */
function withinOneChar(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) return [...a].filter((ch, i) => ch !== b[i]).length === 1
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  return s.slice(i) === l.slice(i + 1)
}

/**
 * 시험지 상단 "이름" 칸의 손글씨를 읽어 반 학생 명단 중 누구인지 고른다. Haiku Vision 한 번(1~2초).
 *
 * 명단은 **읽기 힌트로만** 준다 (한글 손글씨는 명단 없이 읽으면 오독이 잦음 — 김테스트→징혜스트).
 * 대신 모델에게 (1) 보이는 그대로(rawName) 와 (2) 명단 매칭(name) 을 따로 보고하게 하고,
 * 코드가 rawName↔name 이 한 글자 이내로 가까울 때만 인정한다. 멀면 "억지 매칭"으로 보고 버린다.
 * (명단만 주고 고르게 했더니 명단에 없는 이름도 가장 비슷한 학생에 붙이는 걸 확인함.
 *  잘못 매칭이 미매칭보다 훨씬 나쁘므로 확신 없으면 null — 강사가 확인 단계에서 직접 고른다.)
 */
export async function readVocabSheetName(fileData: string, mimeType: string, candidateNames: string[]): Promise<VocabSheetNameResult> {
  const fileContent = buildFileBlock(fileData, mimeType)

  const prompt = `이 시험지 상단 "이름" 칸에 손으로 쓴 학생 이름을 읽으세요.

1단계 — rawName: 보이는 글자를 **그대로** 옮기세요. 명단은 보지 말고 손글씨만 보고 읽으세요.
2단계 — name: 아래 명단 중 rawName 과 같은 이름이 있으면 그 이름. 같은 이름이 없으면 null.
        비슷하다고 억지로 고르지 마세요 — 없으면 null 이 정답입니다.

명단: ${candidateNames.join(', ')}

이름 칸이 비었거나 못 읽으면 둘 다 null.
JSON 만 출력: {"rawName": "홍길동", "name": "홍길동"} / {"rawName": "홍길둥", "name": null} / {"rawName": null, "name": null}`

  const raw = await callClaudeText({
    model: MODELS.light,
    maxTokens: 120,
    content: [fileContent, { type: 'text', text: prompt }],
  })
  let rawName: string | null = null
  let modelName: string | null = null
  try {
    const parsed = parseJsonObjectResponse<{ rawName?: unknown; name?: unknown }>(raw, 'readVocabSheetName')
    rawName = typeof parsed.rawName === 'string' && parsed.rawName.trim() ? parsed.rawName.trim() : null
    modelName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
  } catch {
    return { name: null, rawName: null, confidence: 'none' }
  }
  if (!rawName) return { name: null, rawName: null, confidence: 'none' }

  const norm = (s: string) => s.replace(/\s+/g, '')
  const target = norm(rawName)

  // 1) 코드 기준 정확 일치가 최우선
  const exact = candidateNames.find((c) => norm(c) === target)
  if (exact) return { name: exact, rawName, confidence: 'high' }

  // 2) 모델이 고른 이름이 명단에 있고 rawName 과 한 글자 이내면 low 로 제안
  if (modelName && candidateNames.includes(modelName) && withinOneChar(norm(modelName), target)) {
    return { name: modelName, rawName, confidence: 'low' }
  }

  // 3) 코드 기준 한 글자 차이 후보가 정확히 하나면 low 로 제안 (둘 이상이면 판단 불가 → none)
  const near = candidateNames.filter((c) => withinOneChar(norm(c), target))
  if (near.length === 1) return { name: near[0], rawName, confidence: 'low' }
  return { name: null, rawName, confidence: 'none' }
}

// ── 단어 PDF 파싱 ────────────────────────────────────────────────────────

export type VocabWordEnrichment = {
  number: number
  english_word: string
  correct_answer: string | null
  synonyms: string[]
  antonyms: string[]
}

export async function parseVocabPdf(fileData: string, mimeType: string): Promise<VocabWordEnrichment[]> {
  const raw = await callClaudeText({
    model: MODELS.parse,
    maxTokens: 4096,
    content: [buildFileBlock(fileData, mimeType), { type: 'text', text: VOCAB_PDF_PROMPT }],
  })
  return parseJsonArrayResponse<VocabWordEnrichment>(raw, 'parseVocabPdf')
}

// ── 단어 예문 생성 ───────────────────────────────────────────────────────

export async function generateVocabExamples(
  words: { id: string; english_word: string }[]
): Promise<{ id: string; sentence: string; translation: string; distractor: string | null }[]> {
  const wordList = words.map((w, i) => `${i}. ${w.english_word}`).join('\n')
  const raw = await callClaudeText({
    model: MODELS.light,
    maxTokens: 8000,
    content: `아래 단어들 각각에 대해 자연스러운 영어 예문 1개와 한국어 번역, 그리고 선택형 오답 후보 1개를 만들어줘.

distractor(오답 후보) 규칙 — 이게 시험 변별력을 정한다. 아래 둘 중 하나를 고른다:

  [A] 의미 대립형 (기본) — 정답과 **같은 품사**이고 그 자리에 넣어도 **문법은 성립**하지만
      **뜻이 달라 문맥에 안 맞는** 단어. 학생이 문장 뜻을 알아야 고를 수 있다.
      예: "The coach ___ the importance of practice." → emphasized(정답) / downplayed(오답)

  [B] 어형 변화형 — 정답과 **같은 어근의 다른 형태**(품사·태·분사 변화).
      그 자리에 넣으면 문법이 깨지고, 학생이 어형을 알아야 걸러낼 수 있다.
      예: impressive(정답) / impress(오답), successful / success, was found / found

  A 를 기본으로 하되, 어근에 뚜렷한 파생형이 있는 단어는 B 도 섞어 쓴다.

공통 금지:
- 유의어·거의 같은 뜻은 금지 (넣어도 말이 되면 정답이 둘이 된다).
- 어근도 품사도 의미도 무관한 단어 금지 — 읽지 않아도 걸러져 문항이 무의미해진다.
  (나쁜 예: "Let's [ take a break / impressive ] and grab coffee" — impressive 는 A 도 B 도 아니다)
- 출제 단어가 구(phrase)면 오답도 같은 형태의 구로 (예: "take a break" → "make a call").
- 예문에 이미 등장한 단어 금지. 적절한 후보가 없으면 null (억지로 만들지 말 것).

JSON 배열만 출력 (idx는 입력의 번호):
[{"idx":0,"sentence":"영어 예문","translation":"한국어 번역","distractor":"오답 후보 또는 null"}, ...]

${wordList}`,
  })
  const parsed = parseJsonArrayResponse<{ idx: number; sentence: string; translation: string; distractor?: string | null }>(raw, 'generateVocabExamples')
  return parsed
    .filter((p) => p.idx != null && p.sentence && p.translation && words[p.idx])
    .map((p) => {
      const candidate = (p.distractor ?? '').trim()
      const lower = candidate.toLowerCase()
      const word = words[p.idx].english_word.trim().toLowerCase()
      // 자기 자신·빈값·예문에 이미 있는 표현은 버린다 (답이 드러나거나 정답이 둘이 된다).
      // 부분 문자열까지 걸러 과하게 엄격하지만, 버려도 코드 규칙으로 폴백되므로 안전한 쪽으로 둔다.
      const usable = !!lower && lower !== word && !p.sentence.toLowerCase().includes(lower)
      return {
        id: words[p.idx].id,
        sentence: p.sentence,
        translation: p.translation,
        distractor: usable ? candidate : null,
      }
    })
}
