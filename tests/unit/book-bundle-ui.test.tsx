// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookBundleHistory, BookBundleUpload } from '@/components/exam-bank/book-bundle'
const m=vi.hoisted(()=>({upload:vi.fn(),pdf:vi.fn(),path:vi.fn(),client:vi.fn()}))
vi.mock('@/lib/supabase/client',()=>({createClient:m.client}))
vi.mock('@/lib/pdf-import/client',()=>({examPdfUploadPath:m.path}))
vi.mock('pdf-lib',()=>({PDFDocument:{load:m.pdf}}))
const names=['수능영독(상).pdf','수특영독(하).pdf','수완(유형).pdf','수완(실전).pdf']
let client:QueryClient
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
  m.upload.mockResolvedValue({error:null});m.pdf.mockResolvedValue({getPageCount:()=>100})
  m.client.mockReturnValue({storage:{from:()=>({upload:m.upload})}});m.path.mockImplementation(async(_s,name)=>`user/${name}`)
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({accepted:true,bundle_id:'bundle'})))
})
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals()})
function show(){render(<QueryClientProvider client={client}><BookBundleUpload onBack={vi.fn()}/></QueryClientProvider>)}
function choose(list=names){const files=list.map(name=>{const f=new File(['pdf'],name,{type:'application/pdf'});Object.defineProperty(f,'arrayBuffer',{value:async()=>new ArrayBuffer(1)});return f});fireEvent.change(screen.getByLabelText('교재 PDF 여러 개 선택',{selector:'input'}),{target:{files}})}
describe('four-file textbook registration',()=>{
  it('infers each volume without sending registration requests on selection',async()=>{
    show();choose()
    await screen.findByText('수완(실전).pdf')
    expect(m.upload).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
    expect(screen.getAllByRole('combobox').map(s=>(s as HTMLSelectElement).value)).toEqual(['suteuk_reading','upper','suteuk_reading','lower','suwan_english','type','suwan_english','practical'])
    expect(screen.getByText(/묶음 최대 \$20/)).toBeTruthy()
  })
  it('uploads four objects once and submits one durable registration key on retries',async()=>{
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'temporary registration error'},{status:503})).mockResolvedValueOnce(Response.json({accepted:true}))
    show();choose();await screen.findByText('수완(실전).pdf')
    fireEvent.click(screen.getByRole('button',{name:'교재 묶음 등록 시작'}))
    await screen.findByRole('alert')
    const first=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(first.files).toHaveLength(4);expect(m.upload).toHaveBeenCalledTimes(4)
    fireEvent.click(screen.getByRole('button',{name:'이전 접수 이어 확인'}))
    await screen.findByRole('status')
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual(first)
    expect(m.upload).toHaveBeenCalledTimes(4);expect(sessionStorage.getItem('edunote-book-bundle-pending')).toBeNull()
  })
  it('rejects more than four files and ambiguous classifications before uploading',async()=>{
    show();choose([...names,'extra.pdf'])
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('1~4개'))
    choose(['unknown.pdf']);await screen.findByText('unknown.pdf')
    expect((screen.getByRole('button',{name:'교재 묶음 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect(m.upload).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('shows held reasons and real budget/progress, without offering automatic resume',()=>{
    const open=vi.fn()
    render(<BookBundleHistory onOpenBook={open} bundles={[{id:'bundle',state:'ready',limit_usd:20,stop_reason:'공통 응답 오류',files:[{document_id:'doc',title:'2027 영독 상',phase:'held',reason:'대표 구간 미완료',job_id:'job',status:'failed',error:null,spent_usd:9.45,reserved_usd:0,unit_count:106,done_units:1,question_count:108}]}]}/> )
    expect(screen.getByRole('alert').textContent).toBe('공통 응답 오류')
    expect(screen.getByText(/등록 보류/)).toBeTruthy();expect(screen.getByText(/1\/106지문/)).toBeTruthy()
    expect(screen.queryByRole('button',{name:'재실행'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'처리 상세'}));expect(open).toHaveBeenCalledWith('doc')
  })
})
