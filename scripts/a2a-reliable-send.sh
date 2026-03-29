#!/usr/bin/env bash
# a2a-reliable-send.sh — bulletproof A2A send with retry
# Usage: ./a2a-reliable-send.sh <peer-url> <token> <message>
# Retries up to MAX_ATTEMPTS times with exponential backoff.
# Exits 0 on success, 1 on all attempts exhausted.

set -euo pipefail

PEER_URL="${1:?Usage: $0 <peer-url> <token> <message>}"
TOKEN="${2:?missing token}"
MESSAGE="${3:?missing message}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A2A_SEND="$HOME/.openclaw/extensions/a2a-gateway/skill/scripts/a2a-send.mjs"

MAX_ATTEMPTS=5
BACKOFF=5  # seconds between first retry

attempt=1
while [ $attempt -le $MAX_ATTEMPTS ]; do
  echo "[a2a-reliable-send] Attempt $attempt/$MAX_ATTEMPTS → $PEER_URL"

  # Quick connectivity pre-check
  if ! curl -sf --max-time 5 "${PEER_URL}/.well-known/agent-card.json" > /dev/null 2>&1; then
    echo "[a2a-reliable-send] Peer not reachable, waiting ${BACKOFF}s..."
    sleep $BACKOFF
    BACKOFF=$(( BACKOFF * 2 ))
    attempt=$(( attempt + 1 ))
    continue
  fi

  # Attempt send
  if node "$A2A_SEND" \
      --peer-url "$PEER_URL" \
      --token "$TOKEN" \
      --non-blocking --wait --timeout-ms 180000 \
      --message "$MESSAGE"; then
    echo "[a2a-reliable-send] ✓ Delivered on attempt $attempt"
    exit 0
  fi

  echo "[a2a-reliable-send] Send failed, waiting ${BACKOFF}s before retry..."
  sleep $BACKOFF
  BACKOFF=$(( BACKOFF * 2 ))
  attempt=$(( attempt + 1 ))
done

echo "[a2a-reliable-send] ✗ All $MAX_ATTEMPTS attempts failed for $PEER_URL"
exit 1
