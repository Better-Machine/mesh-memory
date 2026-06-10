#!/usr/bin/env bash
#
# mesh-memory v2 install script
# Handles Linux (systemd) and macOS (launchctl) deployment
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
OS="$(uname -s)"

echo "=== mesh-memory v2 Installer ==="
echo "OS: $OS"
echo "Project dir: $PROJECT_DIR"

# Detect user
if [ "$OS" = "Linux" ]; then
    USER="erik-ross"
    HOME_DIR="/home/$USER"
    SERVICE_FILE="$PROJECT_DIR/mesh-memory.service"
    SYSTEMD_DIR="$HOME_DIR/.config/systemd/user"
elif [ "$OS" = "Darwin" ]; then
    USER="FOS_Erik"
    HOME_DIR="/Users/$USER"
    PLIST_FILE="$PROJECT_DIR/ai.openclaw.mesh-memory.plist"
    LAUNCHAGENTS_DIR="$HOME_DIR/Library/LaunchAgents"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

WORKSPACE="$HOME_DIR/.openclaw/workspace"
MESH_DIR="$WORKSPACE/projects/mesh-memory"
MEMORY_DIR="$WORKSPACE/memory"

echo "Home: $HOME_DIR"
echo "Workspace: $WORKSPACE"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found"
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
REQUIRED="18.0.0"

version_ge() {
    [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

if ! version_ge "$NODE_VERSION" "$REQUIRED"; then
    echo "ERROR: Node.js $NODE_VERSION < $REQUIRED"
    exit 1
fi

echo "Node.js: $NODE_VERSION ✅"

# Ensure directories
mkdir -p "$MESH_DIR"
mkdir -p "$MEMORY_DIR"
mkdir -p "$MEMORY_DIR/palace"
mkdir -p "$MEMORY_DIR/mesh"

# Install dependencies
echo "Installing dependencies..."
cd "$PROJECT_DIR"
npm install --production better-sqlite3 chokidar 2>/dev/null || {
    echo "Note: Some deps may already be installed globally"
}

# Stop old services
echo "Stopping old mesh-memory services..."
if [ "$OS" = "Linux" ]; then
    systemctl --user stop mesh-memory-bridge 2>/dev/null || true
    systemctl --user stop mesh-memory-receiver 2>/dev/null || true
    systemctl --user stop mesh-memory-watcher 2>/dev/null || true
    systemctl --user stop mesh-memory-relay 2>/dev/null || true
    systemctl --user stop tunnel-publisher 2>/dev/null || true
    systemctl --user stop palace-daemon 2>/dev/null || true
    systemctl --user stop mesh-memory 2>/dev/null || true
elif [ "$OS" = "Darwin" ]; then
    launchctl bootout gui/$(id -u)/ai.openclaw.mesh-memory-bridge 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.mesh-memory-receiver 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.mesh-memory-watcher 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.mesh-memory-relay 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.tunnel-publisher 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.palace 2>/dev/null || true
    launchctl bootout gui/$(id -u)/ai.openclaw.mesh-memory 2>/dev/null || true
fi

# Install new service
echo "Installing mesh-memory v2 service..."
if [ "$OS" = "Linux" ]; then
    mkdir -p "$SYSTEMD_DIR"
    cp "$SERVICE_FILE" "$SYSTEMD_DIR/"
    systemctl --user daemon-reload
    systemctl --user enable mesh-memory
    systemctl --user start mesh-memory
    echo "Service installed ✅"
    systemctl --user status mesh-memory --no-pager || true
elif [ "$OS" = "Darwin" ]; then
    mkdir -p "$LAUNCHAGENTS_DIR"
    cp "$PLIST_FILE" "$LAUNCHAGENTS_DIR/"
    launchctl bootstrap gui/$(id -u) "$LAUNCHAGENTS_DIR/ai.openclaw.mesh-memory.plist"
    launchctl kickstart gui/$(id -u)/ai.openclaw.mesh-memory
    echo "Service installed ✅"
    launchctl list | grep mesh-memory || true
fi

# Health check
echo ""
echo "Health check..."
sleep 2
HEALTH=$(curl -s --connect-timeout 5 http://localhost:18805/health 2>/dev/null || echo '{"ok":false}')
echo "Health: $HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
    echo ""
    echo "=== mesh-memory v2 installed successfully ✅ ==="
    echo "Port: 18805"
    echo "Health: http://localhost:18805/health"
    echo "API docs: http://localhost:18805/"
else
    echo ""
    echo "WARNING: Health check failed. Check logs:"
    if [ "$OS" = "Linux" ]; then
        echo "  journalctl --user -u mesh-memory"
    else
        echo "  tail -50 /tmp/openclaw/mesh-memory.err.log"
    fi
    exit 1
fi
