import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler: 컴포넌트/훅을 자동 메모이즈해 상위 state 변경 시 불필요한 리렌더를 막는다.
  // 프로젝트 전반에 수동 memo 가 거의 없어(React.memo 4개) 효과가 크다. 단 계산량 자체를 줄이진 않으므로
  // 무거운 파생 계산은 여전히 useMemo 로 묶어야 한다. 린트의 react-compiler 경고가 뜬 컴포넌트는 최적화에서 제외된다.
  reactCompiler: true,
  serverExternalPackages: [
    '@napi-rs/canvas',
    '@napi-rs/canvas-win32-x64-msvc',
    'pdfjs-dist',
    'sharp',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};

export default nextConfig;
