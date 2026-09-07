// ── 시험지/답안지 사진 Storage 버킷 ────────────────────────────────────────
// vocab-photos: 단어 시험지 사진 {weekId}/{studentId}.jpg — 정오표의 "원본 사진"
// exam-photos:  진단평가 답안지 사진
// 예전에는 30일 지난 파일을 매일 cron 으로 지웠으나, 원본은 계속 들여다볼 일이 있어
// 영구 보관으로 바꿨다 (정리 cron 자체를 걷어냄).

export const VOCAB_PHOTO_BUCKET = 'vocab-photos'
export const EXAM_PHOTO_BUCKET = 'exam-photos'
