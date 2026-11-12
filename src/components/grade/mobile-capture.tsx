'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type CapturePhoto } from '@/lib/capture-draft'
import { useCaptureRuntime } from './capture-runtime'

type Photo = CapturePhoto & { url: string }

function createCaptureId() {
  // Local Wi-Fi previews can use getRandomValues on HTTP even without randomUUID.
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function MobileCapture({ draftKey, active, onConfirm, onBusyChange }: {
  draftKey: string
  active: boolean
  onConfirm: (files: File[]) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}) {
  const { draft, compress, pickFiles, getMedia, captureFile } = useCaptureRuntime()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [camera, setCamera] = useState(false)
  if (!active && camera) setCamera(false)
  const [selected, setSelected] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const generation = useRef(0)
  const locked = useRef(false)
  const current = useRef<Photo[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)

  const releaseCamera = useCallback(() => {
    generation.current++
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  const stopCamera = useCallback(() => {
    releaseCamera()
    setCamera(false)
  }, [releaseCamera])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    draft(draftKey).then((saved) => {
      if (cancelled) return
      const restored = saved.map((photo) => ({ ...photo, url: URL.createObjectURL(photo.blob) }))
      current.current = restored
      setPhotos(restored)
      setLoaded(true)
    }).catch(() => {
      if (!cancelled) setError('사진 보관함을 열 수 없습니다. 새로고침해 다시 시도해주세요. 브라우저의 저장 공간도 확인해주세요.')
    })
    return () => {
      mounted.current = false
      cancelled = true
      releaseCamera()
      current.current.forEach((photo) => URL.revokeObjectURL(photo.url))
    }
  }, [draftKey, releaseCamera, draft])

  useEffect(() => {
    if (!active) {
      releaseCamera()
    }
    const pause = () => {
      if (document.visibilityState === 'hidden') stopCamera()
    }
    document.addEventListener('visibilitychange', pause)
    return () => document.removeEventListener('visibilitychange', pause)
  }, [active, releaseCamera, stopCamera])

  useEffect(() => {
    if (camera && video.current) video.current.srcObject = stream.current
  }, [camera])

  async function startCamera() {
    if (!loaded || locked.current) return
    setError('')
    const request = ++generation.current
    try {
      if (!getMedia && !navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const media = await (getMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices))({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false,
      })
      if (generation.current !== request) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = media
      setCamera(true)
    } catch {
      setError('연속 촬영 카메라를 열 수 없습니다. 카메라 권한을 확인하거나 아래 ‘기본 카메라 / 사진 추가’를 사용해주세요.')
    }
  }

  async function save(next: CapturePhoto[]) {
    // Only call a photo "saved" after the IndexedDB transaction commits.
    await draft(draftKey, next.map(({ id, blob, name, lastModified }) => ({ id, blob, name, lastModified })))
    if (!mounted.current) {
      current.current = next.map((photo) => ({ ...photo, url: '' }))
      return
    }
    const updated = next.map((photo) => ({ ...photo, url: current.current.find((p) => p.id === photo.id)?.url ?? URL.createObjectURL(photo.blob) }))
    current.current.filter((p) => !updated.some((n) => n.id === p.id)).forEach((p) => URL.revokeObjectURL(p.url))
    current.current = updated
    setPhotos(updated)
  }

  async function operate(work: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    onBusyChange?.(true)
    setBusy(true)
    setError('')
    try { await work() }
    catch { setError('사진 처리·기기 저장에 실패했습니다. 저장 공간을 확인하고 다시 시도해주세요. 기존에 보관한 사진은 유지됩니다.') }
    finally { locked.current = false; setBusy(false); onBusyChange?.(false) }
  }

  async function addFiles(files: File[]) {
    await operate(async () => {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const compressed = await compress(file)
        const bytes = Uint8Array.from(atob(compressed.base64), (c) => c.charCodeAt(0))
        const photo = { id: createCaptureId(), blob: new Blob([bytes], { type: compressed.mimeType }), name: file.name, lastModified: file.lastModified }
        await save([...current.current, photo])
      }
    })
  }

  async function shoot() {
    const element = video.current
    if ((!element?.videoWidth && !captureFile) || locked.current) return
    await operate(async () => {
      let file: File
      if (captureFile) file = await captureFile()
      else {
        if (!element) throw new Error('camera')
        const canvas = document.createElement('canvas')
        // Keep camera resolution; apply the existing upload compressor once below.
        canvas.width = element.videoWidth
        canvas.height = element.videoHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('canvas')
        context.drawImage(element, 0, 0)
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('capture')), 'image/jpeg', 0.95))
        file = new File([blob], `답안지-${Date.now()}.jpg`, { type: 'image/jpeg' })
      }
      const compressed = await compress(file)
      const bytes = Uint8Array.from(atob(compressed.base64), (c) => c.charCodeAt(0))
      await save([...current.current, { id: createCaptureId(), blob: new Blob([bytes], { type: compressed.mimeType }), name: file.name, lastModified: file.lastModified }])
    })
  }

  async function continueToStudents() {
    if (!current.current.length) return
    stopCamera()
    await operate(async () => {
      await onConfirm(current.current.map((photo) => new File([photo.blob], photo.name, {
        type: photo.blob.type, lastModified: photo.lastModified,
      })))
    })
  }

  const enlarged = photos.find((photo) => photo.id === selected)

  return (
    <section hidden={!active} className="mb-4 space-y-3 rounded-[20px] bg-[var(--share-card)] p-4 text-[var(--share-ink)]" aria-label="연속 촬영 사진 보관함">
      <p className="text-[15px] font-extrabold">모바일 연속 촬영</p>
      <p className="text-xs text-[var(--share-muted)]">학생당 한 장 · 이름과 답안 전체가 나오게 촬영하세요.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!loaded || busy || camera} onClick={startCamera}><Camera className="mr-1 size-4" />연속 촬영</Button>
        <Button type="button" variant="outline" disabled={!loaded || busy} onClick={async () => { stopCamera(); if (pickFiles) await addFiles(await pickFiles(false)); else cameraInput.current?.click() }}>기본 카메라</Button>
        <Button type="button" variant="outline" disabled={!loaded || busy} onClick={async () => { if (pickFiles) await addFiles(await pickFiles(true)); else fileInput.current?.click() }}><ImagePlus className="mr-1 size-4" />사진 추가</Button>
      </div>
      <input ref={cameraInput} aria-label="기본 카메라로 촬영" type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
      <input ref={fileInput} aria-label="보관함에 사진 추가" type="file" accept="image/*" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
      {camera && active && (
        <div className="space-y-2">
          <video ref={video} autoPlay playsInline muted aria-label="답안지 카메라 미리보기" className="max-h-[45dvh] w-full rounded-xl bg-black object-contain" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={shoot}>{busy ? '사진 저장 중…' : '촬영'}</Button>
            <Button type="button" variant="outline" disabled={busy || photos.length === 0} onClick={continueToStudents}>촬영 완료 · 학생 확인</Button>
          </div>
        </div>
      )}
      <p role="status" className="text-xs text-[var(--share-muted)]">{!loaded ? '보관한 사진 불러오는 중…' : busy ? '처리 중…' : `${photos.length}장 기기에 보관됨 · 새로고침 후에도 이 주차에서 복구됩니다.`}</p>
      {error && <p role="alert" className="text-xs text-[var(--share-red)]">{error}</p>}
      {photos.length > 0 && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {photos.map((photo, index) => (
              <button type="button" key={photo.id} aria-label={`사진 ${index + 1} 크게 확인`} onClick={() => setSelected(photo.id)} className="shrink-0 rounded-xl border border-[var(--share-line-strong)] p-1 focus-visible:outline-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`답안지 ${index + 1}`} className="h-20 w-16 rounded-lg object-contain" />
                <span className="text-xs">{index + 1}</span>
              </button>
            ))}
          </div>
          {enlarged && !camera && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enlarged.url} alt="선택한 답안지 확대" className="max-h-[60dvh] w-full rounded-xl object-contain" />
              <Button type="button" variant="outline" disabled={busy} onClick={() => operate(async () => { await save(current.current.filter((p) => p.id !== enlarged.id)); setSelected(null) })}><Trash2 className="mr-1 size-4" />이 사진 삭제</Button>
              <p className="text-xs text-[var(--share-muted)]">흐린 사진은 삭제한 뒤 다시 촬영해주세요.</p>
            </div>
          )}
          {!camera && <Button type="button" variant="action" disabled={busy} className="w-full" onClick={continueToStudents}>{photos.length}장 학생 확인</Button>}
          <Button type="button" variant="ghost" disabled={busy || camera} onClick={() => { if (window.confirm('이 주차의 보관 사진을 모두 삭제할까요?')) void operate(async () => { await save([]); setSelected(null) }) }}>보관 사진 모두 삭제</Button>
          <p className="text-xs text-[var(--share-muted)]">이 기기·브라우저에만 보관됩니다. 채점 후 ‘보관 사진 모두 삭제’로 정리하세요. 브라우저 데이터 삭제 시에는 복구되지 않습니다.</p>
        </>
      )}
    </section>
  )
}
