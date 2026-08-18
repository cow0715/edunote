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
    // lib/anthropic.ts 가 모듈 로드 시점에 Anthropic 클라이언트를 생성하므로
    // 키가 없으면 import 단계에서 throw 한다. 실제 호출은 하지 않으므로 더미 값.
    env: {
      ANTHROPIC_API_KEY: 'test-dummy-key',
    },
  },
})
