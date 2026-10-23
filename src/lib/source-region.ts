export type SourceRegion = { x: number; y: number; width: number; height: number }
export type SourceImage = { path: string; page: number; bbox: SourceRegion | null }
export function validSourceRegion(value: unknown): value is SourceRegion {
  if (!value || typeof value !== 'object') return false
  const b = value as SourceRegion
  return [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1.001 && b.y + b.height <= 1.001
}
export function regionPixels(b: SourceRegion, width: number, height: number) {
  if (!validSourceRegion(b)) throw Error('원본 영역 좌표가 올바르지 않습니다.')
  // A small fixed safety margin prevents clipping glyph edges without including the neighboring column.
  const pad = Math.min(8, Math.round(Math.min(width,height) * 0.008))
  const left = Math.max(0, Math.floor(b.x * width) - pad), top = Math.max(0, Math.floor(b.y * height) - pad)
  return { left, top, width: Math.min(width, Math.ceil((b.x+b.width)*width)+pad)-left,
    height: Math.min(height, Math.ceil((b.y+b.height)*height)+pad)-top }
}
export function needsVisualSource(q: { needs_source_image?: boolean; question_type?: string; question_text?: string }) {
  return q.needs_source_image === true || q.question_type === 'chart' || /도표|그래프|그림|지도|표를|표의/.test(q.question_text ?? '')
}
