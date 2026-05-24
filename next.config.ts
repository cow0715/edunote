import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
