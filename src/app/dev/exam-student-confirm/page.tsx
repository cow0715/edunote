import { notFound } from 'next/navigation'
import { ExamStudentConfirmPreview } from './preview'

export default function ExamStudentConfirmPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <ExamStudentConfirmPreview />
}
