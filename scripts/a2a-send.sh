#!/usr/bin/env bash
# a2a-send.sh — Send a message to a peer agent via A2A
# Usage: ./a2a-send.sh <peer> "<message>" [timeout_ms]
# Peers: woodhouse | ray | liz
#
# Peer config loaded from peers.json (gitignored).
# Copy peers.example.json → peers.json and fill in your values.
#
# Examples:
#   ./a2a-send.sh ray "What's the status on Agentcy-services?"
#   ./a2a-send.sh liz "Can you review this spec?"
#   ./a2a-send.sh woodhouse "Test message"
#   ./a2a-send.sh ray "Long task..." 600000
#
# Uses a2a-send.mjs in non-blocking + wait mode so agent turns of 30-120s
# do not time out. Default wait timeout: 300s. Override with third argument.

set -euo pipefail

PEER="${1:-}"
MESSAGE="${2:-}"
TIMEOUT_MS="${3:-300000}"

if [[ -z "$PEER" || -z "$MESSAGE" ]]; then
  echo "Usage: $0 <peer> \"<message>\" [timeout_ms]"
  echo "Peers: woodhouse | ray | liz"
  exit 1
fi

# Resolve paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PEERS_FILE="$SCRIPT_DIR/peers.json"
MJS="$HOME/.openclaw/extensions/a2a-gateway/skill/scripts/a2a-send.mjs"

if [[ ! -f "$PEERS_FILE" ]]; then
  echo "Error: $PEERS_FILE not found."
  echo "Copy $SCRIPT_DIR/peers.example.json → $PEERS_FILE and fill in your values."
  exit 1
fi

if [[ ! -f "$MJS" ]]; then
  echo "Error: a2a-send.mjs not found at $MJS"
  exit 1
fi

# Load peer URL and token
PEER_DATA=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
  peers = json.load(f)
peer = peers.get(sys.argv[2])
if not peer:
  print('UNKNOWN')
  sys.exit(1)
print(peer['url'].replace('/a2a/jsonrpc', ''))
print(peer['token'])
" "$PEERS_FILE" "$PEER" 2>/dev/null)

if [[ "$PEER_DATA" == "UNKNOWN" || -z "$PEER_DATA" ]]; then
  echo "Unknown peer: $PEER"
  echo "Valid peers: $(python3 -c "import json; d=json.load(open('$PEERS_FILE')); print(' | '.join(d.keys()))")"
  exit 1
fi

PEER_URL=$(echo "$PEER_DATA" | sed -n '1p')
TOKEN=$(echo "$PEER_DATA" | sed -n '2p')

echo "→ Sending to $PEER ($PEER_URL) [non-blocking, wait up to ${TIMEOUT_MS}ms]..."

node "$MJS" \
  --peer-url "$PEER_URL" \
  --token "$TOKEN" \
  --non-blocking \
  --wait \
  --timeout-ms "$TIMEOUT_MS" \
  --poll-ms 3000 \
  --message "$MESSAGE"
