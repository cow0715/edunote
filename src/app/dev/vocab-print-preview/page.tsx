'use client'

// 단독 라우트 — headless 캡처(`?tab=filled&bare=1`)와 로그인 없는 인쇄 확인이 이쪽을 쓴다.
// 'use client' 는 분리 전 page.tsx 와 같은 클라이언트 경계를 유지하려는 것 —
// 서버 컴포넌트로 두면 인쇄 시트의 styled-jsx 가 SSR 에서 클래스를 잃어 하이드레이션이 어긋난다.
// 같은 갤러리를 개발자 도구(/dev)의 「단어 화면」 탭에서도 embedded 로 렌더한다.
import VocabPrintPreview from './preview'

export default function VocabPrintPreviewPage() {
  return <VocabPrintPreview />
}
