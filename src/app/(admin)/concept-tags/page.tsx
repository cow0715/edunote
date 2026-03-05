import { ConceptTagManager } from '@/components/concept-tags/concept-tag-manager'

export default function ConceptTagsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">문제 유형</h1>
        <p className="mt-1 text-sm text-gray-500">
          대분류와 소분류로 유형을 관리해요. 문제 세팅 시 유형을 지정하면 학생별 취약 유형 분석에 활용됩니다.
        </p>
      </div>
      <ConceptTagManager />
    </div>
  )
}
