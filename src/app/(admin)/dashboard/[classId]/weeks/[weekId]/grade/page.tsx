import { redirect } from 'next/navigation'

export default function GradePage({ params }: { params: Promise<{ classId: string; weekId: string }> }) {
  // 채점은 주차 상세 페이지 채점 탭으로 통합됨
  return params.then(({ classId, weekId }) => {
    redirect(`/dashboard/${classId}/weeks/${weekId}`)
  })
}
