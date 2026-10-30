import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeFixture } from '../fixtures/book-native'
import { pdfBytes, pdfHash } from '../fixtures/book-pdf'
import { bookProofMatches } from '@/lib/book-pdf/proof'
const mocks = vi.hoisted(() => ({ read:vi.fn(),render:vi.fn(),call:vi.fn() }))
vi.mock('@/lib/book-pdf/layout-source', () => ({readLayoutSource:mocks.read}))
vi.mock('@/lib/book-pdf/render-source', () => ({renderBookSourceImages:mocks.render}))
vi.mock('@/lib/llm/client', async (original) => ({...await original<typeof import('@/lib/llm/client')>(),callLlmTextDetailed:mocks.call}))
import { processNativeBookUnit } from '@/lib/book-pdf/native-pipeline'
const response = (value:unknown) => ({text:JSON.stringify(value),stopReason:'end_turn',usage:{inputTokens:1,outputTokens:1,cacheReadTokens:0,cacheWriteTokens:0}})
let f=nativeFixture()
beforeEach(() => {
  vi.clearAllMocks();f=nativeFixture();mocks.read.mockResolvedValue(f.pages);mocks.render.mockResolvedValue(f.images)
  mocks.call.mockResolvedValueOnce(response(f.mapping)).mockResolvedValueOnce(response({status:'pass',checks:{content:true,mapping:true,formatting:true,inventory:true},issues:[],repair:null}))
})
describe('real mapping/audit/enrichment adapters connected inside the worker unit', () => {
  it('produces a valid publication proof through all three adapters without re-outputting original text in mapping', async () => {
    mocks.call.mockResolvedValueOnce(response({questions:f.enrichment.questions}))
    const r=await processNativeBookUnit({unit:f.unit,pdfHash,bytes:pdfBytes})
    expect(bookProofMatches({...r,manifest:f.unit,version:1,verified_version:1})).toBe(true)
    expect(mocks.call).toHaveBeenCalledTimes(3)
    const mapRequest=JSON.parse(mocks.call.mock.calls[0][0].content.at(-1).text),auditRequest=JSON.parse(mocks.call.mock.calls[1][0].content.at(-1).text),enrichRequest=JSON.parse(mocks.call.mock.calls[2][0].content.at(-1).text)
    expect(mapRequest.targets[0].key).toBe('1:exercise:1')
    expect(auditRequest.operation).toBe('source_audit')
    expect(enrichRequest.source.questions[0].solution).toBe('원문 해설')
    expect(r.extraction?.questions[0].solution).toBe('원문 해설')
    expect(r.enrichment?.questions[0].solution).toBe('추가 설명')
  })
  it('withholds publication when enrichment attempts to replace a source answer', async () => {
    mocks.call.mockResolvedValue(response({questions:[{...f.enrichment.questions[0],answer:5}]}))
    const r=await processNativeBookUnit({unit:f.unit,pdfHash,bytes:pdfBytes})
    expect(r.verification.status).toBe('unresolved');expect(r.enrichment).toBeNull()
    expect(r.extraction?.questions[0].answer).toBe(2)
  })
  it('sends mapped decoding concerns to image repair and requires a fresh pass', async () => {
    mocks.call.mockReset()
    f.mapping.issues = ['PDF.js text contains invisible letters.']
    const expectedPassage = f.pages[0].lines[0].text
    f.pages[0].lines[0].text += ' invisiblejunk'
    const target = {g:0,q:null,field:'passage',choice:null}
    mocks.call.mockResolvedValueOnce(response(f.mapping))
      .mockImplementationOnce(async (options) => response({status:'repair',checks:{content:false,mapping:true,formatting:true,inventory:true},
        issues:[{target,kind:'native_text',pages:[9],reason:'Extra native letters absent from image.'}],
        repair:{base_hash:JSON.parse(options.content.at(-1).text).candidate_hash,
          edits:[{target,mode:'patch',patches:[{before:' invisiblejunk',after:''}],pages:[9]}],issues:[]}}))
      .mockResolvedValueOnce(response({status:'pass',checks:{content:true,mapping:true,formatting:true,inventory:true},issues:[],repair:null}))
      .mockResolvedValueOnce(response({questions:f.enrichment.questions}))
    const result = await processNativeBookUnit({unit:f.unit,pdfHash,bytes:pdfBytes})
    expect(result.verification.status).toBe('passed')
    expect(result.extraction?.passage).not.toContain('invisiblejunk')
    expect(result.extraction?.passage).toBe(expectedPassage)
    expect(result.verification.audit?.rounds).toBe(2)
    expect(mocks.call).toHaveBeenCalledTimes(4)
    const auditRequest=JSON.parse(mocks.call.mock.calls[1][0].content.at(-1).text)
    expect(auditRequest.mapping.issues).toEqual(f.mapping.issues)
  })
})
