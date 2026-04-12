import Anthropic from '@anthropic-ai/sdk'
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

export type { ExamOcrQuestion }

export type ExamOcrResult = {
  question_number: number
  sub_label: string | null
  student_answer?: number
  student_answer_text?: string
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export type SubjectiveQuestion = {
  question_number: number
  sub_label: string | null
  correct_answer_text: string
  grading_criteria: string | null
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

  const prompt = `${GRADING_SYSTEM}

## 문제 정보
${questions.map((q) => `
[${qLabel(q)}]
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
  const fileContent = { type: 'image' as const, source: { type: 'base64' as const, media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: fileData } }

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

// ── 기출문제 AI 해설 생성 ─────────────────────────────────────────────────
// 대상: 20~24번, 29~42번 문항
// 생성 필드: explanation_translation (해석), explanation_vocabulary (Words & Phrases)

export type GeneratedExplanation = {
  question_number: number
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
): Promise<GeneratedExplanation[]> {
  if (questions.length === 0) return []

  const prompt = `다음 수능/모의고사 영어 문항들의 풀이와 어휘를 생성하세요.

각 문항에 대해 아래 두 가지를 작성하세요:

1. solution (풀이)
   - 정답 근거: 지문에서 정답의 단서가 되는 핵심 문장/표현을 한국어로 짚어줄 것
   - 오답 포인트: 헷갈리기 쉬운 오답 선지가 왜 틀렸는지 간결하게 설명 (1~2개)
   - 단순 "정답은 ~이다" 수준이 아니라, 학생이 다음에 유사 문항을 맞힐 수 있도록 풀이 전략 중심으로 작성
   - 2~4문장 이내로 간결하게

2. vocabulary (Words & Phrases)
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

JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number": 20, "solution": "...", "vocabulary": "word1 뜻1   word2 뜻2"}]`

  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,  // 5문항 배치 기준 충분
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = res.content[0].type === 'text' ? res.content[0].text : ''
  console.log('[generateExplanations] raw length:', raw.length)

  try {
    return JSON.parse(jsonrepair(raw.replace(/```json\n?|\n?```/g, '').trim()))
  } catch (e) {
    console.error('[generateExplanations] JSON parse 실패:', e)
    throw e
  }
}
