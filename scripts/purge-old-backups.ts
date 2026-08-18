/**
 * 이미 쌓여버린 백업 파일 정리 (일회성).
 *
 * 앞으로 생기는 것은 api/backup 이 자동으로 정리하지만,
 * 그 전까지 누적된 파일은 이걸로 한 번 걷어내야 한다.
 *
 * 사용법:
 *   npx tsx scripts/purge-old-backups.ts                 # 미리보기 (아무것도 지우지 않음)
 *   npx tsx scripts/purge-old-backups.ts --keep 7        # 7개만 남기는 미리보기
 *   npx tsx scripts/purge-old-backups.ts --keep 7 --apply  # 실제 삭제
 *
 * 기본은 미리보기다. --apply 를 직접 붙이기 전에는 절대 지우지 않는다.
 * 삭제는 되돌릴 수 없으니 어느 프로젝트를 건드리는지 먼저 확인하고 실행할 것.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  BACKUP_BUCKET,
  BACKUP_FILE_PATTERN,
  DEFAULT_BACKUP_RETENTION,
  selectExpiredBackups,
} from '../src/lib/backup-retention'

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) throw new Error('.env.local 이 없습니다')
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^["']|["']$/g, '')
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

async function main() {
  loadEnv()

  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const keepArg = args[args.indexOf('--keep') + 1]
  const keep = args.includes('--keep') && Number(keepArg) >= 1 ? Math.floor(Number(keepArg)) : DEFAULT_BACKUP_RETENTION

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')

  // 어느 프로젝트를 건드리는지 반드시 눈으로 확인시킨다
  console.log(`\n대상 프로젝트: ${url}`)
  console.log(`버킷: ${BACKUP_BUCKET} / 보관 개수: ${keep}`)
  console.log(apply ? '모드: 실제 삭제 (--apply)' : '모드: 미리보기 (지우지 않음)')
  console.log('─'.repeat(64))

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // 전체 목록 (list 는 한 번에 100개)
  const files: { name: string; size: number }[] = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .list('', { limit: 100, offset, sortBy: { column: 'name', order: 'desc' } })
    if (error) throw new Error(`목록 조회 실패: ${error.message}`)
    if (!data || data.length === 0) break
    files.push(...data.map((f) => ({ name: f.name, size: (f.metadata?.size as number | undefined) ?? 0 })))
    if (data.length < 100) break
    offset += data.length
  }

  const backups = files.filter((f) => BACKUP_FILE_PATTERN.test(f.name))
  const others = files.filter((f) => !BACKUP_FILE_PATTERN.test(f.name))
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  // supabase-js 의 storage.list() 는 호스트에 연결조차 못 해도
  // { data: [], error: null } 을 돌려준다. "빈 버킷"과 "접속 실패"가 구분되지 않는다.
  if (files.length === 0) {
    console.log('\n파일이 0개입니다.')
    console.log('주의: 버킷이 비어있는 경우와 **접속 실패**가 똑같이 0개로 보입니다.')
    console.log('      (supabase-js 가 네트워크 오류를 빈 배열로 삼킵니다)')
    console.log(`      위 프로젝트 주소가 맞는지, 프로젝트가 살아있는지 확인하세요.`)
    return
  }

  console.log(`전체 파일 ${files.length}개 (${formatBytes(totalSize)})`)
  console.log(`  · 백업 형식: ${backups.length}개`)
  if (others.length > 0) {
    console.log(`  · 그 외(건드리지 않음): ${others.length}개 — ${others.slice(0, 5).map((f) => f.name).join(', ')}`)
  }

  const expired = selectExpiredBackups(backups.map((f) => f.name), keep)
  if (expired.length === 0) {
    console.log('\n지울 것이 없습니다.')
    return
  }

  const sizeByName = new Map(files.map((f) => [f.name, f.size]))
  const freed = expired.reduce((sum, name) => sum + (sizeByName.get(name) ?? 0), 0)

  console.log(`\n삭제 대상 ${expired.length}개 (${formatBytes(freed)} 확보 예상)`)
  console.log(`  가장 오래된: ${expired[expired.length - 1]}`)
  console.log(`  가장 최근  : ${expired[0]}`)
  console.log(`남길 것 ${backups.length - expired.length}개 (가장 오래된 것: ${
    backups.map((f) => f.name).sort().reverse()[keep - 1] ?? '-'
  })`)

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.')
    return
  }

  console.log('\n삭제 중...')
  const CHUNK = 100
  let done = 0
  for (let i = 0; i < expired.length; i += CHUNK) {
    const batch = expired.slice(i, i + CHUNK)
    const { error } = await supabase.storage.from(BACKUP_BUCKET).remove(batch)
    if (error) throw new Error(`삭제 실패 (${done}개까지 완료): ${error.message}`)
    done += batch.length
    console.log(`  ${done}/${expired.length}`)
  }
  console.log(`\n완료: ${done}개 삭제, ${formatBytes(freed)} 확보`)
}

main().catch((e) => {
  console.error('\n오류:', e instanceof Error ? e.message : e)
  process.exit(1)
})
