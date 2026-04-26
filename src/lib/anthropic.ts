import Anthropic from '@anthropic-ai/sdk'
import type { DocumentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { jsonrepair } from 'jsonrepair'
import {
  GRADING_SYSTEM, GRADING_RULES,
  PARSE_ANSWER_SHEET_RULES, SMS_RULES,
  buildVocabOcrClovaPrompt, VOCAB_OCR_VISION_PROMPT,
  buildVocabGradingPrompt, VOCAB_PDF_PROMPT,
  buildExamOcrClovaPrompt, buildExamOcrVisionPrompt,
  ExamOcrQuestion,
  EXAM_BANK_PARSE_RULES,
} from './prompts'
import type { ParsedExplanation } from './explanation-parser'

export type { ExamOcrQuestion }

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export type ExamOcrBatchInput = {
  fileData: string
  mimeType: string
  fileName?: string
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export type SubjectiveQuestion = {
  question_number: number
  sub_label: string | null
  correct_answer_text: string
  grading_criteria: string | null
  question_style?: 'subjective' | 'find_error'
}

export type SubjectiveStudentAnswer = {
  week_score_id: string
  exam_question_id: string
  question_number: number
  sub_label: string | null
  student_name: string
  student_answer_text: string
}

export type GradingResult = {
  week_score_id: string
  exam_question_id: string
  is_correct: boolean
  needs_review: boolean
  ai_feedback: string
}

// ── SMS 생성 ─────────────────────────────────────────────────────────────

export type SmsStudentInput = {
  student_name: string
  is_absent?: boolean
  is_unexamined?: boolean
  vocab: { correct: number; total: number; prev_correct: number | null }
  reading: {
    correct: number
    total: number
    wrong_objective: { question_number: number; concept_category: string; concept_tag: string | null }[]
    wrong_subjective: { question_number: number; concept_category: string; ai_feedback: string }[]
  }
  homework: { done: number; total: number }
  teacher_memo: string | null
  share_url: string
}

export type SmsResult = {
  student_name: string
  message: string
}

export async function generateSmsMessages(
  weekInfo: { week_number: number; class_name: string; start_date?: string | null },
  students: SmsStudentInput[],
  customPrompt?: string
): Promise<SmsResult[]> {
  if (students.length === 0) return []

  const dateLabel = weekInfo.start_date
    ? ` (${new Date(weekInfo.start_date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })})`
    : ''

  const prompt = `당신은 영어 학원 선생님입니다. 학생별 주간 성적 데이터를 보고 학부모에게 보낼 문자를 작성하세요.

[${weekInfo.class_name} ${weekInfo.week_number}주차${dateLabel}]

학생 데이터:
${students.map((s) => {
  const vocabChange = s.vocab.prev_correct !== null
    ? ` (지난주 대비 ${s.vocab.correct - s.vocab.prev_correct >= 0 ? '+' : ''}${s.vocab.correct - s.vocab.prev_correct}개)`
    : ''
  const wrongItems = [
    ...s.reading.wrong_objective.map((w) => `${w.question_number}번 ${w.concept_tag ?? w.concept_category}`),
    ...s.reading.wrong_subjective.map((w) => `${w.question_number}번 ${w.ai_feedback || w.concept_category}`),
  ]
  if (s.is_absent) {
    return `---
학생: ${s.student_name}
결석: 예
링크: ${s.share_url}`
  }
  if (s.is_unexamined) {
    return `---
학생: ${s.student_name}
미응시: 예 (출석했으나 시험 미응시)
링크: ${s.share_url}`
  }
  return `---
학생: ${s.student_name}
단어: ${s.vocab.correct}/${s.vocab.total}${vocabChange}
독해/진단: ${s.reading.correct}/${s.reading.total}${wrongItems.length > 0 ? ` | 틀린문항: ${wrongItems.slice(0, 3).join(', ')}` : ''}
과제: ${s.homework.total > 0 ? `${s.homework.done}/${s.homework.total}` : '완료'}
메모: ${s.teacher_memo ?? '없음'}
링크: ${s.share_url}`
}).join('\n')}

${customPrompt ?? SMS_RULES}

JSON 배열만 출력 (다른 텍스트 없이):
[{"student_name": "이름", "message": "문자내용"}]`

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  let parsed: SmsResult[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  }
  return parsed
}

// ── 해설지 파싱 ──────────────────────────────────────────────────────────

export type ParsedAnswer = {
  question_number: number
  sub_label: string | null            // 소문항 레이블 (예: 'a', 'b'), 없으면 null
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select' | 'find_error'
  question_type: string | null        // 문제 유형명 (예: "빈칸", "순서", "글의 목적 파악")
  correct_answer: number          // 객관식: 1-5, 서술형: 0
  correct_answer_text: string | null  // 서술형 모범답안
  grading_criteria: string | null     // 서술형 채점 기준
  explanation: string | null          // 오답 해설 (SMS 활용)
  question_text: string | null        // 문제 지문/문항 내용 (해설지에 있는 경우)
}

export type TagCategory = { categoryName: string; tags: string[] }

export async function parseAnswerSheet(
  fileData: string,  // base64
  mimeType: string,  // image/jpeg, image/png, application/pdf 등
  tagCategories: TagCategory[] = [],
): Promise<ParsedAnswer[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'

  const fileContent = isImage
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }

  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식입니다 (PDF 또는 이미지만 가능)')

  const tagListSection = tagCategories.length > 0
    ? `
━━━ question_type 매핑 규칙 (반드시 준수) ━━━
아래 목록에서 각 문항에 가장 적합한 유형을 정확히 그대로 선택하세요:
${tagCategories.map((c) => `[${c.categoryName}]: ${c.tags.join(', ')}`).join('\n')}

매핑 판단 기준:
- 해설지에 적힌 유형명이 아니라, 해당 문항이 실제로 테스트하는 문법/개념이 무엇인지를 기준으로 고를 것
- 예: 해설지에 "어법" 이라고 적혀 있어도, 실제로 가정법을 묻고 있으면 "가정법" 으로 매핑

우선순위 (반드시 준수):
1. explanation 또는 grading_criteria에서 특정 문법 개념이 명시된 경우 → 문법 유형 태그를 최우선으로 선택
   예: 빈칸 형식이어도 "수동태를 쓸 수 없다"는 설명이 있으면 → "수동태"
   예: 빈칸 형식이어도 "every + 단수명사는 단수 취급"이면 → "수의 일치"
2. 특정 문법 개념이 식별되지 않는 경우에만 서술형 유형(빈칸, 영작 등) 선택
   즉, "빈칸", "영작" 등 형식 태그는 문법 개념으로 분류 불가능할 때 최후 수단으로만 사용

- 소문항(a, b, c...)은 부모 문항의 유형을 그대로 쓰지 말고, 각 소문항이 테스트하는 구체적인 문법 포인트를 개별적으로 분석해서 가장 가까운 태그를 선택할 것
  예: 8번이 "어법" 이어도 → 8(a)는 "관계사", 8(b)는 "가정법", 8(c)는 "도치" 로 각각 다르게 매핑 가능
- 목록에 딱 맞는 게 없으면 의미상 가장 가까운 것 선택. 그래도 없으면 null.
- question_type은 반드시 위 목록 중 하나를 정확히 그대로 입력할 것 (목록에 없는 새 유형 생성 금지)
`
    : '\n- question_type: 해설지에 명시된 문제 유형명 한국어 추출. 없으면 null.\n'

  const prompt = `이 답안해설지에서 각 문항의 정답과 해설을 추출하세요.

${PARSE_ANSWER_SHEET_RULES}
${tagListSection}

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number":1,"sub_label":null,"question_style":"objective","question_type":"가정법/조동사","correct_answer":3,"correct_answer_text":null,"grading_criteria":null,"explanation":"...","question_text":"다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?\\nThe researcher concluded that the results were inconclusive. ________ further investigation was needed before any definitive claims could be made about the phenomenon."},{"question_number":2,"sub_label":null,"question_style":"multi_select","question_type":"내용 일치","correct_answer":0,"correct_answer_text":"1,3","grading_criteria":null,"explanation":"...","question_text":"윗글의 내용과 일치하는 것을 모두 고르시오.\\nJohn was born in London in 1990. He studied engineering at university and later moved to Seoul for work."},{"question_number":5,"sub_label":"a","question_style":"ox","question_type":"대명사","correct_answer":0,"correct_answer_text":"X (their)","grading_criteria":null,"explanation":"...","question_text":"다음 문장에서 어법상 틀린 것을 고르시오.\\nEach of the students raised their hand."},{"question_number":5,"sub_label":"b","question_style":"ox","question_type":"수의 일치","correct_answer":0,"correct_answer_text":"O","grading_criteria":null,"explanation":"...","question_text":"다음 문장의 어법이 올바른지 판단하시오.\\nThe committee has made its decision."}]`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [fileContent, { type: 'text', text: prompt }],
    }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parseAnswerSheet] raw response:', raw)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  let parsed: ParsedAnswer[]
  try {
    parsed = JSON.parse(jsonrepair(cleaned))
  } catch (e) {
    console.error('[parseAnswerSheet] jsonrepair 실패:', e)
    throw e
  }

  console.log('[parseAnswerSheet] parsed count:', parsed.length, '| question_numbers:', parsed.map(p => `${p.question_number}${p.sub_label ? p.sub_label : ''}`).join(', '))
  return parsed
}

