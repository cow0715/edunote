import path from 'node:path'
import { defineConfig } from 'vitest/config'

// API 하네스 전용 설정. `npm run check` 의 유닛테스트와 분리한다 —
// 이쪽은 개발 서버와 개발 DB가 살아있어야 돌기 때문에 CI 성격의 게이트로 쓸 수 없다.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    // 같은 개발 DB/서버를 두드리므로 파일 간 병렬 실행을 끈다.
    fileParallelism: false,
    // 개발 서버 첫 요청은 라우트 컴파일 때문에 느리다.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
