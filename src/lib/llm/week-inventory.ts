import { weekAnswerContractIssues, canRepairCorrectionInventory, NEW_CORRECTION_EXTRACTION_RULES } from '../week-answer-contract'
import { buildFileBlock, callLlmTextDetailed, createLlmExecution, type TaskCallOptions, parseJsonArrayResponse, parseJsonObjectResponse } from './client'
import type { RangedCallStats, RangedFile } from './ranged'
import type { ParsedAnswer } from './week'
import { buildWeekQuestionTargets, inventoryLabel, weekTargetIssues, type WeekQuestionTarget } from '../week-question-inventory'
import { sanitizeWeekExtraction } from '../week-extraction-shape'
import { getPdfWorkerContext } from '../pdf-import/context'

async function nativeEvidence(files: RangedFile[]): Promise<{ questionText: string; pages: string }> {
  const texts: string[] = []
  const pageBlocks: string[] = []
  for (const [index, file] of files.entries()) {
    if (file.mimeType !== 'application/pdf') continue
    try {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(file.fileData, 'base64')))
      try {
        const { text } = await extractText(pdf, { mergePages: false })
        if (file.role !== 'answers') texts.push(text.join('\n'))
        text.forEach((page, i) => {
          if (page.trim()) pageBlocks.push(`[파일 ${index + 1} / ${i + 1}쪽 원문 텍스트 시작]\n${page}\n[원문 텍스트 끝]`)
        })
      } finally { await pdf.destroy() }
    } catch {
      console.warn('[week-inventory] PDF 텍스트층을 읽지 못해 이미지 기반 문항 목록을 사용합니다.')
    }
  }
  return { questionText: texts.join('\n'), pages: pageBlocks.join('\n\n') }
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
오류교정(find_error)은 정답/해설부에서 틀린 기호를 확인해 그 기호를 sub_labels로 사용하세요(예: ②를 고치면 ["b"]). 답이 여러 개면 해당 기호들을 모두 포함하세요. 정답 근거가 없으면 [null]로 두고 추측하지 마세요.
소문항 없는 문항은 [null], (1)(2) 답안 칸은 ["a","b"], (1)(2)(3)은 ["a","b","c"]입니다.
한 문장에 여러 단어로 된 하나의 표현을 쓰는 빈칸은 표현 전체를 한 답안으로 묶으세요.
보기의 (a)~(e), 객관식 조합표 (A)(B)(C)는 소문항이 아닙니다. 그 외 분리 규칙은 첨부 파싱 규칙을 따르세요.
counts에는 소문항이 아닌 부모 문항 수를 구역별로 적으세요. 표지의 총 문항 수와 반드시 대조하세요.
JSON 객체만 출력: {"counts":{"general":1,"written":1},"questions":[{"section":"general","number":1,"sub_labels":[null],"display_order":1,"passage_group":"p1"},{"section":"written","number":1,"sub_labels":["a","b"],"display_order":2,"passage_group":"p1"}]}
예시의 수를 복사하지 말고 실제 자료 전체를 조사하세요.`

/** Inventory and extraction use the same cached PDF prefix, but distinct identities.
 * Failed coverage is terminal: the caller must never replace existing questions with a partial parse. */
export async function parseWeekInventory(files: RangedFile[], prompt: string, options: TaskCallOptions & { validateAnswerContract?: boolean } = {}): Promise<{
  items: ParsedAnswer[]; calls: RangedCallStats[]; targets: WeekQuestionTarget[]
}> {
  if (!files.length) throw new Error('첨부 파일이 없습니다.')
  const execution = options.execution ?? createLlmExecution()
  const native = await nativeEvidence(files)
  const prefix = [...files.map((f) => buildFileBlock(f.fileData, f.mimeType)),
    { type: 'text' as const, text: prompt + (options.validateAnswerContract ? '\n' + NEW_CORRECTION_EXTRACTION_RULES : '') + '\n첨부 파일 순서/역할: ' + files.map((f, i) => `${i + 1}: ${f.role ?? (files.length === 1 ? 'combined' : i === 0 ? 'questions' : 'answers')}`).join(', ') + '\n문항 구조는 문제지에서, 정답·해설은 정답/해설지에서 읽으세요. 파일별 페이지는 각각 1부터 셉니다.\n아래 원문 텍스트가 있는 페이지의 answer_evidence.quote는 해당 구간 안에서 정답 행만 짧게 그대로 복사하세요. 시각적 배열을 재구성하거나 해설을 덧붙이지 마세요.\n' + native.pages }]
  const calls: RangedCallStats[] = []
  async function call(instruction: string, maxTokens: number) {
    const started = Date.now()
    const response = await callLlmTextDetailed({ task: 'week.parseAnswers', execution, cacheBoundary: prefix.length - 1, maxTokens,
      content: [...prefix, { type: 'text', text: instruction }] })
    calls.push({ ...response.usage, stopReason: response.stopReason, ms: Date.now() - started, range: null })
    if (response.stopReason !== 'end_turn') throw new Error('문항 응답이 끝까지 완료되지 않았습니다.')
    return response.text
  }
  const evidence = native.questionText
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
  const groupCounts = new Map<string, number>()
  for (const t of targets) if (t.passage_group) groupCounts.set(t.passage_group, (groupCounts.get(t.passage_group) ?? 0) + 1)
  for (const t of targets) if (t.passage_group && groupCounts.get(t.passage_group) === 1) t.passage_group = null

  const parts = await Promise.all(targets.map(async (target) => {
    let issues: string[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const instruction = `[문항 식별 범위] 원본의 ${inventoryLabel(target)} 문항만 추출하세요.
