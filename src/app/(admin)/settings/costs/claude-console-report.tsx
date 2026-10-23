import { useState } from 'react'
import { reconcileClaude, type ClaudeReport } from '@/lib/costs/claude-report'
import { estimateMoney } from '@/lib/costs/estimate'
import type { UsageGroup } from '@/lib/costs/model'

const panel = 'rounded-[20px] bg-[var(--share-card)] p-5 sm:p-6'
const muted = 'text-[var(--share-muted)]'
const usd = (n: number) => estimateMoney(n, 'USD')
const count = (n: number) => n.toLocaleString('ko-KR')
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function ClaudeConsoleReport({ report, tail }: { report: ClaudeReport | null; tail: UsageGroup[] }) {
  const [mode, setMode] = useState('chart')
  const [date, setDate] = useState<string | null>(null)
  if (!report) return <section className={panel}><h2 className="text-[15px] font-extrabold">Claude 조직 보고서</h2><p className={`mt-2 text-sm ${muted}`}>업체 데이터 동기화로 과거 사용량을 가져오면 월 전체 비용·일별 추이·모델별 내역이 표시됩니다.</p></section>
  const total = reconcileClaude(report, tail)
  const selected = report.days.find(day => day.date === date) ?? report.days.at(-1)
  const max = Math.max(0.01, ...report.days.map(day => Math.max(0, day.reported ?? day.estimate)))
  return <>
    <section className={panel}>
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="text-[15px] font-extrabold">월 누계 계산 내역</h2><p className={`mt-1 text-xs ${muted}`}>시간이 겹치지 않는 세 구간만 합산합니다.</p></div><p className={`text-[11px] ${muted}`}>조직 보고서 수집 {time(report.fetchedAt)}</p></div>
      <dl className="mt-4 grid gap-3 @min-[620px]:grid-cols-3">{[
        ['비용 API에 집계된 금액', usd(total.reported), `${time(report.costThrough)}까지 (한국 시간)`],
        ['그 이후 조직 사용량 환산', `+ ${usd(total.pending)}`, `${time(report.usageThrough)}까지 · 토큰 단가 적용`],
        ['그 이후 앱 최근 기록', `+ ${usd(total.live)}`, '선택한 환경에서 추가로 기록된 사용량'],
      ].map(([label, amount, caption]) => <div key={label} className="rounded-xl bg-[var(--share-box)] p-4"><dt className={`text-xs ${muted}`}>{label}</dt><dd className="mt-2 text-xl font-bold tabular-nums">{amount}</dd><p className={`mt-2 text-[11px] ${muted}`}>{caption}</p></div>)}</dl>
      <p className={`mt-3 text-xs leading-relaxed ${muted}`}>조직 보고서에는 앱 밖에서 쓴 사용량도 포함됩니다. 업체 반영 지연·추가 요금·계약 할인에 따라 콘솔 및 청구서와 차이가 남을 수 있습니다.{total.partial && <span className="text-[var(--share-red)]"> 단가가 확인되지 않은 사용량은 계산 제외되어 전체 금액이 아닙니다.</span>}</p>
    </section>
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[15px] font-extrabold">일별 Claude 비용</h2><p className={`mt-1 text-xs ${muted}`}>USD · UTC 날짜 · 회색은 업체 조회액, 파랑은 이후 사용량 환산액</p></div><div className="flex gap-1" role="group" aria-label="일별 비용 표시">{[['chart', '차트'], ['table', '표']].map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`min-h-11 cursor-pointer rounded-xl px-3 text-xs ${mode === value ? 'bg-[var(--share-box)] font-bold' : muted}`}>{label}</button>)}</div></div>
      {mode === 'chart' ? <>
        <div className="mt-5 overflow-x-auto"><div className="relative min-w-[600px] pt-5"><span className={`absolute left-0 top-0 text-[10px] ${muted}`}>{usd(max)}</span><div className="pointer-events-none absolute inset-x-0 top-5 h-40 border-y border-[var(--share-line-strong)]" /><div className="relative flex h-48 items-end gap-1">{report.days.map(day => <button key={day.date} type="button" aria-label={`${day.date} ${day.reported !== null ? '업체 조회액' : '예상'} ${usd(day.reported ?? day.estimate)}`} aria-pressed={selected?.date === day.date} onFocus={() => setDate(day.date)} onClick={() => setDate(day.date)} className={`flex h-full min-w-5 flex-1 cursor-pointer flex-col justify-end rounded-t-md px-0.5 outline-offset-2 ${selected?.date === day.date ? 'bg-[var(--share-box)]' : ''}`}><span className={`block w-full rounded-t-sm ${day.reported !== null ? 'bg-[var(--share-muted2)]' : 'bg-[var(--share-blue)]'}`} style={{ height: `${Math.max(0, day.reported ?? day.estimate) / max * 160}px` }} /><span className={`mt-2 pb-1 text-center text-[10px] ${muted}`}>{Number(day.date.slice(-2))}</span></button>)}</div></div></div>
        {selected && <p className={`mt-3 text-xs ${muted}`}>{selected.date} · {selected.reported !== null ? `업체 조회액 ${usd(selected.reported)}` : `사용량 환산 ${usd(selected.estimate)}${selected.partial ? ' · 일부 계산' : ''}`} · 미래 날짜는 표시하지 않습니다.</p>}
      </> : <div className="mt-4 max-h-72 overflow-auto"><table className="w-full text-left text-xs tabular-nums"><thead><tr><th className="py-2">UTC 날짜</th><th>업체 조회액</th><th>사용량 환산액</th></tr></thead><tbody>{report.days.map(day => <tr key={day.date} className="border-t border-[var(--share-line)]"><td className="py-2">{day.date}</td><td>{day.reported !== null ? usd(day.reported) : '미집계'}</td><td>{usd(day.estimate)}{day.partial ? ' (일부)' : ''}</td></tr>)}</tbody></table></div>}
    </section>
    <section className={panel}><h2 className="text-[15px] font-extrabold">모델별 비용·사용량</h2><p className={`mt-1 text-xs ${muted}`}>업체 과거 사용량에서 복원한 내역입니다. 최근 앱 추가분은 위 계산 내역에서 따로 확인하세요.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs tabular-nums"><thead><tr><th className="py-2">모델</th><th>집계 금액 + 이후 환산</th><th>입력 / 출력</th><th>캐시 읽기 / 쓰기</th></tr></thead><tbody>{report.models.map(row => <tr key={row.model} className="border-t border-[var(--share-line)]"><td className="py-3 font-medium">{row.model}</td><td className="font-bold">{usd(row.reported + row.pending)}</td><td>{count(row.input)} / {count(row.output)}</td><td>{count(row.read)} / {count(row.write + row.writeHour)}</td></tr>)}</tbody></table></div></section>
  </>
}
