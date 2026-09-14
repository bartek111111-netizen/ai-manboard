#!/usr/bin/env bash
# E2E (PLAN §23, Faza 5.5): full lifecycle with a real llama-server + small GGUF.
# Drives the real LifecycleManager (spawn + HTTP readiness probe). No mocks.
#
#   E2E_LLAMA_SERVER_BIN   path to llama-server   (default /home/bat/llama.cpp/build/bin/llama-server)
#   E2E_MODEL_PATH         the small GGUF model   (default .e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf)
#   E2E_PORT               pinned port            (default 8901)
#   E2E_TIMEOUT_SEC        readiness budget       (default 120)
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

MODEL_PATH="${E2E_MODEL_PATH:-.e2e-models/SmolLM2-135M-Instruct-Q2_K.gguf}"
MODEL_URL="${E2E_MODEL_URL:-https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q2_K.gguf}"

# Self-contained: fetch the tiny E2E model (~85 MB) if it is not on disk yet.
if [ ! -f "$MODEL_PATH" ]; then
  echo "[e2e] downloading small GGUF model (~85 MB) …"
  mkdir -p "$(dirname "$MODEL_PATH")"
  curl -L --fail --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
fi

npx tsx tools/e2e/run-e2e.ts
