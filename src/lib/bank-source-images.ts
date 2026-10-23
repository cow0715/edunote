import { locateQuestionRegion } from './pdf-question-region'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExamBankParsedQuestion } from './llm/exam-bank'
import { needsVisualSource } from './source-region'
import { storeSourceRegions } from './source-image-storage'
export async function saveBankSourceImages(client: SupabaseClient, bankId: string, pdf: string, questions: ExamBankParsedQuestion[]) {
  for (const question of questions.filter(needsVisualSource)) {
    const region=await locateQuestionRegion(pdf,question.question_number,question.source_page ?? null,question.source_bbox ?? null)
    const images = await storeSourceRegions(client,pdf,`source-images/bank/${bankId}/${question.question_number}`,
      [region])
    const {error} = await client.from('exam_bank_question').update({source_images:images}).eq('exam_bank_id',bankId).eq('question_number',question.question_number)
    if(error) throw Error(error.message)
  }
}
