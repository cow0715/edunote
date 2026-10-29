// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BookUploadForm} from '@/components/exam-bank/book-upload-form'
import {RegistrationPanel} from '@/components/exam-bank/registration-panel'
vi.mock('@/components/pdf-import/job-list',()=>({PdfImportJobList:()=> <div>통합 처리 내역</div>}))
vi.mock('@/components/exam-bank/book-import-panel',()=>({BookResult:({id}:{id:string})=><div>교재 결과 {id}</div>}))
const m=vi.hoisted(()=>({client:vi.fn(),pdf:vi.fn()}))
vi.mock('@/lib/supabase/client',()=>({createClient:m.client}))
vi.mock('pdf-lib',()=>({PDFDocument:{load:m.pdf}}))
let client:QueryClient
beforeEach(()=>{vi.clearAllMocks();m.pdf.mockResolvedValue({getPageCount:()=>108});client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});vi.stubGlobal('fetch',vi.fn(async()=>Response.json({enabled:true,documents:[]})))})
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals()})
function show(node:React.ReactNode){return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)}
function choose(name:string,label='교재 원본 PDF 선택'){
  const file=new File(['fixture'],name,{type:'application/pdf'})
  Object.defineProperty(file,'arrayBuffer',{value:async()=>new ArrayBuffer(1)})
  fireEvent.change(screen.getByLabelText(label,{selector:'input'}),{target:{files:[file]}})
}
describe('unified registration UI',()=>{
  it('starts with the book form and separates history after registration controls',async()=>{
    show(<RegistrationPanel documentId={null} onOpenBook={vi.fn()} onOpenMaterial={vi.fn()} />)
    expect((screen.getByRole('radio',{name:'교재'}) as HTMLInputElement).checked).toBe(true)
    const upload=await screen.findByRole('region',{name:'교재 PDF 등록'})
    expect(upload.textContent).toContain('파일당 최대 $5')
    const history=screen.getByRole('region',{name:'등록 및 처리 내역'})
    expect(upload.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('combobox',{name:'교재'})).toBeTruthy()
    expect(screen.queryByRole('radio',{name:/수능특강/})).toBeNull()
    expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect(m.client).not.toHaveBeenCalled()
  })
  it('enables verified reading and Suwan PDF selection with compatible volume choices',async()=>{
    show(<BookUploadForm onRegistered={vi.fn()} />)
    expect(await screen.findByRole('option',{name:'수능특강 영어독해연습'})).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox',{name:'교재'}),{target:{value:'suteuk_reading'}})
    expect((screen.getByRole('button',{name:'교재 원본 PDF 선택'}) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button',{name:'교재 원본 PDF 선택'}) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByRole('combobox',{name:'분권'}),{target:{value:'upper'}})
    fireEvent.change(screen.getByRole('combobox',{name:'교재'}),{target:{value:'suwan_english'}})
    expect((screen.getByRole('option',{name:'전체'}) as HTMLOptionElement).selected).toBe(true)
    expect(screen.queryByRole('option',{name:'상'})).toBeNull()
    fireEvent.change(screen.getByRole('combobox',{name:'분권'}),{target:{value:'practical'}})
    expect((screen.getByRole('option',{name:'실전편'}) as HTMLOptionElement).selected).toBe(true)
    expect(screen.getByText(/학년도 수능완성 영어 · 실전편/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('예: 수능특강 영어 상')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true)
  })
  it.each([
    ['수능영독(상).pdf','수능특강 영어독해연습','상'], ['수특영독(하).pdf','수능특강 영어독해연습','하'],
    ['수완(유형).pdf','수능완성 영어','유형편'], ['수완(실전).pdf','수능완성 영어','실전편'],
  ])('selects %s locally and never registers merely on file selection',async(name,code,volume)=>{
    show(<BookUploadForm onRegistered={vi.fn()} />)
    choose(name)
    await waitFor(()=>expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByRole('option',{name:code}) as HTMLOptionElement).selected).toBe(true)
    expect((screen.getByRole('option',{name:volume}) as HTMLOptionElement).selected).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('등록 준비 완료')
    expect(m.client).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true)
  })
  it('blocks a changed mismatching volume before upload and explains why',async()=>{
    show(<BookUploadForm onRegistered={vi.fn()} />);choose('수완(실전).pdf')
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('등록 준비 완료'))
    fireEvent.change(screen.getByRole('combobox',{name:'분권'}),{target:{value:'type'}})
    expect(screen.getByRole('alert').textContent).toContain('분권이 다릅니다')
    expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect(m.client).not.toHaveBeenCalled()
  })
  it('preserves local book selections when switching material kind',async()=>{
    show(<RegistrationPanel documentId={null} onOpenBook={vi.fn()} onOpenMaterial={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio',{name:'교재'}));choose('수특영독(하).pdf')
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('등록 준비 완료'))
    fireEvent.click(screen.getByRole('radio',{name:'기출'}))
    expect((screen.getByRole('button',{name:'기출 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio',{name:'교재'}))
    expect((screen.getByRole('option',{name:'하'}) as HTMLOptionElement).selected).toBe(true)
    expect(screen.getByText('수특영독(하).pdf')).toBeTruthy()
    expect((screen.getByRole('button',{name:'교재 등록 시작'}) as HTMLButtonElement).disabled).toBe(false)
    expect(m.client).not.toHaveBeenCalled()
  })
  it('requires the question file even when an explanation file is selected, and clears it safely',async()=>{
    show(<RegistrationPanel documentId={null} onOpenBook={vi.fn()} onOpenMaterial={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio',{name:'기출'}))
    choose('해설.pdf','해설 PDF 선택')
    expect((screen.getByRole('button',{name:'기출 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    choose('문제.pdf','시험지 파일 선택')
    expect((screen.getByRole('button',{name:'기출 등록 시작'}) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button',{name:'시험지 파일 선택 선택 해제'}))
    expect((screen.getByRole('button',{name:'기출 등록 시작'}) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('해설.pdf')).toBeTruthy()
    expect(m.client).not.toHaveBeenCalled()
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
