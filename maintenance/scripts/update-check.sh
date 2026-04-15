#!/bin/bash
#
# Mesh-Memory OpenClaw Update Compatibility Check Script
# Usage: ./update-check.sh [--target-version=X.X.X] [--post-update] [--quick] [--full]
#
# Performs pre-update compatibility validation and post-update health verification
# for the mesh-memory OpenClaw plugin.
#
# Exit codes:
#   0 - All checks passed, safe to proceed
#   1 - Compatibility issues detected, do not update
#   2 - Warning conditions, proceed with caution
#   3 - Script/runtime error

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MESH_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG_FILE="$MESH_ROOT/mesh-memory.config.local.json"
BACKUP_DIR="$HOME/.openclaw/backups"
LOG_FILE="$MESH_ROOT/maintenance/logs/update-check-$(date +%Y%m%d-%H%M%S).log"

# Default values
TARGET_VERSION=""
POST_UPDATE=false
QUICK_MODE=false
FULL_MODE=false
VERBOSE=false

# Color codes (disabled if not terminal)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

# Logging functions
log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
info() { echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE" 2>/dev/null || echo -e "${RED}✗${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --target-version=*)
      TARGET_VERSION="${1#*=}"
      shift
      ;;
    --post-update)
      POST_UPDATE=true
      shift
      ;;
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --full)
      FULL_MODE=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --target-version=X.X.X  Specify target OpenClaw version"
      echo "  --post-update          Run post-update validation checks"
      echo "  --quick                Run quick smoke tests only (2 minutes)"
      echo "  --full                 Run full regression suite (10 minutes)"
      echo "  --verbose              Enable verbose output"
      echo "  --help, -h             Show this help message"
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      exit 3
      ;;
  esac
done

# Create log directory
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$BACKUP_DIR"

log "=== Mesh-Memory Update Compatibility Check ==="
log "Started: $(date -Iseconds)"
log "Mesh root: $MESH_ROOT"
log "Mode: $(if $POST_UPDATE; then echo "POST-UPDATE"; elif $QUICK_MODE; then echo "QUICK"; elif $FULL_MODE; then echo "FULL"; else echo "STANDARD"; fi)"

# Track results
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNINGS=0

check_pass() {
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
  info "$1"
}

check_fail() {
  CHECKS_FAILED=$((CHECKS_FAILED + 1))
  error "$1"
}

check_warn() {
  CHECKS_WARNINGS=$((CHECKS_WARNINGS + 1))
  warn "$1"
}

# ============================================================================
# CHECK 1: Current Environment
# ============================================================================
log ""
log "=== CHECK 1: Current Environment ==="

