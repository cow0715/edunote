'use client'
import type { ExamBankQuestion } from './types'
import { SourceImagePreview } from '@/components/grade/source-image-preview'
export function BankSourceImages({question}:{question:ExamBankQuestion}) {
  return <div className="space-y-2">{(question.source_images ?? []).map((image,index)=><SourceImagePreview key={image.path}
    question={{source_image_path:image.path,source_page:image.page,needs_source_image:true}}
    signedUrlEndpoint={`/api/exam-bank/questions/${question.id}/source-image-url?index=${index}`} />)}</div>
}
