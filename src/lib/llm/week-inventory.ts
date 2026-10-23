import { buildFileBlock, callLlmTextDetailed, createLlmExecution, type TaskCallOptions, parseJsonArrayResponse, parseJsonObjectResponse } from './client'
import type { RangedCallStats, RangedFile } from './ranged'
import type { ParsedAnswer } from './week'
import { buildWeekQuestionTargets, inventoryLabel, weekTargetIssues, type WeekQuestionTarget } from '../week-question-inventory'
import { getPdfWorkerContext } from '../pdf-import/context'

async function nativeEvidence(files: RangedFile[]): Promise<string> {
  const texts: string[] = []
  for (const file of files) {
    if (file.mimeType !== 'application/pdf') continue
    try {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(file.fileData, 'base64')))
      try {
        const { text } = await extractText(pdf, { mergePages: true })
        texts.push(String(text))
      } finally { await pdf.destroy() }
    } catch {
      console.warn('[week-inventory] PDF 텍스트층을 읽지 못해 이미지 기반 문항 목록을 사용합니다.')
    }
  }
  return texts.join('\n')
}

const inventoryInstruction = `문항 목록 조사: 첨부 자료의 모든 페이지를 마지막 페이지까지 확인하세요.
객관식/일반 문항과 별도 번호를 쓰는 서답형/서술형 문항을 구분합니다. 서답형 1은 일반 1과 별개입니다.
section은 별도 번호의 서답형/서술형이면 written, 나머지는 general입니다. 문제의 답안 형식이 아니라 인쇄된 구역으로 판단하세요.
시험지와 해설지의 같은 문항 및 공통 지문 제목의 참조는 한 번만 셉니다. 서답형 1이 객관식 사이에 끼어 있어도 포함하세요.
각 부모 문항마다 number는 인쇄된 번호, sub_labels는 독립 채점 답안의 전체 목록입니다.
display_order는 시험지부의 실제 발문 배치 순서(1부터 연속)입니다. 객관식 번호로 정렬하지 마세요.
예: 객관식 6 → 서답형 1 → 객관식 7 순서면 그 순서대로 display_order를 부여합니다.
passage_group은 같은 원문 지문을 공유하는 부모 문항에 동일한 문자열을 부여하고, 독립 지문은 null입니다.
[3~4], [6, 서답형 1] 같은 공통 지문 표제를 반드시 따르세요. 페이지가 달라도 같은 그룹입니다.
같은 교과서/주제라는 이유만으로 다른 지문을 묶지 마세요.
소문항 없는 문항은 [null], (1)(2) 답안 칸은 ["a","b"], (1)(2)(3)은 ["a","b","c"]입니다.
한 문장에 여러 단어로 된 하나의 표현을 쓰는 빈칸은 표현 전체를 한 답안으로 묶으세요.
보기의 (a)~(e), 객관식 조합표 (A)(B)(C)는 소문항이 아닙니다. 그 외 분리 규칙은 첨부 파싱 규칙을 따르세요.
counts에는 소문항이 아닌 부모 문항 수를 구역별로 적으세요. 표지의 총 문항 수와 반드시 대조하세요.
JSON 객체만 출력: {"counts":{"general":1,"written":1},"questions":[{"section":"general","number":1,"sub_labels":[null],"display_order":1,"passage_group":"p1"},{"section":"written","number":1,"sub_labels":["a","b"],"display_order":2,"passage_group":"p1"}]}
예시의 수를 복사하지 말고 실제 자료 전체를 조사하세요.`

/** Inventory and extraction use the same cached PDF prefix, but distinct identities.
 * Failed coverage is terminal: the caller must never replace existing questions with a partial parse. */
