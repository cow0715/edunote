// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({info:null as unknown,invalidate:vi.fn(),refetch:vi.fn(),fetch:vi.fn()}))
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:m.info,error:null,refetch:m.refetch}),useQueryClient:()=>({invalidateQueries:m.invalidate})}))
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
import { PilotReview } from '@/components/pdf-import/pilot-review'
beforeEach(()=>{vi.clearAllMocks();m.info={phase:'pilot_review',snapshot_current:'a'.repeat(32),review:{snapshot:'a'.repeat(32),completed_units:6,remaining_units:90,spent_usd:2,reserved_usd:0,limit_usd:14}};m.fetch.mockResolvedValue({ok:true,json:async()=>({approved:true,resumed:false})});vi.stubGlobal('fetch',m.fetch)})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('renders stopped representative results and submits only explicit consent, never a retry',async()=>{
  render(createElement(PilotReview,{jobId:'job'}))
  expect(m.fetch).not.toHaveBeenCalled()
  const button=screen.getByRole('button',{name:'전체 처리 범위 승인'}) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button)
  await waitFor(()=>expect(m.invalidate).toHaveBeenCalled())
  expect(m.fetch).toHaveBeenCalledExactlyOnceWith('/api/pdf-import/jobs/job/pilot-review',expect.objectContaining({method:'POST'}))
})
it('does not expose an approval action for a stale review',()=>{
  m.info={...(m.info as object),snapshot_current:'b'.repeat(32)}
  render(createElement(PilotReview,{jobId:'job'}))
  expect(screen.queryByRole('button',{name:'전체 처리 범위 승인'})).toBeNull()
  expect(m.fetch).not.toHaveBeenCalled()
})