# Get current OpenClaw version
CURRENT_OC_VERSION=$(openclaw --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
log "Current OpenClaw version: $CURRENT_OC_VERSION"

# Get mesh-memory version
if [ -f "$MESH_ROOT/package.json" ]; then
  MESH_VERSION=$(node -p "require('$MESH_ROOT/package.json').version" 2>/dev/null || echo "unknown")
  log "Mesh-memory version: $MESH_VERSION"
else
  check_warn "package.json not found"
  MESH_VERSION="unknown"
fi

# Get Node.js version
NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
log "Node.js version: $NODE_VERSION"

# Check if we're in the right directory
if [ ! -f "$MESH_ROOT/mesh-memory.mjs" ]; then
  check_fail "mesh-memory.mjs not found — are you in the right directory?"
  exit 3
else
  check_pass "Mesh-memory installation found"
fi

# ============================================================================
# CHECK 2: Config File Validation
# ============================================================================
log ""
log "=== CHECK 2: Config File Validation ==="

if [ ! -f "$CONFIG_FILE" ]; then
  check_fail "mesh-memory.config.local.json not found at $CONFIG_FILE"
else
  if node -e "require('$CONFIG_FILE')" 2>/dev/null; then
    check_pass "Config file is valid JSON"
    
    # Extract key values
    AGENT_ID=$(node -p "require('$CONFIG_FILE').agentId" 2>/dev/null || echo "unknown")
    RECEIVER_PORT=$(node -p "require('$CONFIG_FILE').receiverPort" 2>/dev/null || echo "18803")
    PEER_COUNT=$(node -p "(require('$CONFIG_FILE').peers || []).length" 2>/dev/null || echo "0")
    
    log "  Agent ID: $AGENT_ID"
    log "  Receiver port: $RECEIVER_PORT"
    log "  Peer count: $PEER_COUNT"
  else
    check_fail "Config file contains invalid JSON"
  fi
fi

# ============================================================================
# CHECK 3: LCM Database Status
# ============================================================================
log ""
log "=== CHECK 3: LCM Database Status ==="

LCM_DB="$HOME/.openclaw/lcm.db"

if [ ! -f "$LCM_DB" ]; then
  check_fail "LCM database not found at $LCM_DB"
else
  check_pass "LCM database exists"
  
  # Check if readable
  if command -v sqlite3 > /dev/null 2>&1; then
    if sqlite3 "$LCM_DB" "SELECT COUNT(*) FROM sqlite_master;" > /dev/null 2>&1; then
      check_pass "LCM database is readable"
      
      # Check for expected tables
      TABLES=$(sqlite3 "$LCM_DB" ".tables" 2>/dev/null || echo "")
      if echo "$TABLES" | grep -qE "summaries|summary|lcm"; then
        check_pass "LCM tables detected"
      else
        check_warn "LCM tables not found — schema may have changed"
      fi
      
      # Check row count
      ROW_COUNT=$(sqlite3 "$LCM_DB" "SELECT COUNT(*) FROM summaries;" 2>/dev/null || echo "0")
      log "  LCM summary count: $ROW_COUNT"
    else
      check_fail "LCM database is not readable (permissions or corruption)"
    fi
  else
    # SQLite3 not available, do basic file checks
    if [ -r "$LCM_DB" ]; then
      check_pass "LCM database file is readable (sqlite3 not installed for detailed check)"
    else
      check_fail "LCM database file is not readable"
    fi
    
    FILE_SIZE=$(stat -c%s "$LCM_DB" 2>/dev/null || stat -f%z "$LCM_DB" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -gt 0 ]; then
      check_pass "LCM database has content (${FILE_SIZE} bytes)"
    else
      check_warn "LCM database appears empty"
    fi
  fi
fi

# ============================================================================
# CHECK 4: OpenClaw Gateway Status
# ============================================================================
log ""
log "=== CHECK 4: OpenClaw Gateway Status ==="

GATEWAY_STATUS=$(openclaw gateway status 2>&1 || echo "ERROR")

if echo "$GATEWAY_STATUS" | grep -qi "running"; then
  check_pass "OpenClaw gateway is running"
elif echo "$GATEWAY_STATUS" | grep -qi "stopped"; then
  check_fail "OpenClaw gateway is stopped — start it before updating"
else
  check_warn "Could not determine gateway status: $GATEWAY_STATUS"
fi

# ============================================================================
# CHECK 5: Mesh-Memory Process Status
# ============================================================================
log ""
log "=== CHECK 5: Mesh-Memory Process Status ==="

RECEIVER_PID=$(pgrep -f "mesh-memory.mjs receiver" || echo "")
BRIDGE_PID=$(pgrep -f "mesh-memory.mjs bridge" || echo "")
WATCHER_PID=$(pgrep -f "mesh-memory.mjs watcher" || echo "")

if [ -n "$RECEIVER_PID" ]; then
  check_pass "Receiver process running (PID: $RECEIVER_PID)"
else
  check_warn "Receiver process not running"
fi

if [ -n "$BRIDGE_PID" ]; then
  check_pass "Bridge process running (PID: $BRIDGE_PID)"
else
  check_warn "Bridge process not running"
fi

if [ -n "$WATCHER_PID" ]; then
  check_pass "Watcher process running (PID: $WATCHER_PID)"
else
  check_warn "Watcher process not running"
fi

# ============================================================================
# CHECK 6: Port Availability
# ============================================================================
log ""
log "=== CHECK 6: Port Availability ==="

RECEIVER_PORT=${RECEIVER_PORT:-18803}
THREAD_PORT=$(node -p "require('$CONFIG_FILE').threadPort" 2>/dev/null || echo "18802")

# Check receiver port
if command -v ss >/dev/null 2>&1; then
  PORT_STATUS=$(ss -tlnp 2>/dev/null | grep ":$RECEIVER_PORT " || echo "")
elif command -v netstat >/dev/null 2>&1; then
  PORT_STATUS=$(netstat -tlnp 2>/dev/null | grep ":$RECEIVER_PORT " || echo "")
else
  PORT_STATUS=""
fi

if echo "$PORT_STATUS" | grep -q "LISTEN"; then
  check_pass "Receiver port $RECEIVER_PORT is listening"
else
  check_warn "Receiver port $RECEIVER_PORT not detected — process may be starting"
fi

# ============================================================================
# CHECK 7: Health Endpoint
# ============================================================================
log ""
log "=== CHECK 7: Health Endpoint ==="

HEALTH_TOKEN=$(node -p "require('$CONFIG_FILE').receiverToken" 2>/dev/null || echo "")
HEALTH_RESPONSE=$(curl -s --connect-timeout 3 \
  -H "Authorization: Bearer $HEALTH_TOKEN" \
  "http://localhost:$RECEIVER_PORT/health" 2>/dev/null || echo "")

if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
  check_pass "Health endpoint responding correctly"
elif [ -n "$HEALTH_RESPONSE" ]; then
  check_warn "Health endpoint responded but not with expected format: $HEALTH_RESPONSE"
else
  check_fail "Health endpoint not responding"
fi

# Skip extended checks in quick mode
if ! $QUICK_MODE; then
  # ============================================================================
  # CHECK 8: Memory Directory Status
  # ============================================================================
  log ""
  log "=== CHECK 8: Memory Directory Status ==="
  
  MEMORY_DIR="$HOME/.openclaw/workspace/memory"
  
  if [ -d "$MEMORY_DIR" ]; then
    check_pass "Memory directory exists"
    
    if [ -w "$MEMORY_DIR" ]; then
      check_pass "Memory directory is writable"
    else
      check_fail "Memory directory is not writable"
    fi
    
    # Check subdirectories
    for subdir in mesh mesh/lessons lcm threads; do
      if [ -d "$MEMORY_DIR/$subdir" ]; then
        check_pass "Memory subdirectory $subdir exists"
      else
        check_warn "Memory subdirectory $subdir does not exist"
      fi
    done
  else
    check_fail "Memory directory not found at $MEMORY_DIR"
  fi
  
  # ============================================================================
  # CHECK 9: Cron Jobs (Dream Cycle)
  # ============================================================================
  log ""
  log "=== CHECK 9: Cron Jobs ==="
  
  CRON_JOBS=$(crontab -l 2>/dev/null | grep -E "(mesh|dream)" || echo "")
  
  if echo "$CRON_JOBS" | grep -q "dream-cycle"; then
    check_pass "Dream cycle cron job configured"
    log "  Cron entry: $CRON_JOBS"
  else
    check_warn "Dream cycle cron job not found"
  fi
  
  # ============================================================================
  # CHECK 10: Log File Analysis
  # ============================================================================
  log ""
  log "=== CHECK 10: Recent Log Analysis ==="
  
  RECENT_ERRORS=0
  for logfile in "$MESH_ROOT"/receiver.log "$MESH_ROOT"/bridge.log "$MESH_ROOT"/watcher.log; do
    if [ -f "$logfile" ]; then
      ERRORS=$(tail -100 "$logfile" 2>/dev/null | grep -ci "error\|fail\|exception" || echo "0")
      RECENT_ERRORS=$((RECENT_ERRORS + ERRORS))
      BASENAME=$(basename "$logfile")
      if [ "$ERRORS" -eq 0 ]; then
        check_pass "No recent errors in $BASENAME"
      else
        check_warn "$ERRORS recent errors in $BASENAME"
      fi
    fi
  done
  
  if [ "$RECENT_ERRORS" -gt 10 ]; then
    check_warn "Total recent errors: $RECENT_ERRORS — review logs before updating"
  fi
fi

# ============================================================================
# CHECK 11: Peer Connectivity (if configured)
# ============================================================================
if ! $QUICK_MODE && [ "$PEER_COUNT" -gt 0 ]; then
  log ""
  log "=== CHECK 11: Peer Connectivity ==="
  
  PEERS_REACHABLE=0
  PEERS_UNREACHABLE=0
  
  # Parse peers from config
  PEER_URLS=$(node -p "
    const c = require('$CONFIG_FILE');
    (c.peers || []).map(p => p.url).join(' ');
  " 2>/dev/null || echo "")
  
  for peer_url in $PEER_URLS; do
    PEER_HEALTH=$(curl -s --connect-timeout 3 "$peer_url/health" 2>/dev/null || echo "")
    if echo "$PEER_HEALTH" | grep -q '"status":"ok"'; then
      check_pass "Peer reachable: $peer_url"
      PEERS_REACHABLE=$((PEERS_REACHABLE + 1))
    else
      check_warn "Peer unreachable: $peer_url"
      PEERS_UNREACHABLE=$((PEERS_UNREACHABLE + 1))
    fi
  done
  
  if [ "$PEERS_UNREACHABLE" -gt 0 ] && [ "$PEERS_UNREACHABLE" -eq "$PEER_COUNT" ]; then
    check_warn "All peers unreachable — mesh may be fragmented"
  fi
fi

# ============================================================================
# CHECK 12: Post-Update Specific Checks
# ============================================================================
if $POST_UPDATE; then
  log ""
  log "=== CHECK 12: Post-Update Validation ==="
  
  # Verify OpenClaw actually updated
  NEW_OC_VERSION=$(openclaw --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
  log "New OpenClaw version: $NEW_OC_VERSION"
  
  if [ "$NEW_OC_VERSION" != "$CURRENT_OC_VERSION" ]; then
    check_pass "OpenClaw version changed: $CURRENT_OC_VERSION → $NEW_OC_VERSION"
  else
    check_warn "OpenClaw version unchanged"
  fi
  
  # Check gateway restarted properly
  if openclaw gateway status 2>/dev/null | grep -qi "running"; then
    check_pass "Gateway running after update"
  else
    check_fail "Gateway not running after update"
  fi
  
  # Verify mesh-memory processes restarted
  sleep 2
  if pgrep -f "mesh-memory.mjs receiver" >/dev/null; then
    check_pass "Mesh-memory receiver running post-update"
  else
    check_fail "Mesh-memory receiver not running post-update"
  fi
fi

# ============================================================================
# CHECK 13: Target Version Compatibility (if specified)
# ============================================================================
if [ -n "$TARGET_VERSION" ]; then
  log ""
  log "=== CHECK 13: Target Version Compatibility ==="
  
  log "Target OpenClaw version: $TARGET_VERSION"
  
  # Check if target version is in compatible range
  # Parse current and target versions
  CURRENT_MAJOR=$(echo "$CURRENT_OC_VERSION" | cut -d. -f1)
  CURRENT_MINOR=$(echo "$CURRENT_OC_VERSION" | cut -d. -f2)
  TARGET_MAJOR=$(echo "$TARGET_VERSION" | cut -d. -f1)
  TARGET_MINOR=$(echo "$TARGET_VERSION" | cut -d. -f2)
  
  if [ "$TARGET_MAJOR" -gt "$CURRENT_MAJOR" ]; then
    check_warn "Major version update detected — full regression test required"
  elif [ "$TARGET_MINOR" -gt "$CURRENT_MINOR" ]; then
    check_warn "Minor version update detected — standard test suite required"
  elif [ "$TARGET_VERSION" = "$CURRENT_OC_VERSION" ]; then
    check_warn "Target version equals current version — no update needed"
  fi
  
  # Check changelog for breaking changes
  log "Review OpenClaw changelog for breaking changes..."
fi

# ============================================================================
# SUMMARY
# ============================================================================
log ""
log "=== SUMMARY ==="
log "Checks passed: $CHECKS_PASSED"
log "Checks failed: $CHECKS_FAILED"
log "Warnings: $CHECKS_WARNINGS"
log "Log file: $LOG_FILE"

if [ $CHECKS_FAILED -gt 0 ]; then
  error "COMPATIBILITY CHECK FAILED — Do not proceed with update"
  echo ""
  echo "Failed checks must be resolved before updating."
  echo "See $LOG_FILE for details."
  exit 1
elif [ $CHECKS_WARNINGS -gt 0 ]; then
  warn "COMPATIBILITY CHECK PASSED WITH WARNINGS — Proceed with caution"
  echo ""
  echo "Review warnings above before updating."
  echo "See $LOG_FILE for details."
  exit 2
else
  info "ALL CHECKS PASSED — Safe to proceed with update"
  echo ""
  echo "Next steps:"
  echo "  1. Run: npm run backup"
  echo "  2. Announce update to mesh"
  echo "  3. Run: openclaw update"
  echo "  4. Run: $0 --post-update"
  exit 0
fi
