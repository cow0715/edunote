// Isolated preview using synthetic records; no backend, student data or model calls.
// Run with: node scripts/preview-share-analysis.mjs
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const out = path.join(os.tmpdir(), 'edunote-share-analysis-preview')
await mkdir(out, { recursive: true })
await build({ entryPoints: ['tests/fixtures/share-analysis-preview.tsx'], outfile: path.join(out, 'preview.js'), bundle: true, jsx: 'automatic', platform: 'browser', alias: { '@': path.join(root, 'src') } })
const result = await postcss([tailwind({ base: root })]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.join(root, 'src/app/globals.css') })
await writeFile(path.join(out, 'preview.css'), result.css)
const html = `<!doctype html>
<html lang="ko" style="--font-geist: sans-serif">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>EduNote · 분석 탭 전체 시안</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="/preview.css">
</head>
<body>
  <div id="root"></div>
  <script src="/preview.js"></script>
</body>
</html>`
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  if (request.url === '/preview.js' || request.url === '/preview.css') {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(await readFile(path.join(out, request.url.slice(1))))
  } else if (request.url === '/favicon.ico') {
    response.writeHead(204).end()
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(html)
  }
})
server.listen(3108, '127.0.0.1', () => console.log('Analysis preview: http://127.0.0.1:3108/?sample=compare&theme=light'))
process.on('SIGINT', () => server.close(() => process.exit(0)))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
