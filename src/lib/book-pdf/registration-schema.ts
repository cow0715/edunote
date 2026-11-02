import { z } from 'zod'
import { BOOK_CODES, BOOK_VOLUMES, validBookVolume } from './catalog'

const fields = {
  bookCode: z.enum(BOOK_CODES), academicYear: z.number().int().min(1900).max(2200), volume: z.enum(BOOK_VOLUMES),
}
const compatible = (value: {bookCode: string; volume: typeof BOOK_VOLUMES[number]}) => validBookVolume(value.bookCode, value.volume)
export const bookClassificationSchema = z.object(fields).refine(compatible, { path: ['volume'], message: '교재에 맞는 분권을 선택해주세요.' })
export const bookUploadSchema = z.object({ ...fields,
  fileName: z.string().min(1).max(500).regex(/\.pdf$/i), storagePath: z.string().min(1).max(1000),
}).refine(compatible, { path: ['volume'], message: '교재에 맞는 분권을 선택해주세요.' })
export const bookBundleSchema = z.object({ requestKey: z.string().uuid(), files: z.array(bookUploadSchema).min(1).max(4) })
