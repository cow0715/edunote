/**
 * 해설지형으로 가져온 진단평가 문항의 밑줄 마크업 backfill.
 *
 * 대상: exam_type='reading', "밑줄 친/낱말의 쓰임/문맥상 낱말" 유형인데 <u> 태그가 없는 문항.
 * 변환: applyUnderlineMarkupToQuestionText (선지 목록이 있는 어휘형만 코드로 복원 가능.
 *       지문 안에 ① 마커만 있는 어법형은 밑줄 구간 정보가 저장돼 있지 않아 복원 불가 →
 *       건수만 보고. 필요하면 해당 주차 해설지 PDF 재가져오기로 해결)
 *
 * 사용법:
 *   npx tsx scripts/backfill-underline-markup.ts            # 미리보기 (변경 없음)
 *   npx tsx scripts/backfill-underline-markup.ts --apply    # 실제 적용
 *
 * 기본은 .env.local(개발 DB). 운영에 적용하려면 환경변수로 덮어쓴다:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-underline-markup.ts --apply
 */

import fs from 'fs'
import path from 'path'

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m && process.env[m[1].trim()] === undefined) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

const APPLY = process.argv.includes('--apply')

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { applyUnderlineMarkupToQuestionText } = await import('../src/lib/week-reading-import')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  const supabase = createClient(url, key)
  console.log(`DB: ${url}  모드: ${APPLY ? '적용(--apply)' : '미리보기'}`)

  // 페이지네이션으로 전체 조회 (기본 1000건 제한 회피)
  type Row = { id: string; week_id: string; question_number: number; sub_label: string | null; question_text: string | null }
  const rows: Row[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('exam_question')
      .select('id, week_id, question_number, sub_label, question_text')
      .eq('exam_type', 'reading')
      .not('question_text', 'is', null)
      .range(offset, offset + 999)
    if (error) throw new Error(`조회 실패: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as Row[]))
    if (data.length < 1000) break
  }

  const underlineType = rows.filter((row) =>
    /밑줄\s*친|낱말의\s*쓰임|문맥상\s*낱말/.test(row.question_text ?? ''))
  const alreadyMarked = underlineType.filter((row) => row.question_text!.includes('<u>'))
  const candidates = underlineType.filter((row) => !row.question_text!.includes('<u>'))

  const fixable: { row: Row; next: string }[] = []
  const unrecoverable: Row[] = []
  for (const row of candidates) {
    const next = applyUnderlineMarkupToQuestionText(row.question_text!)
    if (next !== row.question_text) fixable.push({ row, next })
    else unrecoverable.push(row)
  }

  console.log(`\n전체 reading 문항: ${rows.length}`)
  console.log(`밑줄 유형: ${underlineType.length} (이미 <u> 있음: ${alreadyMarked.length})`)
  console.log(`  코드로 복원 가능: ${fixable.length}`)
  console.log(`  복원 불가 (밑줄 구간 정보 없음 → 재가져오기 필요): ${unrecoverable.length}`)

  if (fixable.length > 0) {
    console.log('\n── 복원 가능 미리보기 (최대 5건) ──')
    for (const { row, next } of fixable.slice(0, 5)) {
      console.log(`\n[week ${row.week_id.slice(0, 8)} Q${row.question_number}${row.sub_label ?? ''}]`)
      const before = row.question_text!.split('\n').find((l) => /[①②③④⑤]/.test(l)) ?? ''
      const after = next.split('\n').find((l) => l.includes('<u>')) ?? ''
      console.log(`  전: ${before.slice(0, 120)}`)
      console.log(`  후: ${after.slice(0, 120)}`)
    }
  }

  if (unrecoverable.length > 0) {
    const byWeek = new Map<string, number>()
    for (const row of unrecoverable) byWeek.set(row.week_id, (byWeek.get(row.week_id) ?? 0) + 1)
    console.log(`\n── 복원 불가 주차별 건수 (해설지 재가져오기 대상) ──`)
    for (const [weekId, count] of byWeek) console.log(`  week ${weekId}: ${count}건`)
  }

  if (!APPLY) {
    console.log('\n미리보기만 했습니다. 적용하려면 --apply 를 붙이세요.')
    return
  }

  let updated = 0
  for (const { row, next } of fixable) {
    const { error } = await supabase.from('exam_question').update({ question_text: next }).eq('id', row.id)
    if (error) {
      console.error(`  업데이트 실패 ${row.id}: ${error.message}`)
      continue
    }
    updated += 1
  }
  console.log(`\n✅ ${updated}/${fixable.length}건 적용 완료`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
