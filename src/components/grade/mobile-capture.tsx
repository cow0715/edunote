'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, FileText, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileUpload } from '@/components/ui/file-upload'
import { captureDraft, type CapturePhoto } from '@/lib/capture-draft'
import { compressImageForUpload } from '@/lib/image-compress'

export type CaptureView = 'add' | 'camera' | 'review'

type Photo = CapturePhoto & { url: string }

export function MobileCapture({ draftKey, active, onConfirm, onBusyChange, onViewChange }: {
  draftKey: string
  active: boolean
  onConfirm: (files: File[]) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  onViewChange?: (view: CaptureView) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const [camera, setCamera] = useState(false)
  const [review, setReview] = useState(false)
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
    const hasPhotos = current.current.length > 0
    setReview(hasPhotos)
    onViewChange?.(hasPhotos ? 'review' : 'add')
  }, [releaseCamera, onViewChange])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    captureDraft(draftKey).then((saved) => {
      if (cancelled) return
      const restored = saved.map((photo) => ({ ...photo, url: URL.createObjectURL(photo.blob) }))
      current.current = restored
      setPhotos(restored)
      setLoaded(true)
      setReview(restored.length > 0)
      onViewChange?.(restored.length > 0 ? 'review' : 'add')
    }).catch(() => {
      if (!cancelled) setError('사진 보관함을 열 수 없습니다. 새로고침해 다시 시도해주세요. 브라우저의 저장 공간도 확인해주세요.')
    })
    return () => {
      mounted.current = false
      cancelled = true
      releaseCamera()
      current.current.forEach((photo) => URL.revokeObjectURL(photo.url))
    }
  }, [draftKey, releaseCamera, onViewChange])

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
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable')
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false,
      })
      if (generation.current !== request) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current?.getTracks().forEach((track) => track.stop())
      stream.current = media
      setReview(false)
      setCamera(true)
      setCameraUnavailable(false)
      setSelected(null)
      onViewChange?.('camera')
    } catch {
      if (generation.current !== request) return
      setCameraUnavailable(true)
      setError('카메라를 열 수 없습니다. 권한을 확인하거나 기본 카메라로 촬영해주세요.')
    }
  }

  async function save(next: CapturePhoto[]) {
    // Only call a photo "saved" after the IndexedDB transaction commits.
    await captureDraft(draftKey, next.map(({ id, blob, name, lastModified }) => ({ id, blob, name, lastModified })))
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
        if (!file.type.startsWith('image/') && file.type !== 'application/pdf') continue
        const compressed = await compressImageForUpload(file)
        const bytes = Uint8Array.from(atob(compressed.base64), (c) => c.charCodeAt(0))
        const photo = { id: crypto.randomUUID(), blob: new Blob([bytes], { type: compressed.mimeType }), name: file.name, lastModified: file.lastModified }
        await save([...current.current, photo])
        if (!camera && mounted.current) {
          setReview(true)
          setSelected(null)
          onViewChange?.('review')
        }
      }
    })
  }

  async function shoot() {
    const element = video.current
    if (!element?.videoWidth || locked.current) return
    await operate(async () => {
      const canvas = document.createElement('canvas')
      // Keep the capture at camera resolution; the existing upload compressor is applied once below.
      canvas.width = element.videoWidth
      canvas.height = element.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas')
      context.drawImage(element, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('capture')), 'image/jpeg', 0.95))
      const file = new File([blob], `답안지-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const compressed = await compressImageForUpload(file)
      const bytes = Uint8Array.from(atob(compressed.base64), (c) => c.charCodeAt(0))
      await save([...current.current, { id: crypto.randomUUID(), blob: new Blob([bytes], { type: compressed.mimeType }), name: file.name, lastModified: file.lastModified }])
    })
  }

  const enlarged = photos.find((photo) => photo.id === selected)

  return (
    <section hidden={!active} className={`${active ? 'grid' : 'hidden'} min-h-0 grid-rows-[minmax(0,1fr)_auto]`} aria-label="연속 촬영 사진 보관함">
      <div className="min-h-0 overflow-y-auto">
        <div className={`mx-auto flex min-h-full w-full max-w-[430px] flex-col gap-4 px-4 py-5 sm:px-6 ${!photos.length && !camera ? 'justify-center' : ''}`}>
          {!camera && <>
            {!photos.length && <p className="text-center text-sm leading-relaxed text-[var(--share-muted)]">종이 답안을 촬영하거나<br />이미지·PDF 파일을 추가해주세요.</p>}
            <div className={photos.length ? 'flex gap-2' : 'grid grid-cols-2 gap-3'}>
              <Button type="button" variant="outline" disabled={!loaded || busy} onClick={startCamera} className={photos.length ? 'h-11 flex-1 rounded-xl shadow-none' : 'h-28 flex-col rounded-xl bg-[var(--share-card)] shadow-none'}><Camera className="size-6" />{photos.length ? '더 촬영' : '촬영하기'}</Button>
              <FileUpload compact className={photos.length ? 'flex-1 [&>button]:h-11 [&>button]:w-full' : '[&>button]:h-28 [&>button]:w-full [&>button]:flex-col'} label="파일 추가" description="이미지 또는 PDF · 여러 파일 선택 가능" accept="image/*,application/pdf" multiple inputRef={fileInput} disabled={!loaded || busy} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />
            </div>
          </>}

          {error && <div className="space-y-3 rounded-xl bg-[var(--share-red-bg)] p-4">
            <p role="alert" className="text-xs leading-relaxed text-[var(--share-red)]">{error}</p>
            {cameraUnavailable && <Button type="button" variant="outline" disabled={!loaded || busy} className="h-11 rounded-xl shadow-none" onClick={() => { stopCamera(); cameraInput.current?.click() }}>기본 카메라로 촬영</Button>}
          </div>}
          <input ref={cameraInput} aria-label="기본 카메라로 촬영" type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files) }} />

          {camera && active && <>
            <video ref={video} autoPlay playsInline muted aria-label="답안지 카메라 미리보기" className="max-h-[calc(100dvh-330px)] min-h-40 w-full flex-1 rounded-xl bg-black object-contain sm:max-h-[450px]" />
            <p className="text-center text-xs text-[var(--share-muted)]">종이가 잘리지 않게 맞춘 뒤 촬영해주세요.</p>
            {photos.length > 0 && <div className="flex justify-center gap-2" aria-label="최근 촬영 답안">
              {photos.slice(-4).map((photo) => <button type="button" key={photo.id} disabled={busy} onClick={() => { stopCamera(); setSelected(photo.id) }} aria-label="촬영한 답안 확인" className="rounded-lg border border-[var(--share-line-strong)] p-1">
                {photo.blob.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="최근 답안" className="h-12 w-9 rounded object-contain" />
                ) : <FileText className="h-12 w-9 p-2" />}
              </button>)}
            </div>}
          </>}

          {!camera && photos.length > 0 && <>
            {enlarged ? <div className="space-y-3">
              <Button type="button" variant="ghost" className="min-h-11 px-0" onClick={() => setSelected(null)}><ArrowLeft className="size-4" />목록으로</Button>
              {enlarged.blob.type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={enlarged.url} alt="선택한 답안지 확대" className="max-h-[55dvh] w-full rounded-xl bg-[var(--share-card)] object-contain" />
              ) : <div className="space-y-3 rounded-xl bg-[var(--share-card)] p-6 text-center"><FileText className="mx-auto size-10" /><p className="break-words text-sm">{enlarged.name}</p><a href={enlarged.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline">PDF 열기</a></div>}
              <Button type="button" variant="outline" className="h-11 w-full rounded-xl shadow-none" disabled={busy} onClick={() => operate(async () => { await save(current.current.filter((photo) => photo.id !== enlarged.id)); setSelected(null); if (!current.current.length) { setReview(false); onViewChange?.('add') } })}><Trash2 className="size-4" />이 사진 삭제</Button>
              <p className="text-center text-xs text-[var(--share-muted)]">흐린 사진은 삭제하고 다시 촬영해주세요.</p>
            </div> : <>
              <p className="text-sm font-bold">보관한 답안 {photos.length}장 <span className="ml-1 text-xs font-normal text-[var(--share-muted)]">눌러서 크게 확인</span></p>
              <div className="grid grid-cols-2 gap-3">
                {photos.map((photo, index) => <div key={photo.id} className="relative overflow-hidden rounded-xl bg-[var(--share-card)]">
                  <button type="button" aria-label={`사진 ${index + 1} 크게 확인`} onClick={() => setSelected(photo.id)} className="w-full p-3 text-left focus-visible:outline-2">
                    {photo.blob.type.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt={`답안지 ${index + 1}`} className="aspect-[3/4] w-full rounded-lg object-contain" />
                    ) : <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2"><FileText className="size-10 text-[var(--share-muted)]" /><span className="text-xs">PDF</span></div>}
                    <p className="mt-2 text-xs font-semibold">답안 {index + 1}</p><p className="mt-1 truncate text-[11px] text-[var(--share-muted)]">{photo.name}</p>
                  </button>
                  <button type="button" aria-label={`답안 ${index + 1} 삭제`} disabled={busy} className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full bg-[var(--share-canvas)]/90 text-[var(--share-muted)] focus-visible:outline-2" onClick={() => operate(async () => { await save(current.current.filter((item) => item.id !== photo.id)); if (!current.current.length) { setReview(false); onViewChange?.('add') } })}><X className="size-4" /></button>
                </div>)}
              </div>
            </>}
            <details className="border-t border-[var(--share-line)] pt-3 text-xs text-[var(--share-muted)]">
              <summary className="min-h-11 cursor-pointer py-3">보관함 관리</summary>
              <p className="py-2 leading-relaxed">이 기기·브라우저에만 보관됩니다. 채점 후 필요 없어진 사진은 정리해주세요. 브라우저 데이터를 삭제하면 복구되지 않습니다.</p>
              <button type="button" disabled={busy} className="min-h-11 rounded-lg py-2 text-[var(--share-red)] focus-visible:outline-2" onClick={() => { if (window.confirm('이 주차의 보관 사진을 모두 삭제할까요?')) void operate(async () => { await save([]); setSelected(null); setReview(false); onViewChange?.('add') }) }}>보관 사진 모두 삭제</button>
            </details>
          </>}
        </div>
      </div>
      <footer className="border-t border-[var(--share-line)] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto max-w-[430px] space-y-3">
          <p role="status" className="text-center text-xs text-[var(--share-muted)]">{!loaded ? '보관한 사진 불러오는 중…' : busy ? '처리 중…' : photos.length ? `${photos.length}장 기기에 보관됨 · 닫거나 새로고침해도 유지됩니다.` : '추가한 답안은 이 기기에 자동으로 보관됩니다.'}</p>
          {camera ? <div className="flex items-center justify-center gap-5">
            <Button type="button" variant="outline" aria-label="답안지 촬영" className="size-16 rounded-full border-4 border-[var(--share-line-strong)] bg-[var(--share-box)] p-0 shadow-none" disabled={busy} onClick={shoot}><Camera className="size-6" /></Button>
            <Button type="button" variant="outline" disabled={busy} className="h-12 rounded-xl shadow-none" onClick={() => { stopCamera(); setSelected(null) }}>{photos.length ? `완료 · ${photos.length}장 확인` : '촬영 나가기'}</Button>
          </div> : review && photos.length > 0 ? <Button type="button" variant="action" disabled={busy} className="h-12 w-full rounded-xl" onClick={() => operate(async () => { await onConfirm(current.current.map((photo) => new File([photo.blob], photo.name, { type: photo.blob.type, lastModified: photo.lastModified }))) })}>{photos.length}장 학생 확인하기</Button> : null}
        </div>
      </footer>
    </section>
  )
}
