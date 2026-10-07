import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // tsconfig.json 의 paths({ "@/*": ["./src/*"] })와 같은 별칭.
    // vite-tsconfig-paths 는 ESM 전용이라 CJS 설정 파일에서 못 읽어서 직접 지정한다.
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  test: {
    environment: 'node',
    // tests/unit 만 포함 — scripts/test-parse.ts 같은 LLM 호출(유료) 하네스는 제외
    // 컴포넌트 테스트(.tsx)는 파일 맨 위 `// @vitest-environment jsdom` 로 환경을 바꾼다.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // 설정된 작업 경로를 검사할 때 쓰는 더미 키. LLM 응답은 테스트별로 모의 처리한다.
    // JSON 처리/설정 모듈의 import에는 API 키가 필요하지 않다.
    env: {
      ANTHROPIC_API_KEY: 'test-dummy-key',
    },
  },
})
