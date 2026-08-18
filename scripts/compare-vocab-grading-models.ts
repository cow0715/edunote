/**
 * 단어 뜻 채점 — Sonnet vs Haiku 비교
 *
 * 다의어·유사어·품사·오타·-ing/-ed 등 경계 사례를 모은 답안 세트를 두 모델에 같은 규칙으로 넣고
 * (1) 사람이 정한 기대값 대비 정확도, (2) 두 모델 간 불일치, (3) 시간을 비교한다.
 *
 * ⚠️ 실제 LLM 호출 = 과금. 사용자 요청 시만.
 *   npx tsx scripts/compare-vocab-grading-models.ts
 *   npx tsx scripts/compare-vocab-grading-models.ts --runs 3     # 각 모델 3회 반복 (일관성 확인)
 */

import fs from 'fs'
import path from 'path'

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadEnv()

type Case = { number: number; english_word: string; correct_answer: string; student_answer: string; expected: boolean; why: string }

// 기대값은 VOCAB_GRADING_RULES 기준으로 사람이 정함. 규칙이 애매한 건 why 에 근거를 적어둠.
const CASES: Case[] = [
  // ── 다의어: correct_answer 에 없어도 사전적 뜻이면 정답 ──
  { number: 1, english_word: 'run', correct_answer: '달리다', student_answer: '운영하다', expected: true, why: '다의어, 동사 유지' },
  { number: 2, english_word: 'run', correct_answer: '달리다', student_answer: '경영하다', expected: true, why: '다의어' },
  { number: 3, english_word: 'address', correct_answer: '주소', student_answer: '연설하다', expected: true, why: '다의어 (명사→동사지만 address 자체가 두 품사)' },
  { number: 4, english_word: 'address', correct_answer: '주소', student_answer: '다루다', expected: true, why: '다의어 (문제를 다루다)' },
  { number: 5, english_word: 'bank', correct_answer: '은행', student_answer: '강둑', expected: true, why: '다의어' },
  { number: 6, english_word: 'fine', correct_answer: '좋은', student_answer: '벌금', expected: true, why: '다의어 (형용사/명사 모두 fine 의 품사)' },
  { number: 7, english_word: 'book', correct_answer: '책', student_answer: '예약하다', expected: true, why: '다의어' },
  { number: 8, english_word: 'match', correct_answer: '경기', student_answer: '어울리다', expected: true, why: '다의어' },
  { number: 9, english_word: 'present', correct_answer: '선물', student_answer: '현재의', expected: true, why: '다의어' },
  { number: 10, english_word: 'present', correct_answer: '선물', student_answer: '발표하다', expected: true, why: '다의어' },
  { number: 11, english_word: 'object', correct_answer: '물체', student_answer: '반대하다', expected: true, why: '다의어' },
  { number: 12, english_word: 'suit', correct_answer: '정장', student_answer: '어울리다', expected: true, why: '다의어' },
  { number: 13, english_word: 'firm', correct_answer: '회사', student_answer: '단단한', expected: true, why: '다의어' },
  { number: 14, english_word: 'spring', correct_answer: '봄', student_answer: '용수철', expected: true, why: '다의어' },
  { number: 15, english_word: 'charge', correct_answer: '요금', student_answer: '충전하다', expected: true, why: '다의어' },
  // ── 유사어 관대 (같은 뜻의 다른 표현) ──
  { number: 16, english_word: 'inevitable', correct_answer: '불가피한', student_answer: '피할 수 없는', expected: true, why: '동의 표현' },
  { number: 17, english_word: 'demonstrate', correct_answer: '보여주다', student_answer: '증명하다', expected: true, why: '사전적 뜻' },
  { number: 18, english_word: 'considerable', correct_answer: '상당한', student_answer: '꽤 많은', expected: true, why: '동의 표현' },
  { number: 19, english_word: 'abandon', correct_answer: '버리다', student_answer: '포기하다', expected: true, why: '사전적 뜻' },
  { number: 20, english_word: 'restrict', correct_answer: '제한하다', student_answer: '한정하다', expected: true, why: '동의' },
  // ── 명백한 오답 ──
  { number: 21, english_word: 'abandon', correct_answer: '버리다', student_answer: '유지하다', expected: false, why: '반의어' },
  { number: 22, english_word: 'provoke', correct_answer: '자극하다', student_answer: '칭찬하다', expected: false, why: '무관' },
  { number: 23, english_word: 'necessary', correct_answer: '필수적인', student_answer: '불필요한', expected: false, why: '반의어' },
  { number: 24, english_word: 'diminish', correct_answer: '줄어들다', student_answer: '증가하다', expected: false, why: '반의어' },
  // ── 품사 불일치 (규칙: 엄격) ──
  { number: 25, english_word: 'considerable', correct_answer: '상당한', student_answer: '고려하다', expected: false, why: 'consider 와 혼동, 품사 다름' },
  { number: 26, english_word: 'considerate', correct_answer: '사려 깊은', student_answer: '고려하다', expected: false, why: '품사 다름' },
  { number: 27, english_word: 'economic', correct_answer: '경제의', student_answer: '경제', expected: false, why: '형용사→명사' },
  { number: 28, english_word: 'various', correct_answer: '다양한', student_answer: '다양성', expected: false, why: '형용사→명사' },
  // ── 어미/표기 관용 ──
  { number: 29, english_word: 'evaluate', correct_answer: '평가하다', student_answer: '평가', expected: true, why: '동사 어미 생략은 규칙상 관용 (하다 생략)' },
  { number: 30, english_word: 'restrict', correct_answer: '제한하다', student_answer: '제한', expected: true, why: '하다 생략 관용' },
  { number: 31, english_word: 'sustain', correct_answer: '유지하다', student_answer: '유지 하다', expected: true, why: '띄어쓰기' },
  { number: 32, english_word: 'phenomenon', correct_answer: '현상', student_answer: '현삼', expected: false, why: '오타로 다른 단어 (인삼류) — 규칙: 다른 유효 단어가 되면 오답' },
  { number: 33, english_word: 'hypothesis', correct_answer: '가설', student_answer: '가셜', expected: true, why: '단순 오타, 다른 단어 아님' },
  // ── -ing / -ed 구분 (규칙 명시) ──
  { number: 34, english_word: 'interesting', correct_answer: '흥미로운', student_answer: '흥미를 느끼는', expected: false, why: 'interested 뜻' },
  { number: 35, english_word: 'interested', correct_answer: '흥미를 느끼는', student_answer: '흥미로운', expected: false, why: 'interesting 뜻' },
  { number: 36, english_word: 'boring', correct_answer: '지루한', student_answer: '지루한', expected: true, why: '정답' },
  { number: 37, english_word: 'bored', correct_answer: '지루해하는', student_answer: '지루한', expected: false, why: 'boring 뜻' },
  // ── 영어 베껴쓰기 / 빈칸 ──
  { number: 38, english_word: 'genuine', correct_answer: '진짜의', student_answer: 'genuine', expected: false, why: '영어 그대로' },
  { number: 39, english_word: 'legitimate', correct_answer: '합법적인', student_answer: '', expected: false, why: '미기재' },
  // ── 뜻 여러 개 중 하나만 맞음 ──
  { number: 40, english_word: 'implement', correct_answer: '시행하다 / 도구', student_answer: '도구', expected: true, why: '여러 뜻 중 하나' },
  { number: 41, english_word: 'implement', correct_answer: '시행하다 / 도구', student_answer: '시행하다, 무기', expected: true, why: '하나 맞고 하나 틀림 — 규칙: 하나만 맞으면 정답' },
  { number: 42, english_word: 'objective', correct_answer: '목표', student_answer: '객관적인', expected: true, why: '다의어 (명사/형용사 둘 다 objective)' },
]

