import {describe,it,expect} from 'vitest'
import {regionPixels, validSourceRegion, needsVisualSource} from '@/lib/source-region'
import {questionRegionFromPage,sourceTextMatches} from '@/lib/pdf-question-region'
import {bookVisualRegions} from '@/lib/book-pdf/visual-regions'
import type {SourcePage,SourceMap} from '@/lib/book-pdf/source-map'
const line=(id:number,text:string,x:number,y:number)=>({id,text,x,y,width:120,height:12,page:1,marks:[]})
const page:SourcePage={page:1,width:600,height:800,issues:[],lines:[line(1,'25. 다음 도표',30,700),line(2,'① Choice',30,420),line(3,'26. Next question',30,350),line(4,'30. Right column',330,700)]}
describe('original source regions',()=>{
 it('keeps chart questions even with no text passage',()=>{expect(needsVisualSource({question_type:'chart',question_text:'도표'})).toBe(true)})
 it('rejects malformed coordinates and clamps padded pixel crops to the image',()=>{
  for(const b of [{x:NaN,y:0,width:1,height:1},{x:-1,y:0,width:1,height:1},{x:0,y:0,width:0,height:1}]) expect(validSourceRegion(b)).toBe(false)
  expect(regionPixels({x:0,y:0,width:1,height:1},100,200)).toEqual({left:0,top:0,width:100,height:200})
 })
 it('captures graphics between the stem and choices without the next question or other column',()=>{
  const b=questionRegionFromPage(page,25)!
  const withNumberedChoice={...page,lines:[...page.lines,line(6,'1. Not a question boundary',30,620)]}
  expect(questionRegionFromPage(withNumberedChoice,25)).toEqual(b)
  expect(b.x).toBe(0);expect(b.width).toBe(.5)
  expect(b.y).toBeLessThan((800-700)/800)
  expect(b.y+b.height).toBeLessThan((800-350)/800)
  expect(questionRegionFromPage({...page,lines:[...page.lines,line(5,'25. duplicate',330,300)]},25)).toBeNull()
 })
 it('keeps full width for a single-column diagnostic',()=>{expect(questionRegionFromPage({...page,lines:page.lines.slice(0,3)},25)?.width).toBe(1)})
 it('uses audited book references and retains a graph even when the graph has no text',()=>{
  const ref=(s:number)=>({s,e:s})
  const mapping:SourceMap={issues:[],ignored:[],groups:[{passage:[],visual:[],translation:[],vocabulary:[],questions:[{id:'1:gateway:1',type:'chart',label:[ref(1)],stem:[ref(1)],choices:[[ref(2)],[],[],[],[]],answer:[],intent:[],solution:[]}]}]}
  const regions=bookVisualRegions([page],mapping)
  expect(regions).toHaveLength(1);expect(regions[0].key).toBe('1:gateway:1')
  expect(regions[0].bbox.width).toBe(.5)
  expect(regions[0].bbox.height).toBeGreaterThan(.3)
 })
})

it('rejects an unrelated PDF even if a legacy page/bbox is structurally valid',()=>{
 expect(sourceTextMatches([page],['The desert tortoise has a simple solution for coping with extreme heat.'])).toBe(false)
 expect(sourceTextMatches([{...page,lines:[line(1,'The desert tortoise has a simple solution for coping with extreme heat.',30,700)]}],['The desert tortoise has a simple solution for coping with extreme heat.'])).toBe(true)
 expect(questionRegionFromPage({...page,lines:page.lines.map(l=>({...l,text:l.text.replace('25.','25번')}))},25)).not.toBeNull()
})
