#!/usr/bin/env bash
# E2E test script (Faza 10.4, PLAN §23.2): full lifecycle.
#
# Always isolated (PLAN §23.4): its own AI_DASHBOARD_HOME (default
# /tmp/e2e-test) and its own port (AI_DASHBOARD_PORT, default 3199). A
# dashboard the user runs on 3100 is never touched: if something already
# listens on the E2E port, the script aborts instead of reusing it.
#
# Requires: a `llama-server` binary (default ~/llama.cpp/build/bin, override
# with LLAMA_SERVER_BIN) and the tiny test model in .e2e-models/.
#
# Usage: ./tools/e2e/run-e2e.sh
# Exits 0 on success, 1 on failure.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${AI_DASHBOARD_HOME:-/tmp/e2e-test}"
PORT="${AI_DASHBOARD_PORT:-3199}"
BASE_URL="http://127.0.0.1:${PORT}"
MODEL_FILE="${PROJECT_ROOT}/.e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf"
PRESET_NAME="e2e-test"
PRESET_PORT=8123

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

log() { echo "[e2e] $*"; }
fail() { echo "[e2e] FAIL: $*" >&2; exit 1; }

# --- Prerequisites -----------------------------------------------------------
[ -f "$MODEL_FILE" ] || fail "Test model missing: $MODEL_FILE"
BIN="${LLAMA_SERVER_BIN:-$(realpath ~/llama.cpp/build/bin/llama-server 2>/dev/null || true)}"
[ -n "$BIN" ] || fail "llama-server binary not found (set LLAMA_SERVER_BIN)"

# The model id is derived from the file (PLAN §8.1): slug + sha1(path)[:8].
MODEL_ID=$(node -e '
const { createHash } = require("node:crypto");
const p = process.argv[1];
const base = require("node:path").basename(p);
const slug = base.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
console.log(`${slug}-${createHash("sha1").update(p).digest("hex").slice(0, 8)}`);
' "$MODEL_FILE")
INSTANCE_ID="${MODEL_ID}--${PRESET_NAME}"

# --- Setup: isolated server --------------------------------------------------
if curl -s "${BASE_URL}/healthz" > /dev/null 2>&1; then
  fail "Something already listens on ${BASE_URL} — free the port or set AI_DASHBOARD_PORT (we never reuse a running dashboard)"
fi
rm -rf "$HOME_DIR"
export AI_DASHBOARD_HOME="$HOME_DIR"
(cd "$PROJECT_ROOT" && AI_DASHBOARD_PORT="$PORT" npx tsx apps/server/src/index.ts) &
SERVER_PID=$!
for i in $(seq 1 30); do
  if curl -s "${BASE_URL}/healthz" > /dev/null 2>&1; then
    break
  fi
  [ "$i" = "30" ] && fail "Server did not start"
  sleep 1
done
log "Server up on ${BASE_URL} (home ${HOME_DIR}, model ${MODEL_ID})"

# --- 0. Seed config (fresh home has empty modelDirs) -------------------------
log "Step 0: Seed global config (modelDirs + engine binary)"
curl -s -X PUT "${BASE_URL}/api/v1/config/global" -H 'Content-Type: application/json' -d '{
  "version": 1,
  "modelDirs": ["'"$PROJECT_ROOT"'"],
  "defaults": {},
  "portRange": { "start": 8100, "end": 8130 },
  "engines": { "llama-server": { "binary": "'"${BIN}"'" } },
  "server": { "host": "127.0.0.1", "port": '"$PORT"' },
  "security": { "token": null },
  "monitoring": { "probeIntervalSec": 2, "startupTimeoutSec": 60 },
  "logs": { "ringLines": 1000, "retentionFiles": 10 }
}' > /dev/null

# --- 1. Discover models ------------------------------------------------------
log "Step 1: Discover models"
DISCOVER=$(curl -s -X POST "${BASE_URL}/api/v1/models/discover" -H 'Content-Type: application/json' -d '{}')
sleep 1
MODELS=$(curl -s "${BASE_URL}/api/v1/models")
if ! echo "$MODELS" | grep -q "${MODEL_ID}"; then
  fail "Model ${MODEL_ID} not found after discover: ${DISCOVER}"
fi
log "Model discovered: ${MODEL_ID}"

# --- 2. Create preset --------------------------------------------------------
log "Step 2: Create preset ${PRESET_NAME} (port ${PRESET_PORT})"
curl -s -X PUT "${BASE_URL}/api/v1/models/${MODEL_ID}/presets/${PRESET_NAME}" \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"name":"'"${PRESET_NAME}"'","port":'"${PRESET_PORT}"',"params":{}}' > /dev/null
log "Preset created"

