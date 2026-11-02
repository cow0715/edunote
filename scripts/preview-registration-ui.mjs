// Local visual QA only: fake environment, GET-only server, no writable backend.
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import os from 'node:os'

const root = process.cwd(), out = path.join(os.tmpdir(), 'edunote-registration-ui-preview')
await mkdir(out, { recursive: true })
await build({ entryPoints: ['tests/fixtures/registration-ui-preview.tsx'], outfile: path.join(out, 'preview.js'), bundle: true, jsx: 'automatic', platform: 'browser', alias: { '@': path.join(root, 'src') }, define: { 'process.env.NEXT_PUBLIC_SUPABASE_URL': '"http://127.0.0.1:3111"', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"preview-only"' } })
const result = await postcss([tailwind({ base: root })]).process(await readFile('src/app/globals.css', 'utf8'), { from: path.join(root, 'src/app/globals.css') })
await writeFile(path.join(out, 'preview.css'), result.css)
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EduNote 등록 화면 검토</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>'
createServer(async (request, response) => {
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (request.url === '/preview.js' || request.url === '/preview.css') {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(await readFile(path.join(out, request.url.slice(1))))
  } else if (request.url?.startsWith('/api/') || request.url === '/favicon.ico') { response.writeHead(404); response.end() }
  else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html) }
}).listen(3111, '127.0.0.1', () => console.log('Registration UI preview: http://127.0.0.1:3111'))
