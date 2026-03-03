import { ConceptTagManager } from '@/components/concept-tags/concept-tag-manager'

export default function ConceptTagsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">개념 태그 관리</h1>
        <p className="mt-1 text-sm text-gray-500">
          시험 문항의 선택지별 개념을 대분류/소분류로 관리해요. 채점 후 학생별 취약 개념 분석에 활용됩니다.
        </p>
      </div>
      <ConceptTagManager />
    </div>
  )
}