# --- 3. Start instance -------------------------------------------------------
log "Step 3: Start instance ${INSTANCE_ID}"
START_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/instances/${INSTANCE_ID}/start" -H 'Content-Type: application/json' -d '{}')
STATE=$(echo "$START_RESULT" | grep -oP '"state":"\K[^"]+')
log "Start state: ${STATE}"
[ "$STATE" = "starting" ] || fail "Expected state 'starting', got '${STATE}': ${START_RESULT}"

# --- 4. Wait for running -----------------------------------------------------
log "Step 4: Wait for running state (up to 60s)"
for i in $(seq 1 60); do
  INSTANCE_DATA=$(curl -s "${BASE_URL}/api/v1/instances/${INSTANCE_ID}")
  STATE=$(echo "$INSTANCE_DATA" | grep -oP '"state":"\K[^"]+')
  if [ "$STATE" = "running" ]; then
    log "Instance running after ${i}s"
    break
  fi
  if [ "$STATE" = "error" ] || [ "$STATE" = "crashed" ]; then
    fail "Instance reached '${STATE}' (expected running): ${INSTANCE_DATA}"
  fi
  sleep 1
done
[ "$STATE" = "running" ] || fail "Instance did not reach running state (last state: ${STATE})"

# --- 5. Get metrics ----------------------------------------------------------
log "Step 5: Get metrics"
METRICS=$(curl -s "${BASE_URL}/api/v1/instances/${INSTANCE_ID}/metrics")
echo "$METRICS"

# --- 6. Stop instance --------------------------------------------------------
log "Step 6: Stop instance"
curl -s -X POST "${BASE_URL}/api/v1/instances/${INSTANCE_ID}/stop" -H 'Content-Type: application/json' -d '{}' > /dev/null
STOP_STATE=""
for i in $(seq 1 30); do
  STOP_DATA=$(curl -s "${BASE_URL}/api/v1/instances/${INSTANCE_ID}")
  STOP_STATE=$(echo "$STOP_DATA" | grep -oP '"state":"\K[^"]+')
  [ "$STOP_STATE" = "stopped" ] && break
  sleep 1
done
log "Stop state: ${STOP_STATE}"
[ "$STOP_STATE" = "stopped" ] || fail "Expected state 'stopped', got '${STOP_STATE}'"

# --- 7. Restart --------------------------------------------------------------
log "Step 7: Restart instance (stopped -> running again)"
curl -s -X POST "${BASE_URL}/api/v1/instances/${INSTANCE_ID}/restart" -H 'Content-Type: application/json' -d '{}' > /dev/null
RESTART_STATE=""
for i in $(seq 1 60); do
  RESTART_DATA=$(curl -s "${BASE_URL}/api/v1/instances/${INSTANCE_ID}")
  RESTART_STATE=$(echo "$RESTART_DATA" | grep -oP '"state":"\K[^"]+')
  if [ "$RESTART_STATE" = "running" ]; then
    log "Instance running again after restart (${i}s)"
    break
  fi
  if [ "$RESTART_STATE" = "error" ] || [ "$RESTART_STATE" = "crashed" ]; then
    fail "Restart reached '${RESTART_STATE}': ${RESTART_DATA}"
  fi
  sleep 1
done
[ "$RESTART_STATE" = "running" ] || fail "Restart did not reach running (last: ${RESTART_STATE})"

# --- 8. Final stop ------------------------------------------------------------
log "Step 8: Final stop"
curl -s -X POST "${BASE_URL}/api/v1/instances/${INSTANCE_ID}/stop" -H 'Content-Type: application/json' -d '{}' > /dev/null
FINAL_STATE=""
for i in $(seq 1 30); do
  FINAL_DATA=$(curl -s "${BASE_URL}/api/v1/instances/${INSTANCE_ID}")
  FINAL_STATE=$(echo "$FINAL_DATA" | grep -oP '"state":"\K[^"]+')
  [ "$FINAL_STATE" = "stopped" ] && break
  sleep 1
done
[ "$FINAL_STATE" = "stopped" ] || fail "Final stop failed (last: ${FINAL_STATE})"

# --- Cleanup -----------------------------------------------------------------
log "Cleanup: delete preset + stop server"
curl -s -X DELETE "${BASE_URL}/api/v1/models/${MODEL_ID}/presets/${PRESET_NAME}" > /dev/null
log "E2E test passed"
exit 0
