import type { CaptureRuntime } from '@/components/grade/capture-runtime'
import { compressImageForUpload } from '@/lib/image-compress'
import type { CapturePhoto } from '@/lib/capture-draft'

export const sampleStudents = [
  { student_id: 'sample-dayoung', student_name: '김대영', present: true, hasExisting: false },
  { student_id: 'sample-minseong', student_name: '김민성', present: true, hasExisting: false },
]
export const sampleWeek = 'sample-week'

export function samplePhoto(name: string, subject = '독해') {
  const words = ['apple　사과', 'bright　밝은', 'decide　결정하다', 'earth　지구', 'friend　친구']
  const rows = Array.from({ length: 10 }, (_, index) => `<text x="45" y="${175 + index * 46}" font-size="15">${index + 1}　${subject === '단어' ? words[index % words.length] : '①　②　③　④　⑤'}</text><path d="M40 ${190 + index * 46}H565" stroke="#e5e8eb"/>`).join('')
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840"><rect width="600" height="840" fill="#fff"/><text x="40" y="46" font-family="sans-serif" font-size="19" font-weight="700" fill="#191f28">EduNote · ${subject} 답안지</text><text x="365" y="88" font-family="sans-serif" font-size="17" fill="#6b7684">이름</text><text x="414" y="90" font-family="cursive" font-size="29" fill="#234576" transform="rotate(-3 414 90)">${name}</text><path d="M410 101H560" stroke="#8b95a1"/><path d="M40 125H565" stroke="#191f28"/><g fill="#4e5968" font-family="sans-serif">${rows}</g></svg>`)}`
}

/** No fallback to fetch, media devices, localStorage or IndexedDB. */
export function createSampleCaptureRuntime(subject: '독해' | '단어', individualId?: string): CaptureRuntime {
  const drafts = new Map<string, CapturePhoto[]>()
  const names = new Map<string, string>()
  let nextPhoto = 0, revision = 0
  let cameraCanvas: HTMLCanvasElement | null = null
  const currentStudent = () => individualId ?? sampleStudents[nextPhoto % sampleStudents.length].student_id
  const fileFor = (id: string) => {
    const student = sampleStudents.find((entry) => entry.student_id === id)!
    const svg = decodeURIComponent(samplePhoto(student.student_name, subject).split(',')[1])
    return new File([svg], `${id}-${subject}.svg`, { type: 'image/svg+xml' })
  }
  async function drawCamera() {
    if (!cameraCanvas) return
    const student = sampleStudents.find((entry) => entry.student_id === currentStudent())!
    const image = new Image()
    image.src = samplePhoto(student.student_name, subject)
    await image.decode()
    cameraCanvas.getContext('2d')?.drawImage(image, 0, 0, 600, 840)
  }
  return {
    draft: async (key, photos) => {
      if (photos !== undefined) drafts.set(key, photos)
      return drafts.get(key) ?? []
    },
    pickFiles: async (multiple) => multiple ? sampleStudents.map((entry) => fileFor(entry.student_id)) : [fileFor(currentStudent())],
    getMedia: async () => {
      cameraCanvas = document.createElement('canvas')
      cameraCanvas.width = 600; cameraCanvas.height = 840
      await drawCamera()
      return cameraCanvas.captureStream(1)
    },
    captureFile: async () => {
      const file = fileFor(currentStudent())
      nextPhoto++
      await drawCamera()
      return file
    },
    compress: async (file, options) => {
      const id = sampleStudents.find((entry) => file.name.startsWith(entry.student_id))?.student_id
      if (!id) throw new Error('이 화면은 생성된 샘플 사진만 사용합니다.')
      const compressed = await compressImageForUpload(file, options)
      names.set(compressed.base64, id)
      return compressed
    },
    request: async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/vocab-photo-url?')) {
        const path = new URL(url, 'http://sample.invalid').searchParams.get('path') ?? ''
        const student = sampleStudents.find((entry) => path.includes(entry.student_id))
        return Response.json({ url: samplePhoto(student?.student_name ?? '샘플 학생', subject) })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { fileData?: string; studentId?: string; grade_version?: { revision: number }; items?: { number: number; student_answer: string }[] }
      const id = body.studentId ?? names.get(body.fileData ?? '')
      const student = sampleStudents.find((entry) => entry.student_id === id)
      if (url === `/api/weeks/${sampleWeek}/vocab-photo-name` && student) {
        return Response.json({ studentId: student.student_id, rawName: student.student_name, confidence: 'high' })
      }
      if (url === `/api/weeks/${sampleWeek}/ocr-exam-photo` && student) {
        return Response.json({ ok: true, photoPath: `${sampleWeek}/${student.student_id}/sample-photo`,
          results: Array.from({ length: 10 }, (_, index) => ({ question_number: index + 1, sub_label: null, student_answer: index % 5 + 1 })) })
      }
      if (url === `/api/weeks/${sampleWeek}/grade-vocab-photo` && student) {
        return Response.json({ ok: true, vocab_correct: 9, vocab_total: 10, missing_numbers: [],
          results: Array.from({ length: 10 }, (_, index) => ({ number: index + 1, english_word: 'sample', student_answer: '샘플 답', is_correct: index < 9 })) })
      }
      if (url === '/api/vocab-answer' && individualId) {
        return Response.json({ ok: true, versions: [{ student_id: individualId, score_id: `score-${individualId}`, revision: ++revision }], results: body.items ?? [] })
      }
      return Response.json({ error: '샘플 화면에서 허용하지 않는 요청입니다.' }, { status: 400 })
    },
  }
}
