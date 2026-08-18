#!/usr/bin/env bash
# PostToolUse(Edit|Write) 훅 — .ts/.tsx 를 고친 뒤 `npm run check` 를 백그라운드로 돌린다.
#
# 왜 백그라운드인가: tsc 가 증분 10초, 콜드 19초라 매 편집마다 블로킹하면 작업이 멈춘다.
# settings.json 의 asyncRewake 와 짝을 이룬다 — 통과하면 조용히 끝나고,
# 실패하면 exit 2 로 모델을 깨워서 에러 내용을 전달한다.
#
# 동시 실행 제어:
# - 락(mkdir)으로 check 가 겹쳐 도는 걸 막는다.
# - 락에 막힌 훅은 재실행 마커를 남긴다. check 도중 들어온 편집이 검사에서
#   빠지지 않도록, 락을 쥔 쪽이 마커를 보고 한 번 더 돈다.
# - check 시작 전 잠깐 기다려 연쇄 편집을 한 번의 검사로 합친다
#   (리팩토링 중 반쯤 고친 상태를 검사해 헛깨움하는 것 방지).
#
# 수동 실행/디버깅:
#   echo '{"tool_input":{"file_path":"src/lib/mock-exam.ts"}}' | bash .claude/hooks/check.sh; echo "exit=$?"

set -u

payload=$(cat)

# jq 가 없는 환경이라 node 로 파싱한다.
file=$(printf '%s' "$payload" | node -e "
let s='';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  try {
    const j = JSON.parse(s)
    process.stdout.write(j.tool_input?.file_path || j.tool_response?.filePath || '')
  } catch {
    process.stdout.write('')
  }
})
" 2>/dev/null)

# 타입스크립트 파일이 아니면 아무것도 하지 않는다 (md/json/css 편집까지 검사하면 낭비).
case "$file" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0

lock=".claude/hooks/.check.lock"
rerun=".claude/hooks/.check.rerun"

# 고아 락 방어: 훅이 강제 종료되면 락이 남아 이후 실행이 전부 조용히 죽는다.
# 10분 넘은 락은 죽은 프로세스의 잔재로 보고 걷어낸다 (check 는 20초면 끝난다).
if [ -d "$lock" ] && [ -z "$(find "$lock" -maxdepth 0 -mmin -10 2>/dev/null)" ]; then
  rmdir "$lock" 2>/dev/null
fi

if ! mkdir "$lock" 2>/dev/null; then
  # 이미 check 가 돌고 있다. 이 편집이 검사에서 빠지지 않도록 마커만 남기고 빠진다.
  touch "$rerun"
  exit 0
fi
trap 'rmdir "$lock" 2>/dev/null' EXIT

# 연쇄 편집 정착 대기. 상한 4회 재실행 — settings.json 의 timeout(300초) 안에서
# 최악 5회 × (대기 8초 + check ~20초) 로 여유가 있다.
tries=0
while :; do
  sleep 8
  rm -f "$rerun"

  out=$(npm run check 2>&1)
  status=$?

  # check 도중 새 편집이 들어왔으면 지금 결과는 낡은 상태의 것일 수 있다 — 다시 돈다.
  if [ -f "$rerun" ] && [ "$tries" -lt 4 ]; then
    tries=$((tries + 1))
    continue
  fi

  if [ "$status" -ne 0 ]; then
    printf '`npm run check` 실패 — 고치고 넘어가세요.\n\n%s\n' "$out"
    exit 2
  fi
  exit 0
done
