import { describe, expect, it } from 'vitest'
import { mapBookProfile, bookUnitProfile } from '@/lib/book-pdf/profiles'
import { resolveSourceMap, type SourcePage } from '@/lib/book-pdf/source-map'
import type { BookUnitManifest } from '@/lib/book-pdf/types'
function fixture(kind: 'chapter'|'mini_test'|'type'|'practical'='chapter') {
  const key=kind==='chapter'?'reading:chapter:1:1':kind==='mini_test'?'reading:mini_test:1:1':kind==='type'?'suwan:type:1:practice:1':'suwan:practical:1:18'
  const number=kind==='practical'?18:1,label=kind==='chapter'?'[수능특강(영독) 1강 1번]':kind==='mini_test'?'[수능특강(영독) Mini Test 1회 1번]':kind==='type'?'[수능완성(유형편) 1강 Practice]':'[수능완성(실전편) 1회 18번]'
  const p:SourcePage={page:2,width:600,height:840,issues:[],lines:[]}
  let id=1
  const add=(text:string,x:number,y:number)=>p.lines.push({id:id++,page:2,x,y,width:140,height:10,text,marks:[]})
  add(label,180,786);add(`${number} 다음 글의 목적으로 가장 적절한 것은?`,48,770);add('Original sentence.',58,740)
  p.lines.at(-1)!.marks=[{start:0,end:8,bold:true,underline:true}]
  for(let n=0;n<5;n++){add('①②③④⑤'[n],48,600-n*20);add(`choice ${n+1}`,58,600-n*20)}
  if(kind==='practical')add(label,306,786);else add(kind==='type'?'Practice':'Exercise 1',306,786)
  add('[정답]',306,760);add('②',336,760);add('[소재]',306,740);add('원문 소재',306,725)
  add('[해석]',306,700);add('원문 해석',306,680);add('[해설]',306,640);add('원문 풀이',306,620);add('[어휘]',306,580);add('\uF06F word 뜻',306,560);add('2',29,18)
  const unit:BookUnitManifest={key:'unit-1',order:1,pages:[2],questions:[{key,chapter:1,section:kind==='type'?'practice':'exercise',source_kind:kind,number,label,label_page:2,printed_answer:2}],left_text:'',right_text:'',translation:'',visual_required:false}
  return {p,unit}
}
describe('format-specific native textbook adapters',()=>{
  it.each(['chapter','mini_test','type','practical'] as const)('accounts for every character in %s without generating prose',kind=>{
    const {p,unit}=fixture(kind),result=mapBookProfile([p],unit)
    expect(result.reasons).toEqual([]);expect(result.mapping).not.toBeNull()
    const resolved=resolveSourceMap([p],result.mapping!)
    expect(resolved.errors).toEqual([]);expect(resolved.uncovered).toEqual([])
    expect(resolved.groups[0].extraction.passage).toBe('<strong><u>Original</u></strong> sentence.')
    expect(resolved.groups[0].extraction.questions[0]).toMatchObject({key:unit.questions[0].key,answer:2,solution:'원문 풀이',question_type:'purpose'})
    expect(resolved.groups[0].extraction.vocabulary).toBe('word 뜻')
    expect(result.mapping?.groups[0].questions).toHaveLength(1)
  })
  it('does not declare a missing heading or unassigned text to be safely parsed',()=>{
    const {p,unit}=fixture();p.lines=p.lines.filter(l=>l.text!=='[해설]')
    expect(mapBookProfile([p],unit).mapping).toBeNull()
    const other=fixture();other.p.lines.push({id:90,page:2,x:306,y:790,width:100,height:10,text:'Unrecognized heading',marks:[]})
    expect(mapBookProfile([other.p],other.unit).mapping).toBeNull()
  })
  it('holds unknown families and chart regions for targeted mapping instead of assigning guesswork',()=>{
    const {p,unit}=fixture();delete unit.questions[0].source_kind
    expect(bookUnitProfile(unit)).toBeNull();expect(mapBookProfile([p],unit).mapping).toBeNull()
    unit.questions[0].source_kind='chapter';unit.visual_required=true
    expect(mapBookProfile([p],unit).mapping).toBeNull()
  })
  it('keeps next-page text, footnotes and original data immutable',()=>{
    const {p,unit}=fixture(),original=structuredClone(p)
    unit.pages=[2,3]
    const next:SourcePage={page:3,width:600,height:840,issues:[],lines:[{id:100,page:3,x:58,y:700,width:120,height:10,text:'* footnote 뜻',marks:[]}]}
    const result=mapBookProfile([p,next],unit)
    expect(result.mapping).not.toBeNull()
    expect(resolveSourceMap([p,next],result.mapping!).groups[0].extraction.passage).toContain('* footnote 뜻')
    expect(p).toEqual(original)
  })
})