원본 번호가 같은 다른 구역의 문항을 섞지 마세요. 연결된 공통 지문과 다른 페이지의 해설까지 찾아 포함하세요.
모든 객체에 source_section=${JSON.stringify(target.section)}, source_question_number=${target.number}, question_number=${target.question_number}를 출력하세요.
sub_label은 ${JSON.stringify(target.sub_labels)}의 각 값마다 정확히 한 객체씩 출력하세요. 추가/누락/중복은 금지입니다.
단, 오류교정(find_error)의 잘못된 기호가 정답/해설에 명시되어 있으면 해당 기호와 실제 답안 유형을 유지하세요. 목록에 맞추려고 subjective로 바꾸지 마세요. 정답 근거가 없으면 정답 필드는 비우고 answer_status=missing으로 표시하세요.
${options.validateAnswerContract ? '신규 교정 문항 예외: 실제 원문 정답이 독립 교정 답 여러 개를 명시하면 상단 sub_label 목록과 달라도 각 답을 별도 객체로 추출하세요. 기호가 있으면 실제 기호, 없으면 작성 칸 순서 a,b,…를 사용하세요. 목록에 맞추려고 답을 한 객체에 묶거나 유형을 바꾸지 마세요. 이 예외는 선택 교정 답에만 적용하며 다른 문항의 목록은 유지하세요.' : ''}
원래 발문 번호는 원문 그대로 두세요. 내부 question_number를 발문에 붙이지 마세요.
${target.passage_group ? `공통 지문 그룹 ${JSON.stringify(target.passage_group)}입니다. shared_passage에 공통 지문 전체를 정확히 추출하세요. 같은 부모의 소문항 중 첫 객체에만 채워도 됩니다. 그 문항의 발문·보기·선지는 공통 지문에 섞지 말고 기존 문항 필드에 보존하세요.` : '독립 문항이므로 shared_passage는 null입니다.'}
${issues.length ? `이전 응답 검증 실패: ${issues.join(', ')}. 문항 전체를 다시 출력하세요.` : ''}
기존 추출 규칙에 따른 JSON 배열만 출력하세요.`
      try {
        const received = parseJsonArrayResponse<unknown>(await call(instruction, 8192), 'week-inventory-target').map(value => sanitizeWeekExtraction(value, options.validateAnswerContract))
        // The server owns these constants. Missing echoed metadata is not missing content;
        // conflicting metadata and wrong question numbers still fail exact coverage.
        const answers = received.map(a => a.question_number === target.question_number ? { ...a,
          source_section: a.source_section ?? target.section, source_question_number: a.source_question_number ?? target.number } : a)
        // Repair only grounded correction leaves from this exact parent. Other
        // question types still have to satisfy the independently discovered inventory.
        const sameParent = answers.length > 0 && answers.every(a =>
          a.question_number === target.question_number && a.source_section === target.section &&
          a.source_question_number === target.number && /^[a-z]$/.test(a.sub_label ?? '') &&
          a.answer_status === 'found' && !!a.answer_evidence?.quote)
        const repairNewCorrection = options.validateAnswerContract && canRepairCorrectionInventory(answers)
        const repairLegacySymbol = !options.validateAnswerContract && target.sub_labels.length === 1 &&
          target.sub_labels[0] === null && answers.every(a => a.question_style === 'find_error')
        if (sameParent && (repairNewCorrection || repairLegacySymbol)) target.sub_labels = answers.map(a => a.sub_label)
        issues = [...weekTargetIssues(target, answers), ...(options.validateAnswerContract ? weekAnswerContractIssues(answers) : [])]
        if (!issues.length) {
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
  for (const group of groupCounts.keys()) {
    if ((groupCounts.get(group) ?? 0) < 2 || passages.has(group)) continue
    const members = targets.filter(t => t.passage_group === group).map(inventoryLabel).join(', ')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const value = parseJsonObjectResponse<{ shared_passage?: string }>(await call(
          `[공통 지문 확인] ${members}가 공유하는 원문 지문을 한 번만 추출하세요. 발문·보기·선지·해설은 제외하세요. JSON 객체만 출력: {"shared_passage":"원문 지문 전체"}`, 8192), 'week-shared-passage')
        if (typeof value.shared_passage === 'string' && value.shared_passage.trim()) { passages.set(group, value.shared_passage.trim()); break }
      } catch { getPdfWorkerContext()?.signal.throwIfAborted() }
    }
    if (!passages.has(group)) throw new Error(`공통 지문 누락: ${members}. 검토 초안을 확정할 수 없습니다.`)
  }
  for (const item of items) {
    if (item.passage_group) item.shared_passage = passages.get(item.passage_group) ?? null
  }
  return { items, calls, targets }
}
