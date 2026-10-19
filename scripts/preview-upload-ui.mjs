// Isolated component preview: no auth, backend, student records or model calls.
// Run with: node scripts/preview-upload-ui.mjs
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd()
const out = path.join(os.tmpdir(), 'edunote-upload-ui-preview')
await mkdir(out, { recursive: true })
await build({ entryPoints: ['tests/fixtures/upload-ui-preview.tsx'], outfile: path.join(out, 'preview.js'), bundle: true, jsx: 'automatic', platform: 'browser', alias: { '@': path.join(root, 'src') } })
const result = await postcss([tailwind({ base: root })]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.join(root, 'src/app/globals.css') })
await writeFile(path.join(out, 'preview.css'), result.css)
const html = '<!doctype html><html class="dark" lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EduNote 업로드 UI 검토</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>'
createServer(async (request, response) => {
  if (request.url === '/preview.js' || request.url === '/preview.css') {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(await readFile(path.join(out, request.url.slice(1))))
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(html)
  }
}).listen(3107, '127.0.0.1', () => console.log('UI preview: http://127.0.0.1:3107'))
