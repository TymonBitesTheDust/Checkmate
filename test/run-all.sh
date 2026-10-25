#!/usr/bin/env bash
# Runs every test and prints PASS/FAIL for each. Logs and screenshots go to $OUT
# (default /tmp/checkmate-tests). Build first: ./build.sh, then
#   (cd web && MOCK_FIREBASE=1 node build.mjs)   # the copy the sync test uses (web/dist-test)
#
# The browser tests load Playwright from /opt/node-tools/node_modules/playwright, and the
# connector tests load @modelcontextprotocol/sdk and wrangler from /home/claude/tools/mcp
# (npm install @modelcontextprotocol/sdk wrangler there). Change those paths in the tests
# if your machine keeps them elsewhere.
#
# chinese.cjs exits with code 2 whenever any English is left on a screen. Two leftovers are
# expected and fine: "Language, English" in General and the Firestore rules code in Sync.
cd "$(dirname "$0")/.."
OUT=${OUT:-/tmp/checkmate-tests}
export SCRATCH=${SCRATCH:-$OUT}
mkdir -p "$OUT/shots"
run() {
  local name=$1; shift
  local t0=$(date +%s)
  if timeout 900 "$@" > "$OUT/log-$name.txt" 2>&1; then
    echo "PASS $name ($(( $(date +%s) - t0 ))s)"
  else
    echo "FAIL $name ($(( $(date +%s) - t0 ))s)"
    tail -15 "$OUT/log-$name.txt"
  fi
}
run recur node test/recur.mjs
run go bash -c 'cd desktop && GOOS=linux go test ./... 2>&1'
run connector-tz node test/connector-tz.mjs
run connector-node node test/connector.cjs
run connector-workerd env RUNTIME=workerd node test/connector.cjs
run claude node test/claude.cjs "$OUT/shots"
for t in frame settings-more examples v22 files smoke dnd accent archive riot tide icons sound docs frontier neon sync calendar chinese; do
  run $t node test/$t.cjs "$OUT/shots"
done
run calendar-styles node test/calendar-styles.cjs "$OUT/shots"