// ── 단어 사진 채점 ────────────────────────────────────────────────────────

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
  type Vertex = { x: number; y: number }
  type ClovaField = {
    inferText: string
    lineBreak: boolean
    boundingPoly?: { vertices: Vertex[] }
  }
  const fields: ClovaField[] = data.images?.[0]?.fields ?? []

  if (fields.length === 0) {
    const inferResult = data.images?.[0]?.inferResult
    throw new Error(`CLOVA OCR 결과 없음 (inferResult: ${inferResult})`)
  }

  // boundingPoly 없는 필드가 섞여 있으면 좌표 기반 재구성 포기 → 기존 방식
  const hasCoords = fields.every((f) => f.boundingPoly?.vertices && f.boundingPoly.vertices.length >= 4)
  if (!hasCoords) {
    const lines: string[] = []
    let buf: string[] = []
    for (const field of fields) {
      buf.push(field.inferText)
      if (field.lineBreak) {
        lines.push(buf.join(' '))
        buf = []
      }
    }
    if (buf.length > 0) lines.push(buf.join(' '))
    return lines.join('\n')
  }

  // ── 각 필드에 중심 좌표/크기 부여 ──────────────────────────────────────
  type Tok = { text: string; cx: number; cy: number; xMin: number; xMax: number; h: number }
  const toks: Tok[] = fields.map((f) => {
    const vs = f.boundingPoly!.vertices
    const xs = vs.map((v) => v.x ?? 0)
    const ys = vs.map((v) => v.y ?? 0)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    return {
      text: f.inferText,
      cx: (xMin + xMax) / 2,
      cy: (yMin + yMax) / 2,
      xMin,
      xMax,
      h: yMax - yMin,
    }
  })

  // ── 2단 레이아웃 감지 ────────────────────────────────────────────────
  // cx 분포에서 정렬 후 연속된 두 cx 사이의 최대 gap을 찾는다.
  // gap이 전체 x-range의 12% 이상이고, 그 gap 중점이 전체 x-range의 30~70% 구간에 있으면 2단으로 판단.
  const sortedCx = [...toks.map((t) => t.cx)].sort((a, b) => a - b)
  const xMinAll = sortedCx[0]
  const xMaxAll = sortedCx[sortedCx.length - 1]
  const xRange = xMaxAll - xMinAll
  let bestGap = 0
  let bestGapMid = 0
  for (let i = 1; i < sortedCx.length; i++) {
    const g = sortedCx[i] - sortedCx[i - 1]
    if (g > bestGap) {
      bestGap = g
      bestGapMid = (sortedCx[i] + sortedCx[i - 1]) / 2
    }
  }
  const gapRatio = xRange > 0 ? bestGap / xRange : 0
  const gapPos = xRange > 0 ? (bestGapMid - xMinAll) / xRange : 0
  const isTwoColumn = gapRatio >= 0.12 && gapPos >= 0.3 && gapPos <= 0.7

  // ── 라인 그룹핑 (컬럼별) ─────────────────────────────────────────────
  // 같은 y ± (line height * 0.6) 안이면 같은 라인.
  const medianH = (() => {
    const hs = [...toks.map((t) => t.h)].sort((a, b) => a - b)
    return hs[Math.floor(hs.length / 2)] || 20
  })()
  const yTol = Math.max(medianH * 0.6, 8)

  function groupIntoLines(list: Tok[]): string[] {
    if (list.length === 0) return []
    // cy로 정렬
    const sorted = [...list].sort((a, b) => a.cy - b.cy)
    const lineBuckets: Tok[][] = []
    for (const t of sorted) {
      const last = lineBuckets[lineBuckets.length - 1]
      if (last && Math.abs(t.cy - last[last.length - 1].cy) <= yTol) {
        last.push(t)
      } else {
        lineBuckets.push([t])
      }
    }
    // 각 라인 내부 x순 정렬 후 텍스트 조립
    return lineBuckets.map((bucket) => bucket.sort((a, b) => a.cx - b.cx).map((t) => t.text).join(' '))
  }

  if (!isTwoColumn) {
    const lines = groupIntoLines(toks)
    console.log(`[CLOVA] 1단 레이아웃 감지 (gap=${gapRatio.toFixed(2)}, pos=${gapPos.toFixed(2)}), 라인 ${lines.length}개`)
    return lines.join('\n')
  }

  // 2단: gap 중점 기준으로 좌/우 분할
  const splitX = bestGapMid
  const leftToks = toks.filter((t) => t.cx < splitX)
  const rightToks = toks.filter((t) => t.cx >= splitX)
  const leftLines = groupIntoLines(leftToks)
  const rightLines = groupIntoLines(rightToks)
  console.log(`[CLOVA] 2단 레이아웃 감지 (gap=${gapRatio.toFixed(2)}, pos=${gapPos.toFixed(2)}), 좌 ${leftLines.length}줄 / 우 ${rightLines.length}줄`)

  return [
    '━━━ LEFT COLUMN ━━━',
    ...leftLines,
    '━━━ RIGHT COLUMN ━━━',
    ...rightLines,
  ].join('\n')
}

