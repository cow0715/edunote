/** 링크 자체의 문제와 일시적인 조회 실패를 구분한다. */
export function shareErrorMessage(status: number | undefined) {
  if (status === 410) return {
    title: '링크가 만료되었습니다', hint: '가장 최근에 받으신 문자의 링크로 접속해 주세요.', retryable: false,
  }
  if (status === 403) return {
    title: '공유가 종료되었습니다', hint: '자세한 내용은 선생님께 문의해 주세요.', retryable: false,
  }
  if (status === 404 || status === 400) return {
    title: '리포트를 찾을 수 없습니다', hint: '문자의 링크가 정확한지 확인해 주세요.', retryable: false,
  }
  return {
    title: '리포트를 불러오지 못했어요', hint: '연결 상태를 확인한 뒤 다시 시도해 주세요.', retryable: true,
  }
}