export async function parseWeekInventory(files: RangedFile[], prompt: string, options: TaskCallOptions = {}): Promise<{
  items: ParsedAnswer[]; calls: RangedCallStats[]; targets: WeekQuestionTarget[]
}> {
  if (!files.length) throw new Error('첨부 파일이 없습니다.')
  const execution = options.execution ?? createLlmExecution()
  const prefix = [...files.map((f) => buildFileBlock(f.fileData, f.mimeType)),
    { type: 'text' as const, text: prompt }]
  const calls: RangedCallStats[] = []
  async function call(instruction: string, maxTokens: number) {
    const started = Date.now()
    const response = await callLlmTextDetailed({ task: 'week.parseAnswers', execution, cacheBoundary: prefix.length - 1, maxTokens,
      content: [...prefix, { type: 'text', text: instruction }] })
    calls.push({ ...response.usage, stopReason: response.stopReason, ms: Date.now() - started, range: null })
    if (response.stopReason !== 'end_turn') throw new Error('문항 응답이 끝까지 완료되지 않았습니다.')
    return response.text
  }
  const evidence = await nativeEvidence(files)
  let targets: WeekQuestionTarget[] = []
  let discoveryError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await call(`${inventoryInstruction}${discoveryError ? `\n이전 조사 오류: ${discoveryError}. 전체 목록을 다시 조사하세요.` : ''}`, 8192)
      targets = buildWeekQuestionTargets(parseJsonObjectResponse(text, 'week-inventory'), evidence)
      break
    } catch (error) {
      getPdfWorkerContext()?.signal.throwIfAborted()
      discoveryError = error instanceof Error ? error.message : '문항 목록 오류'
    }
  }
  if (!targets.length) throw new Error(`문항 목록 검증 실패: ${discoveryError}`)

  const parts = await Promise.all(targets.map(async (target) => {
    let issues: string[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const instruction = `[문항 식별 범위] 원본의 ${inventoryLabel(target)} 문항만 추출하세요.
원본 번호가 같은 다른 구역의 문항을 섞지 마세요. 연결된 공통 지문과 다른 페이지의 해설까지 찾아 포함하세요.
모든 객체에 source_section=${JSON.stringify(target.section)}, source_question_number=${target.number}, question_number=${target.question_number}를 출력하세요.
sub_label은 ${JSON.stringify(target.sub_labels)}의 각 값마다 정확히 한 객체씩 출력하세요. 추가/누락/중복은 금지입니다.
원래 발문 번호는 원문 그대로 두세요. 내부 question_number를 발문에 붙이지 마세요.
${target.passage_group ? `공통 지문 그룹 ${JSON.stringify(target.passage_group)}입니다. shared_passage에 공통 지문 전체를 정확히 추출하세요. 그 문항의 발문·보기·선지는 공통 지문에 섞지 말고 기존 문항 필드에 보존하세요.` : '독립 문항이므로 shared_passage는 null입니다.'}
${issues.length ? `이전 응답 검증 실패: ${issues.join(', ')}. 문항 전체를 다시 출력하세요.` : ''}
기존 추출 규칙에 따른 JSON 배열만 출력하세요.`
      try {
        const answers = parseJsonArrayResponse<ParsedAnswer>(await call(instruction, 8192), 'week-inventory-target')
        issues = weekTargetIssues(target, answers)
        if (!issues.length) {
          if (target.passage_group && answers.some((answer) => !answer.shared_passage?.trim())) {
            issues = [`${inventoryLabel(target)}: 공통 지문 누락`]
            continue
          }
          return answers.map((answer) => ({ ...answer, inventory_sub_labels: target.sub_labels,
            display_order: target.display_order, passage_group: target.passage_group,
            shared_passage: target.passage_group ? answer.shared_passage?.trim() : null }))
        }
      } catch (error) {
        getPdfWorkerContext()?.signal.throwIfAborted()
        issues = [`${inventoryLabel(target)}: ${error instanceof Error ? error.message : '파싱 실패'}`]
      }
    }
    throw new Error(`문항 누락 검증 실패: ${issues.join(', ')}. 기존 문항은 변경하지 않았습니다.`)
  }))
  const items = parts.flat()
  // One canonical common source per group; keep individual passage/question fields intact.
  const passages = new Map<string, string>()
  for (const item of items) {
    if (item.passage_group && item.shared_passage && !passages.has(item.passage_group)) {
      passages.set(item.passage_group, item.shared_passage)
    }
  }
  for (const item of items) {
    if (item.passage_group) item.shared_passage = passages.get(item.passage_group) ?? null
  }
  return { items, calls, targets }
}