export async function gradeVocabPhoto(
  fileData: string,
  mimeType: string,
  correctAnswers?: Map<number, string | null>,
  customRules?: string,
): Promise<VocabGradingResult[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식 (이미지 또는 PDF만 가능)')

  const fileContent = isImage
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }

  // ── Step 1: OCR ───────────────────────────────────────────────────────
  // CLOVA 설정 있으면 CLOVA, 없으면 Claude Vision fallback
  const clovaText = await callClovaOCR(fileData, mimeType)

  type OcrItem = { number: number; english_word: string; student_answer: string | null }
  let ocrItems: OcrItem[]

  if (clovaText !== null) {
    // CLOVA OCR 성공 → Claude Vision으로 구조 파싱 + 동그라미 감지
    console.log('[gradeVocabPhoto] CLOVA OCR 사용, 텍스트 길이:', clovaText.length)
    const parsePrompt = buildVocabOcrClovaPrompt(clovaText)

    const parseRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [fileContent, { type: 'text', text: parsePrompt }] }],
    })
    const parseRaw = parseRes.content[0].type === 'text' ? parseRes.content[0].text : ''
    console.log('[gradeVocabPhoto] 구조 파싱 raw length:', parseRaw.length)
    try {
      ocrItems = JSON.parse(jsonrepair(parseRaw.replace(/```json\n?|\n?```/g, '').trim()))
    } catch (e) {
      console.error('[gradeVocabPhoto] 구조 파싱 JSON parse 실패:', e)
      throw e
    }
  } else {
    // CLOVA 미설정 → Claude Vision으로 직접 OCR
    console.log('[gradeVocabPhoto] Claude Vision OCR fallback')
    const ocrPrompt = VOCAB_OCR_VISION_PROMPT

    const ocrRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: [fileContent, { type: 'text', text: ocrPrompt }] }],
    })
    const ocrRaw = ocrRes.content[0].type === 'text' ? ocrRes.content[0].text : ''
    console.log('[gradeVocabPhoto] OCR raw length:', ocrRaw.length)
    try {
      ocrItems = JSON.parse(jsonrepair(ocrRaw.replace(/```json\n?|\n?```/g, '').trim()))
    } catch (e) {
      console.error('[gradeVocabPhoto] OCR JSON parse 실패:', e)
      throw e
    }
  }

  // ── Step 2: 채점 ─────────────────────────────────────────────────────
  const itemsWithAnswer = correctAnswers
    ? ocrItems.map((item) => ({ ...item, correct_answer: correctAnswers.get(item.number) ?? null }))
    : ocrItems
  return await gradeVocabItems(itemsWithAnswer, customRules)
}

