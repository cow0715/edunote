import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 에이전트 작업용 git worktree 사본 — 원본 src를 그대로 복제하므로
    // 린트하면 같은 문제가 사본 수만큼 중복 보고된다.
    ".claude/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
