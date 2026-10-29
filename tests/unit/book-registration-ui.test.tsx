// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BookUploadForm} from '@/components/exam-bank/book-upload-form'
import {RegistrationPanel} from '@/components/exam-bank/registration-panel'
vi.mock('@/components/pdf-import/job-list',()=>({PdfImportJobList:()=> <div>통합 처리 내역</div>}))
vi.mock('@/components/exam-bank/book-import-panel',()=>({BookResult:({id}:{id:string})=><div>교재 결과 {id}</div>}))
vi.mock('@/lib/supabase/client',()=>({createClient:vi.fn()}))
let client:QueryClient
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});vi.stubGlobal('fetch',vi.fn(async()=>Response.json({enabled:true,documents:[]})))})
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals()})
function show(node:React.ReactNode){return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)}
describe('unified registration UI',()=>{
  it('enables verified reading and Suwan PDF selection with compatible volume choices',async()=>{
    show(<BookUploadForm onRegistered={vi.fn()} />)
    expect(await screen.findByRole('radio',{name:/수능특강 영어독해연습/})).toBeTruthy()
    fireEvent.click(screen.getByRole('radio',{name:/수능특강 영어독해연습/}))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button',{name:'교재 원본 PDF 선택'}) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('radio',{name:'상'}))
    fireEvent.click(screen.getByRole('radio',{name:/수능완성 영어/}))
    expect((screen.getByRole('radio',{name:'전체'}) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('radio',{name:'상'})).toBeNull()
    fireEvent.click(screen.getByRole('radio',{name:'실전편'}))
    expect((screen.getByRole('radio',{name:'실전편'}) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/학년도 수능완성 영어 · 실전편/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('예: 수능특강 영어 상')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true)
  })
  it('has a single registration history and displays the existing exam form with its explanation upload',async()=>{
    show(<RegistrationPanel documentId={null} onOpenBook={vi.fn()} onOpenMaterial={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio',{name:'기출'}))
    expect(await screen.findByRole('region',{name:'기출 PDF 등록'})).toBeTruthy()
    expect(screen.getAllByText('통합 처리 내역')).toHaveLength(1)
    expect(screen.getByRole('button',{name:'일괄 해설 등록'})).toBeTruthy()
    expect(screen.getByRole('button',{name:/해설 PDF/})).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