type VocabItem = { number: number; english_word: string; student_answer: string | null; correct_answer?: string | null }

export async function gradeVocabItems(items: VocabItem[], customRules?: string): Promise<{ number: number; english_word: string; student_answer: string | null; is_correct: boolean }[]> {
  const gradingPrompt = buildVocabGradingPrompt(items, customRules)

  const gradingRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: gradingPrompt }],
  })

  const gradingRaw = gradingRes.content[0].type === 'text' ? gradingRes.content[0].text : ''

  try {
    return JSON.parse(jsonrepair(gradingRaw.replace(/```json\n?|\n?```/g, '').trim()))
  } catch (e) {
    console.error('[gradeVocabItems] JSON parse 실패:', e)
    throw e
  }
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
  const fileContent = mimeType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }

  const prompt = VOCAB_PDF_PROMPT

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  try {
    return JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim()))
  } catch (e) {
    console.error('[parseVocabPdf] JSON parse 실패:', e)
    throw e
  }
}

// ── 단어 예문 생성 ───────────────────────────────────────────────────────

export async function generateVocabExamples(
  words: { id: string; english_word: string }[]
): Promise<{ id: string; sentence: string; translation: string }[]> {
  const wordList = words.map((w, i) => `${i}. ${w.english_word}`).join('\n')
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `아래 단어들 각각에 대해 자연스러운 영어 예문 1개와 한국어 번역을 만들어줘.\nJSON 배열만 출력 (idx는 입력의 번호): [{"idx":0,"sentence":"영어 예문","translation":"한국어 번역"}, ...]\n\n${wordList}`,
    }],
  })
  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const parsed = JSON.parse(jsonrepair(cleaned)) as { idx: number; sentence: string; translation: string }[]
  return parsed
    .filter((p) => p.idx != null && p.sentence && p.translation && words[p.idx])
    .map((p) => ({ id: words[p.idx].id, sentence: p.sentence, translation: p.translation }))
}

// ── 서술형 채점 ──────────────────────────────────────────────────────────

// 이 이하면 단일 호출 (전 문항·전 학생 한 번에 → 일관성 최대, 비용 최소)
// 초과하면 문항별 분할 (같은 문항 학생끼리 비교 채점 → 문항 내 일관성 유지)
const SINGLE_CALL_THRESHOLD = 30

// 단일 배치 채점 (내부 전용)
async function gradeSingleBatch(
  questions: SubjectiveQuestion[],
  answers: SubjectiveStudentAnswer[]
): Promise<GradingResult[]> {
  const qLabel = (q: { question_number: number; sub_label: string | null }) =>
    `${q.question_number}번${q.sub_label ? ` (${q.sub_label})` : ''}`

  const hasFindError = questions.some((q) => q.question_style === 'find_error')
  const findErrorRules = hasFindError ? `
━━━ find_error(기호 찾아 고치기) 유형 특별 규칙 ━━━
아래 [find_error] 표시된 문항에만 적용.

1. 모범답안 형식: "번호:수정내용" (예: "1:If human gene editing turns out to be both safe and effective")
   · 번호 = 지문의 ①~⑤ 중 틀린 문장의 기호
   · 수정내용 = 그 문장의 올바른 형태

2. 학생이 쓸 수 있는 형식 (모두 허용):
   (A) "①: turns out" 또는 "1: turns out"
   (B) "① If human gene editing turns out..." (기호 + 전체 문장)
   (C) "turns out" (수정어만, 기호 없음)
   (D) "is turned out → turns out" (before → after)
   (E) "①" 또는 "1" (기호만, 수정 없음) → 오답

3. 같은 question_number 안의 서로 다른 sub_label 답안은 **순서 무관 집합 매칭**:
   · 학생의 17(a)가 모범답안 ⑤와, 17(b)가 모범답안 ①과 매칭되어도 정답 가능
   · 단, 하나의 모범답안은 한 학생 답안에만 매칭 (중복 금지)

4. 매칭 판단 순서:
   · 학생이 기호를 썼으면 → 기호가 모범답안 번호와 일치해야 매칭
     기호 다르면 무조건 오답, feedback: "①번이 정답"
   · 기호 없으면 → 수정어 의미로 매칭 시도
   · 매칭된 후 correction 의미 비교:
     예) 모범답안 "1:turns out" →
       "turns out" / "is turned out → turns out" / "① turns out" / "① If human gene editing turns out to be both safe and effective" 모두 정답
       "was turned out" / "turn out" (시제·수 일치 어긋남) → 오답

5. 오답 feedback 한국어 20자 이내, 구체적으로:
   · "①번이 정답 (②번 선택)"
   · "turns out으로 수정 필요"
   · 빈칸이면 빈 문자열
` : ''

  const prompt = `${GRADING_SYSTEM}
${findErrorRules}
## 문제 정보
${questions.map((q) => `
[${qLabel(q)}]${q.question_style === 'find_error' ? ' [find_error]' : ''}
모범답안: ${q.correct_answer_text}
채점 기준: ${q.grading_criteria ?? '모범답안과 의미 및 문법이 일치하는지 확인'}
`).join('')}

## 학생 답안
${answers.map((a, i) => `
[${i}] 학생: ${a.student_name} / 문항: ${qLabel(a)}
답안: ${a.student_answer_text}
`).join('')}

## 출력 형식 (JSON 배열만 출력, 다른 텍스트 없이)
[
  {
    "idx": 위 답안의 [숫자],
    "is_correct": true 또는 false,
    "confidence": "high" 또는 "low",
    "feedback": "틀린 경우 구체적 이유 (20자 이내), 맞으면 빈 문자열"
  }
]

${GRADING_RULES}`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''

  let parsed: { idx: number; is_correct: boolean; confidence?: string; feedback: string }[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  }

  return parsed
    .map((r) => {
      const original = answers[r.idx]
      if (!original) return null
      return {
        week_score_id: original.week_score_id,
        exam_question_id: original.exam_question_id,
        is_correct: r.is_correct,
        needs_review: r.confidence === 'low',
        ai_feedback: r.feedback ?? '',
      }
    })
    .filter((r): r is GradingResult => r !== null)
}

