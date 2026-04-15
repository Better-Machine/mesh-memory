#!/bin/bash
# validate-mesh.sh — Mesh-Memory Health Validation Script
# Usage: ./validate-mesh.sh [--quick] [--verbose]

set -e

# Configuration
PEERS=(
  "ray:192.168.50.22"
  "liz:192.168.50.23"
  "woodhouse:192.168.50.24"
)

CONFIG_PATH="${HOME}/.openclaw/workspace/projects/mesh-memory/mesh-memory.config.local.json"
FAILED=0
VERBOSE=0
QUICK=0

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    --quick|-q)
      QUICK=1
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--quick] [--verbose]"
      echo "  --quick    Only check L1/L2, skip L3"
      echo "  --verbose  Show detailed output"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Colors (if terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  NC='\033[0m' # No Color
else
  GREEN=''
  RED=''
  YELLOW=''
  NC=''
fi

# Logging functions
log_ok() { echo -e "${GREEN}✓${NC} $1"; }
log_fail() { echo -e "${RED}✗${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_info() { echo "  $1"; }

# Header
echo "========================================"
echo "   Mesh-Memory Health Validation"
echo "   $(date -Iseconds)"
echo "========================================"
echo ""

# Load token if available
if [ -f "$CONFIG_PATH" ]; then
  TOKEN=$(jq -r '.receiverToken // empty' "$CONFIG_PATH" 2>/dev/null || echo "")
  if [ $VERBOSE -eq 1 ]; then
    log_info "Loaded config: $CONFIG_PATH"
  fi
else
  TOKEN=""
  log_warn "Config not found at $CONFIG_PATH"
fi

# Validate each peer
for peer in "${PEERS[@]}"; do
  IFS=':' read -r name ip <<< "$peer"
  
  echo "--- $name ($ip) ---"
  
  # L1: A2A Gateway (Port 18800)
  if [ $VERBOSE -eq 1 ]; then
    log_info "Testing L1: GET http://$ip:18800/.well-known/agent.json"
  fi
  
  L1_RESPONSE=$(curl -sf --max-time 5 "http://$ip:18800/.well-known/agent.json" 2>/dev/null || echo "")
  if [ -n "$L1_RESPONSE" ]; then
    AGENT_NAME=$(echo "$L1_RESPONSE" | jq -r '.name // "unknown"')
    log_ok "L1 A2A Gateway (18800): $AGENT_NAME"
  else
    log_fail "L1 A2A Gateway (18800): No response"
    FAILED=1
  fi
  
  # L2: Mesh Receiver (Port 18803)
  if [ $VERBOSE -eq 1 ]; then
    log_info "Testing L2: GET http://$ip:18803/health"
  fi
  
  L2_STATUS=$(curl -s --max-time 5 -w "%{http_code}" "http://$ip:18803/health" -o /dev/null 2>/dev/null || echo "000")
  
  if [ "$L2_STATUS" = "200" ]; then
    log_ok "L2 Mesh Receiver (18803): HTTP 200 (authenticated)"
  elif [ "$L2_STATUS" = "401" ]; then
    log_ok "L2 Mesh Receiver (18803): HTTP 401 (reachable, auth required)"
  elif [ "$L2_STATUS" = "000" ]; then
    log_fail "L2 Mesh Receiver (18803): Connection failed"
    FAILED=1
  else
    log_warn "L2 Mesh Receiver (18803): HTTP $L2_STATUS"
  fi
  
  # L3: Thread Manager (Port 18802) — Skip if --quick
  if [ $QUICK -eq 0 ]; then
    if [ $VERBOSE -eq 1 ]; then
      log_info "Testing L3: GET http://$ip:18802/health"
    fi
    
    TM_STATUS=$(curl -s --max-time 3 "http://$ip:18802/health" 2>/dev/null | jq -r '.status // "down"')
    if [ "$TM_STATUS" = "ok" ]; then
      log_ok "L3 Thread Manager (18802): OK"
    else
      log_warn "L3 Thread Manager (18802): $TM_STATUS"
    fi
  fi
  
  # Service manager check (Linux only)
  if command -v systemctl &> /dev/null; then
    if [ $VERBOSE -eq 1 ]; then
      log_info "Checking systemd status..."
    fi
    
    # Try to check remote systemd status (requires SSH)
    if ssh -o ConnectTimeout=3 -o BatchMode=yes "$ip" 'systemctl --user is-active mesh-receiver' &>/dev/null; then
      log_ok "Service Manager: systemd (active)"
    else
      log_warn "Service Manager: Cannot verify (may need SSH or not systemd)"
    fi
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    if [ $VERBOSE -eq 1 ]; then
      log_info "Checking launchd status..."
    fi
    log_info "Service Manager: launchd (check manually with 'launchctl list | grep bettermachine')"
  fi
  
  echo ""
done

# Summary
echo "========================================"
if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓✓✓ All critical services operational${NC}"
  echo "========================================"
  exit 0
else
  echo -e "${RED}✗✗✗ Some services failed validation${NC}"
  echo "========================================"
  exit 1
fi
