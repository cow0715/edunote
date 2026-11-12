'use client'

import { createContext, useContext } from 'react'
import { compressImageForUpload } from '@/lib/image-compress'
import { captureDraft } from '@/lib/capture-draft'

/** I/O boundary shared by the production UI and the isolated development preview. */
export type CaptureRuntime = {
  request: typeof fetch
  compress: typeof compressImageForUpload
  draft: typeof captureDraft
  pickFiles?: (multiple: boolean) => Promise<File[]>
  getMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  captureFile?: () => Promise<File>
}
const production: CaptureRuntime = {
  request: (...args) => fetch(...args), compress: compressImageForUpload, draft: captureDraft,
}
const CaptureContext = createContext<CaptureRuntime>(production)
export const CaptureRuntimeProvider = CaptureContext.Provider
export const useCaptureRuntime = () => useContext(CaptureContext)