// 공개 API — 적응형 배치 분할 + 부분 실패 허용
// ≤ 30개: 단일 호출 (전 문항·전 학생 → 비용 최소, 교차 비교로 일관성 최대)
// > 30개: 문항별 분할 (같은 문항 학생끼리 한 호출 → 문항 내 일관성 유지, 출력 잘림 방지)
export async function gradeSubjectiveAnswers(
  questions: SubjectiveQuestion[],
  answers: SubjectiveStudentAnswer[]
): Promise<GradingResult[]> {
  if (answers.length === 0) return []

  type Batch = { questions: SubjectiveQuestion[]; answers: SubjectiveStudentAnswer[] }
  const batches: Batch[] = []

  if (answers.length <= SINGLE_CALL_THRESHOLD) {
    // 소규모 — 단일 호출
    batches.push({ questions, answers })
  } else {
    // 대규모 — question_number 기준 분할 (같은 번호의 sub_label a,b,c는 한 배치로 묶음)
    const byQNum = new Map<number, { questions: SubjectiveQuestion[]; answers: SubjectiveStudentAnswer[] }>()
    for (const q of questions) {
      const entry = byQNum.get(q.question_number) ?? { questions: [], answers: [] }
      entry.questions.push(q)
      byQNum.set(q.question_number, entry)
    }
    for (const a of answers) {
      const entry = byQNum.get(a.question_number)
      if (entry) entry.answers.push(a)
    }
    for (const entry of byQNum.values()) {
      if (entry.answers.length > 0) {
        batches.push(entry)
      }
    }
  }

  console.log(`[gradeSubjectiveAnswers] ${answers.length}개 답안 → ${batches.length}개 배치 (threshold=${SINGLE_CALL_THRESHOLD})`)

  // 배치 병렬 처리 (부분 실패 허용)
  const settled = await Promise.allSettled(
    batches.map((b) => gradeSingleBatch(b.questions, b.answers))
  )

  const allResults: GradingResult[] = []
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      allResults.push(...result.value)
    } else {
      // 배치 실패 → needs_review 로 표시 (나머지 배치는 정상 반영)
      console.error(`[gradeSubjectiveAnswers] 배치 ${i} 실패:`, result.reason)
      for (const a of batches[i].answers) {
        allResults.push({
          week_score_id: a.week_score_id,
          exam_question_id: a.exam_question_id,
          is_correct: false,
          needs_review: true,
          ai_feedback: 'AI 채점 실패 — 수동 확인 필요',
        })
      }
    }
  }

  return allResults
}

// ── 기출문제 은행 파싱 ────────────────────────────────────────────────────

export type ExamBankParsedQuestion = {
  question_number: number
  question_type: string
  passage: string
  question_text: string
  choices: string[]
  answer: string
}

export type WeekProblemSheetQuestion = {
  question_number: number
  question_type: string | null
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select'
  passage: string
  question_text: string
  choices: string[]
}

export type ProblemSheetAnswerKeyItem = {
  question_number: number
  question_style: 'objective' | 'subjective' | 'ox' | 'multi_select'
  correct_answer: number
  correct_answer_text: string | null
}

const WEEK_PROBLEM_SHEET_PARSE_RULES = `이 PDF는 주차별 설정의 '중간·기말 전용 가져오기'에 업로드하는 영어 시험지입니다.
이 형식은 보통 상단에 문제, 하단에 정답표가 따로 모여 있습니다.
지금 단계에서는 문제 영역만 읽어서 문항 구조만 추출하세요. 하단 정답표는 무시하세요.

출력 필드:
- question_number: 문항 번호
- question_type: 해설이 없어 확실하지 않으면 null
- question_style: objective | subjective | ox | multi_select
- passage: 지문이 있으면 전체, 없으면 ""
- question_text: 발문 + 보기문장 + 서답형 지시문까지 포함
- choices: 객관식 보기 배열, 없으면 []

판단 규칙:
- 1개 정답 객관식은 objective
- O/X 판단은 ox
- 여러 개를 모두 고르는 형식은 multi_select
- 서답형, 영작형, 빈칸 완성형 텍스트 답안은 subjective

중요:
- 문항은 파일에 보이는 순서대로 배열에 담으세요
- 하단 정답표나 해설표는 문항으로 오인하지 마세요
- 정답은 생성하지 마세요
- 문항을 건너뛰지 마세요
- JSON 배열만 출력하세요`

