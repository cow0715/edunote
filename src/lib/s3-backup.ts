import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

let _client: S3Client | null = null

function getClient(): S3Client | null {
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY
  const region = process.env.BACKUP_S3_REGION

  // 필수 환경변수 미설정 시 S3 비활성화
  if (!accessKeyId || !secretAccessKey || !region) return null

  if (!_client) {
    const endpoint = process.env.BACKUP_S3_ENDPOINT // R2: https://<accountid>.r2.cloudflarestorage.com
    _client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    })
  }

  return _client
}

/**
 * S3/R2에 백업 파일 업로드.
 * 환경변수 미설정 시 null 반환(skip).
 * 실패 시 에러 메시지 문자열 반환.
 */
export async function uploadToS3(fileName: string, buffer: Buffer): Promise<string | null> {
  const client = getClient()
  if (!client) return null // S3 미설정 — skip

  const bucket = process.env.BACKUP_S3_BUCKET
  if (!bucket) return 'BACKUP_S3_BUCKET 환경변수 미설정'

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `edunote/${fileName}`,
        Body: buffer,
        ContentType: 'application/json',
      }),
    )
    return null // 성공
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
