import { QuestionTypeManager } from '@/components/question-types/question-type-manager'

export default function QuestionTypesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">문제 유형</h1>
        <p className="mt-1 text-sm text-gray-500">시험 문항에 태깅할 유형을 관리합니다</p>
      </div>
      <div className="max-w-md">
        <QuestionTypeManager />
      </div>
    </div>
  )
}