function buildWeekProblemSheetAnswerPrompt(
  rawText: string,
  questions: WeekProblemSheetQuestion[],
): string {
  return `다음은 영어 시험지 PDF에서 추출한 원문 텍스트입니다.
이 문서는 상단에 문제, 하단에 정답표가 따로 있는 형식입니다.
하단 정답표 영역만 읽어서 각 문항의 정답만 구조화하세요.

원문 텍스트:
${rawText}

문항 목록:
${questions.map((q) => `- ${q.question_number}번 (${q.question_style})${q.choices.length ? ` 보기 ${q.choices.length}개` : ''}`).join('\n')}

출력 필드:
- question_number: 문항 번호
- question_style: objective | subjective | ox | multi_select
- correct_answer: objective면 1~5, 아니면 0
- correct_answer_text:
  * objective면 null
  * ox면 "O" 또는 "X (...)"
  * multi_select면 "1,3" 같은 형식
  * subjective면 정답 텍스트

중요 규칙:
- 상단 문제 본문에 나온 숫자나 선지는 무시하고, 하단 정답표에 적힌 정답만 사용하세요
- 위 문항 목록에 있는 번호만 출력하세요
- 정답이 불명확한 문항은 제외하세요
- objective는 correct_answer에 숫자를 넣고 correct_answer_text는 null로 두세요
- subjective는 correct_answer를 0으로 두고 correct_answer_text에 정답 텍스트를 넣으세요
- JSON 배열만 출력하세요`
}

export async function parseWeekProblemSheetPage(
  fileData: string,
  mimeType: string,
): Promise<WeekProblemSheetQuestion[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.')

  const fileContent = isImage
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [fileContent, { type: 'text', text: WEEK_PROBLEM_SHEET_PARSE_RULES }],
    }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parseWeekProblemSheetPage] raw response length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  try {
    const parsed = JSON.parse(jsonrepair(cleaned)) as WeekProblemSheetQuestion[]
    console.log('[parseWeekProblemSheetPage] parsed count:', parsed.length, '| questions:', parsed.map((p) => p.question_number).join(', '))
    return parsed
  } catch (e) {
    console.error('[parseWeekProblemSheetPage] JSON parse 실패:', e)
    throw e
  }
}

export async function parseProblemSheetAnswerKey(
  rawText: string,
  questions: WeekProblemSheetQuestion[],
): Promise<ProblemSheetAnswerKeyItem[]> {
  const prompt = buildWeekProblemSheetAnswerPrompt(rawText, questions)
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parseProblemSheetAnswerKey] raw response length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  try {
    const parsed = JSON.parse(jsonrepair(cleaned)) as ProblemSheetAnswerKeyItem[]
    console.log('[parseProblemSheetAnswerKey] parsed count:', parsed.length, '| questions:', parsed.map((p) => p.question_number).join(', '))
    return parsed
  } catch (e) {
    console.error('[parseProblemSheetAnswerKey] JSON parse 실패:', e)
    throw e
  }
}

export async function parseExamBankPage(
  fileData: string,
  mimeType: string,
): Promise<ExamBankParsedQuestion[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식 (PDF 또는 이미지만 가능)')

  const fileContent = isImage
    ? { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }
    : { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: fileData } }

  const stream = await anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 32768,
    messages: [{
      role: 'user',
      content: [fileContent, { type: 'text', text: EXAM_BANK_PARSE_RULES }],
    }],
  })
  const res = await stream.finalMessage()

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parseExamBankPage] raw response length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  let parsed: ExamBankParsedQuestion[]
  try {
    parsed = JSON.parse(jsonrepair(cleaned))
  } catch (e) {
    console.error('[parseExamBankPage] JSON parse 실패:', e)
    throw e
  }

  console.log('[parseExamBankPage] parsed count:', parsed.length, '| questions:', parsed.map(p => p.question_number).join(', '))
  return parsed
}

// ── 시험 답안지 OCR ───────────────────────────────────────────────────────

export async function ocrExamAnswers(
  fileData: string,
  mimeType: string,
  questions: ExamOcrQuestion[],
): Promise<ExamOcrResult[]> {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  if (!isImage && !isPdf) throw new Error('지원하지 않는 파일 형식입니다. PDF 또는 이미지만 업로드해주세요.')

  const fileContent = isImage
    ? {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: fileData,
        },
      }
    : {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: fileData,
        },
      }

  console.log('[ocrExamAnswers] Claude Vision OCR 사용')
  const prompt = buildExamOcrVisionPrompt(questions)
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }],
  })
  const raw = res.content[0].type === 'text' ? res.content[0].text : ''

  try {
    return JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim()))
  } catch (e) {
    console.error('[ocrExamAnswers] JSON parse 실패:', e)
    throw e
  }
}

async function splitPdfToSinglePageBase64(fileData: string): Promise<string[]> {
  const { PDFDocument } = await import('pdf-lib')
  const srcDoc = await PDFDocument.load(Buffer.from(fileData, 'base64'))
  const pageDocs: string[] = []

  for (let i = 0; i < srcDoc.getPageCount(); i += 1) {
    const pageDoc = await PDFDocument.create()
    const [copiedPage] = await pageDoc.copyPages(srcDoc, [i])
    pageDoc.addPage(copiedPage)
    const pageBytes = await pageDoc.save()
    pageDocs.push(Buffer.from(pageBytes).toString('base64'))
  }

  return pageDocs
}

