import { notFound } from 'next/navigation'
import { DuplexAnswerSheetPreview, ExamStudentConfirmPreview } from './preview'

export default async function ExamStudentConfirmPage({ searchParams }: { searchParams: Promise<{ duplex?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (await searchParams).duplex === '1' ? <DuplexAnswerSheetPreview /> : <ExamStudentConfirmPreview />
}