async function main() {
  const { gradeVocabItems } = await import('../src/lib/anthropic')
  const runsArg = process.argv.indexOf('--runs')
  const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) || 1 : 1
  const models = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001']

  const items = CASES.map((c) => ({ number: c.number, english_word: c.english_word, student_answer: c.student_answer, correct_answer: c.correct_answer }))
  const results: Record<string, { grades: boolean[][]; ms: number[] }> = {}

  for (const model of models) {
    results[model] = { grades: [], ms: [] }
    for (let r = 0; r < runs; r++) {
      const t = Date.now()
      const graded = await gradeVocabItems(items, undefined, model)
      results[model].ms.push(Date.now() - t)
      const byNum = new Map(graded.map((g) => [g.number, g.is_correct]))
      results[model].grades.push(CASES.map((c) => byNum.get(c.number) ?? false))
    }
  }

  // ── 출력 ──
  const short = (m: string) => m.includes('haiku') ? 'Haiku' : 'Sonnet'
  console.log(`\n${'#'.padStart(3)}  ${'단어'.padEnd(13)} ${'정답'.padEnd(12)} ${'학생답'.padEnd(12)} 기대  ${models.map(short).join('   ')}  비고`)
  console.log('─'.repeat(100))
  const acc: Record<string, number> = {}
  const flip: Record<string, number> = {}
  let disagree = 0
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    const cells = models.map((m) => {
      const votes = results[m].grades.map((g) => g[i])
      const yes = votes.filter(Boolean).length
      const majority = yes * 2 > votes.length
      const consistent = yes === 0 || yes === votes.length
      if (!consistent) flip[m] = (flip[m] ?? 0) + 1
      if (majority === c.expected) acc[m] = (acc[m] ?? 0) + 1
      const mark = majority ? '✓' : '✗'
      const badge = majority === c.expected ? ' ' : '❌'
      return `${mark}${badge}${consistent ? ' ' : '~'}`
    })
    const s = results[models[0]].grades.map((g) => g[i]).filter(Boolean).length * 2 > runs
    const h = results[models[1]].grades.map((g) => g[i]).filter(Boolean).length * 2 > runs
    if (s !== h) disagree += 1
    console.log(`${String(c.number).padStart(3)}  ${c.english_word.padEnd(13)} ${c.correct_answer.padEnd(12)} ${(c.student_answer || '(빈칸)').padEnd(12)} ${c.expected ? '✓' : '✗'}     ${cells.join('     ')}  ${c.why}`)
  }
  console.log('─'.repeat(100))
  for (const m of models) {
    const avg = results[m].ms.reduce((a, b) => a + b, 0) / results[m].ms.length
    console.log(`${short(m).padEnd(7)} 정확도 ${acc[m] ?? 0}/${CASES.length}  평균 ${(avg / 1000).toFixed(1)}s${runs > 1 ? `  (${runs}회 중 답 바뀐 문항 ${flip[m] ?? 0}개)` : ''}`)
  }
  console.log(`두 모델 불일치: ${disagree}개`)
  console.log('\n범례: ✓/✗ = 모델 판정, ❌ = 기대와 다름, ~ = 반복 실행 간 답이 바뀜')
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
