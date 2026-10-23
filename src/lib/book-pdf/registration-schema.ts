import { z } from 'zod'
import { BOOK_CODES, BOOK_VOLUMES } from './catalog'

export const bookClassificationSchema = z.object({
  bookCode: z.enum(BOOK_CODES), academicYear: z.number().int().min(1900).max(2200), volume: z.enum(BOOK_VOLUMES),
})
export const bookUploadSchema = bookClassificationSchema.extend({
  fileName: z.string().min(1).max(500).regex(/\.pdf$/i), storagePath: z.string().min(1).max(1000),
})
