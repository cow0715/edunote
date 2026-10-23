// Keep textbook imports and instanceof checks compatible with the shared transport.
export {
  PDF_BATCH_REQUEST_ATTEMPTS as BOOK_BATCH_REQUEST_ATTEMPTS,
  PDF_BATCH_POLL_SECONDS as BOOK_BATCH_POLL_SECONDS,
  PDF_BATCH_MAX_BYTES as BOOK_BATCH_MAX_BYTES,
  PDF_BATCH_MODE as BOOK_BATCH_MODE,
  PdfBatchPending as BookBatchPending,
  PdfBatchRequestFailed as BookBatchRequestFailed,
  PdfBatchStopped as BookBatchStopped,
  retryableBatchResult,
} from '../pdf-import/batch-policy'
