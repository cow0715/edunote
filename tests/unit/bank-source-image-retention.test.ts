import {describe,it,expect,vi} from 'vitest'
const {parse}=vi.hoisted(()=>({parse:vi.fn(async()=>({items:[{question_number:25,question_type:'chart',passage:'',question_text:'다음 도표',choices:['A','B'],answer:'1'}],calls:[],skippedNumbers:[]}))}))
vi.mock('@/lib/llm/ranged',()=>({sliceNumbers:()=>[[25]],prewarmPdfCache:async()=>({}),rangedParseCallIsolated:parse}))
import {parseExamBankPageRanged} from '@/lib/llm/exam-bank'
describe('bank chart retention',()=>{it('does not silently discard the parsed chart shell',async()=>{const result=await parseExamBankPageRanged('fixture','application/pdf');expect(result.items.map(q=>q.question_number)).toEqual([25])})})
