import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/pdf-worker.ts'],
  outfile: 'build/pdf-worker.cjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
})