function getExamOcrResultKey(result: ExamOcrResult): string {
  return `${result.question_number}|${result.sub_label ?? ''}`
}

function scoreExamOcrResult(result: ExamOcrResult): number {
  if (typeof result.student_answer === 'number') return 100
  const text = result.student_answer_text?.trim() ?? ''
  if (!text) return 0
  return Math.min(text.length, 80)
}

function mergeExamOcrResults(results: ExamOcrResult[][]): ExamOcrResult[] {
  const merged = new Map<string, ExamOcrResult>()

  for (const pageResults of results) {
    for (const result of pageResults) {
      const key = getExamOcrResultKey(result)
      const current = merged.get(key)
      if (!current || scoreExamOcrResult(result) > scoreExamOcrResult(current)) {
        merged.set(key, result)
      }
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (a.question_number !== b.question_number) return a.question_number - b.question_number
    return (a.sub_label ?? '').localeCompare(b.sub_label ?? '')
  })
}

export async function ocrExamAnswerBatch(
  files: ExamOcrBatchInput[],
  questions: ExamOcrQuestion[],
): Promise<{ results: ExamOcrResult[]; pagesProcessed: number }> {
  const pageResults: ExamOcrResult[][] = []
  let pagesProcessed = 0

  for (const file of files) {
    if (file.mimeType === 'application/pdf') {
      const pages = await splitPdfToSinglePageBase64(file.fileData)
      for (const page of pages) {
        pageResults.push(await ocrExamAnswers(page, 'application/pdf', questions))
        pagesProcessed += 1
      }
      continue
    }

    pageResults.push(await ocrExamAnswers(file.fileData, file.mimeType, questions))
    pagesProcessed += 1
  }

  return {
    results: mergeExamOcrResults(pageResults),
    pagesProcessed,
  }
}

// ── 기출문제 AI 해설 생성 ─────────────────────────────────────────────────
// 대상: 20~24번, 29~42번 문항
// 생성 필드: explanation_translation (해석), explanation_vocabulary (Words & Phrases)

export type GeneratedExplanation = {
  question_number: number
  intent: string        // 출제의도 (한 문장, ~한다. 형태)
  translation: string   // 해석 (지문 전체 한국어 번역)
  solution: string      // 풀이 (정답 근거 + 오답 포인트)
  vocabulary: string    // Words & Phrases (고2~3 수준, 지문 등장 순서)
}

export type QuestionForExplanation = {
  question_number: number
  passage: string
  question_text: string
  choices: string[]
  answer: string
}

export async function generateExplanations(
  questions: QuestionForExplanation[],
  mode: 'standard' | 'full' = 'standard',
): Promise<GeneratedExplanation[]> {
  if (questions.length === 0) return []

  const solutionGuide = mode === 'full'
    ? `- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
   - 오답 포인트: 주요 오답 선지가 왜 틀렸는지 구체적으로 설명
   - 핵심 어구/구문: 지문의 중요 표현이나 논리 흐름을 추가 설명
   - 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로 작성
   - 4~6문장으로 충분히 상세하게`
    : `- 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
   - 오답 포인트: 헷갈리기 쉬운 오답 선지가 왜 틀렸는지 간결하게 설명 (1~2개)
   - 단순 "정답은 ~이다" 수준이 아니라, 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로 작성
   - 2~4문장 이내로 간결하게`

  const prompt = `다음 수능/모의고사 영어 문항들의 해설을 생성하세요.

각 문항에 대해 아래 네 가지를 작성하세요:

1. intent (출제의도)
   - 이 문항이 측정하는 능력을 한 문장으로 서술
   - 반드시 "~한다." 형태로 끝낼 것
   - 예: "글의 목적을 추론한다."  "빈칸에 들어갈 내용을 추론한다."  "어법에 맞는 표현을 판단한다."

2. translation (해석)
   - 지문 전체를 자연스러운 한국어로 번역
   - 원문 단락 구조(줄바꿈)를 그대로 유지
   - 도표·실용문 등 번역이 불필요한 경우 ""

3. solution (풀이)
   ${solutionGuide}

4. vocabulary (Words & Phrases)
   - 지문에 등장하는 고2~고3 수준의 학습 중요 단어/숙어만 선별
   - 등장 순서대로 나열
   - 형식: "단어 뜻" (예: "eliminate 제거하다   gradual 점진적인   be prone to ~하기 쉽다")
   - 선별 기준:
     * 포함: 수능/모의고사 빈출 어휘, 고2~3 교과 수준 단어
     * 제외: the, is, have, said 등 기초 어휘
     * 제외: obscure, ostensible 등 최상위 어휘 (고3 수준 초과)
   - 한 줄에 모두 나열 (줄바꿈 없이), 단어 사이 3칸 띄어쓰기

문항 데이터:
${questions.map((q) => `
[${q.question_number}번]
지문: ${q.passage || '(지문 없음)'}
발문: ${q.question_text}
선지: ${q.choices.join(' / ')}
정답: ${q.answer}
`).join('\n---\n')}

중요: 모든 값 안에 큰따옴표(")를 절대 사용하지 마세요. 인용이 필요하면 작은따옴표(')나 한국어 따옴표(「」)를 사용하세요.

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number": 20, "intent": "빈칸에 들어갈 내용을 추론한다.", "translation": "...", "solution": "...", "vocabulary": "word1 뜻1   word2 뜻2"}]`

  const res = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[generateExplanations] raw length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()

  try {
    return JSON.parse(jsonrepair(cleaned))
  } catch (e) {
    console.error('[generateExplanations] JSON parse 실패:', e)
    // 실패 위치 주변 텍스트 로깅 (디버깅용)
    const posMatch = String(e instanceof Error ? e.message : e).match(/position (\d+)/)
    if (posMatch) {
      const pos = parseInt(posMatch[1])
      console.error('[generateExplanations] 실패 위치 주변:', JSON.stringify(cleaned.slice(Math.max(0, pos - 80), pos + 80)))
    }
    // 폴백: 개별 JSON 객체 추출 시도
    const objects: GeneratedExplanation[] = []
    const objRe = /\{\s*"question_number"\s*:\s*(\d+)[^}]*\}/g
    let match: RegExpExecArray | null
    while ((match = objRe.exec(cleaned)) !== null) {
      try {
        objects.push(JSON.parse(jsonrepair(match[0])))
      } catch {
        // 개별 객체도 파싱 불가 → 스킵
      }
    }
    if (objects.length > 0) {
      console.warn(`[generateExplanations] 폴백 파싱 성공: ${objects.length}개 추출`)
      return objects
    }
    throw new Error(`JSON 파싱 실패 (${e instanceof Error ? e.message : e}). raw 길이: ${cleaned.length}`)
  }
}

