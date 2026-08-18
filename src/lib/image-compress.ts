// ── 브라우저 이미지 압축 (업로드 전) ───────────────────────────────────────
// 시험지 사진은 폰 원본(3~6MB, 4000px)이 그대로 올라가 Storage 를 빠르게 채웠다.
// 긴 변 1600px · JPEG 80% 로 줄이면 200~400KB(약 1/15). OCR 정확도는 1000px 까지 34/34 로 동일했다
// (2026-08-18, 폰트 손글씨 기준 — 실전에서 흐린 사진이 오독되면 MAX_LONG_EDGE 를 2000 으로 올릴 것).
// PDF 는 그대로 통과. Canvas API 만 쓰므로 의존성 없음.

export const IMAGE_COMPRESS_MAX_LONG_EDGE = 1600
export const IMAGE_COMPRESS_JPEG_QUALITY = 0.8

export type CompressedImage = {
  /** base64 (data: 접두어 없음) */
  base64: string
  mimeType: string
  /** 압축 전/후 바이트 (로그·표시용) */
  originalBytes: number
  bytes: number
  width: number
  height: number
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * 이미지 파일을 긴 변 maxLongEdge 이하 JPEG 로 압축해 base64 로 돌려준다.
 * - PDF/비이미지: 원본 그대로 base64
 * - 이미 작으면(긴 변 ≤ max 이고 파일이 400KB 이하) 원본 그대로 (재인코딩 손실 방지)
 * - EXIF 회전은 브라우저가 <img> 디코딩 시 이미 적용(image-orientation: from-image 기본)하므로 별도 처리 없음
 */
export async function compressImageForUpload(
  file: File,
  opts: { maxLongEdge?: number; quality?: number } = {},
): Promise<CompressedImage> {
  const maxLongEdge = opts.maxLongEdge ?? IMAGE_COMPRESS_MAX_LONG_EDGE
  const quality = opts.quality ?? IMAGE_COMPRESS_JPEG_QUALITY
  const originalBytes = file.size

  const passthrough = async (): Promise<CompressedImage> => {
    const dataUrl = await readAsDataUrl(file)
    return { base64: dataUrl.split(',')[1] ?? '', mimeType: file.type || 'application/octet-stream', originalBytes, bytes: file.size, width: 0, height: 0 }
  }

  if (!file.type.startsWith('image/')) return passthrough()

  const dataUrl = await readAsDataUrl(file)
  let img: HTMLImageElement
  try {
    img = await loadImage(dataUrl)
  } catch {
    // 디코딩 실패(HEIC 등 브라우저 미지원)면 원본 그대로 — 서버/OCR 쪽에서 처리 시도
    return passthrough()
  }

  const { naturalWidth: w, naturalHeight: h } = img
  const longEdge = Math.max(w, h)
  if (longEdge <= maxLongEdge && file.size <= 400 * 1024) {
    return { base64: dataUrl.split(',')[1] ?? '', mimeType: file.type, originalBytes, bytes: file.size, width: w, height: h }
  }

  const scale = Math.min(1, maxLongEdge / longEdge)
  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return passthrough()
  // 흰 배경 — PNG 투명 영역이 JPEG 에서 검게 되는 것 방지
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)

  const outDataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64 = outDataUrl.split(',')[1] ?? ''
  const bytes = Math.round((base64.length * 3) / 4)
  return { base64, mimeType: 'image/jpeg', originalBytes, bytes, width, height }
}
