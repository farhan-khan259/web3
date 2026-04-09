#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SC_DIR="$ROOT_DIR/smart_contracts"
FE_DIR="$ROOT_DIR/frontend"
BE_DIR="$ROOT_DIR/backend"

HARDHAT_PID=""
BACKEND_PID=""
STARTED_NODE=0

cleanup() {
  if [[ "$STARTED_NODE" -eq 1 && -n "$HARDHAT_PID" ]]; then
    kill "$HARDHAT_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if lsof -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Hardhat node already running on 8545, reusing it."
else
  echo "Starting Hardhat node on 8545..."
  cd "$SC_DIR"
  npx hardhat node > "$ROOT_DIR/.hardhat-node.log" 2>&1 &
  HARDHAT_PID=$!
  STARTED_NODE=1

  for _ in {1..40}; do
    if curl -s -X POST http://127.0.0.1:8545 \
      -H "Content-Type: application/json" \
      --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null; then
      break
    fi
    sleep 0.25
  done

  echo "Hardhat node started."
fi

echo "Deploying and seeding local contracts..."
cd "$SC_DIR"
npm run deploy:local

echo "Starting backend NAV loop..."
cd "$BE_DIR"
if [[ -x "$BE_DIR/.venv/bin/python" ]]; then
  "$BE_DIR/.venv/bin/python" ai_nav_loop.py > "$ROOT_DIR/.backend-nav.log" 2>&1 &
else
  python3 ai_nav_loop.py > "$ROOT_DIR/.backend-nav.log" 2>&1 &
fi
BACKEND_PID=$!
echo "Backend started on http://127.0.0.1:8000"

echo "Starting frontend dev server..."
cd "$FE_DIR"
npm run dev