/**
 * Claude Vision API로 해설 PDF를 직접 파싱한다.
 * unpdf가 한국어 폰트 인코딩을 읽지 못하는 EBS PDF 등에서 fallback으로 사용.
 */
export async function parsePdfExplanationsWithClaude(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')

  const prompt = `이 PDF는 수능/모의고사 영어 해설지입니다. 18번~45번 문항의 해설을 추출해 주세요.

각 문항은 아래 섹션으로 구성되어 있습니다 (없는 섹션은 빈 문자열):
- [출제의도] 또는 【출제의도】
- [해석] 또는 【해석】
- [풀이] 또는 【풀이】
- [Words and Phrases] 또는 [어휘] 등

장문 문항(예: 41~42번, 43~45번)은 [해석]과 [Words and Phrases]를 공유하므로 각 번호에 동일하게 넣어 주세요.

중요:
- solution과 vocabulary 값 안에 큰따옴표(")를 절대 사용하지 마세요. 작은따옴표(')나 한국어 따옴표(「」)를 사용하세요.
- 18번 미만(듣기 영역)은 제외하세요.

JSON 배열만 출력 (다른 텍스트 없이):
[
  {
    "question_number": 18,
    "intent": "[출제의도] 내용",
    "translation": "[해석] 내용",
    "solution": "[풀이] 내용",
    "vocabulary": "[Words and Phrases] 내용"
  },
  ...
]`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          } satisfies DocumentBlockParam,
          { type: 'text', text: prompt } satisfies TextBlockParam,
        ],
      },
    ],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parsePdfExplanationsWithClaude] raw length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()

  try {
    const parsed = JSON.parse(jsonrepair(cleaned)) as ParsedExplanation[]
    return parsed.filter((e) => e.question_number >= 18)
  } catch (e) {
    console.error('[parsePdfExplanationsWithClaude] JSON parse 실패:', e)
    throw new Error(`Claude Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}

/**
 * 학평(교육청 학력평가) 해설 PDF를 Claude Vision으로 파싱한다.
 * 학평 해설지는 [출제의도] + 한국어 번역만 있고, [풀이]/[어휘] 섹션이 없다.
 * 풀이와 어휘는 이후 generateExplanations(full mode)로 별도 생성.
 */
export async function parsePdfExplanationsHakpyung(
  buffer: ArrayBuffer,
): Promise<ParsedExplanation[]> {
  const base64 = Buffer.from(buffer).toString('base64')

  const prompt = `이 PDF는 교육청 학력평가(학평) 영어 해설지입니다.

학평 해설지 형식:
  "N. [출제의도] 한줄설명. 한국어 번역 내용 전체..."
  (평가원과 달리 [해석]/[풀이]/[Words and Phrases] 헤더가 없음)

18번~45번 문항(독해 영역)의 출제의도와 한국어 번역을 추출하세요.
1~17번(듣기 영역)은 제외하세요.

각 필드:
- intent: [출제의도] 바로 뒤의 짧은 설명 (예: "글의 목적을 추론한다.")
- translation: 그 뒤에 오는 한국어 번역 전체 (도표·실용문 등 번역 없는 문항은 "")
- solution: "" (빈 문자열 — AI가 별도로 생성함)
- vocabulary: 문항 끝에 "단어 뜻" 형태 어휘가 있으면 추출, 없으면 ""

중요: 값 안에 큰따옴표(")를 사용하지 마세요.

JSON 배열만 출력:
[{"question_number": 18, "intent": "...", "translation": "...", "solution": "", "vocabulary": ""}]`

  const res = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } satisfies DocumentBlockParam,
          { type: 'text', text: prompt } satisfies TextBlockParam,
        ],
      },
    ],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[parsePdfExplanationsHakpyung] raw length:', raw.length)

  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()

  try {
    const parsed = JSON.parse(jsonrepair(cleaned)) as ParsedExplanation[]
    return parsed.filter((e) => e.question_number >= 18)
  } catch (e) {
    console.error('[parsePdfExplanationsHakpyung] JSON parse 실패:', e)
    throw new Error(`학평 Vision PDF 파싱 실패: ${e instanceof Error ? e.message : e}`)
  }
}
