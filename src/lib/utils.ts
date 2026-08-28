import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 번호 목록을 압축 표기로 (예: [36,37,38,44,50] → "36~38, 44, 50") — OCR 결손 경고 표시용 */
export function formatNumberRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1
    parts.push(j > i ? `${sorted[i]}~${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}
