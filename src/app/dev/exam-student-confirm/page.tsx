import { notFound } from 'next/navigation'
import { ExamStudentConfirmPreview } from './preview'

export default async function ExamStudentConfirmPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <ExamStudentConfirmPreview review={(await searchParams).review === '1'} />
}
