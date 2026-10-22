export type CapturePhoto = { id: string; blob: Blob; name: string; lastModified: number }

// Store blobs rather than base64: localStorage is too small for a classroom of photos.
// Each week/test has its own draft. Nothing is uploaded until the teacher confirms.
export async function captureDraft(key: string, photos?: CapturePhoto[]): Promise<CapturePhoto[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open('edunote-capture-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('사진 보관함을 열 수 없습니다. 다른 탭을 닫고 다시 시도해주세요.'))
    }
  })
  try {
    return await new Promise<CapturePhoto[]>((resolve, reject) => {
      const transaction = db.transaction('drafts', photos === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('drafts')
      const request = photos === undefined ? store.get(key) : photos.length ? store.put(photos, key) : store.delete(key)
      let result: CapturePhoto[] = photos ?? []
      request.onsuccess = () => { if (photos === undefined) result = request.result ?? [] }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error ?? new Error('사진 저장 실패'))
      transaction.onabort = () => reject(transaction.error ?? new Error('사진 저장이 취소되었습니다'))
    })
  } finally {
    db.close()
  }
}
