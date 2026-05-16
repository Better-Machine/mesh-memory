#!/bin/bash
# Palace Daemon quick test script
# Tests basic API endpoints

echo "🏛️  Palace Daemon API Test"
echo "=========================="
echo ""

DAEMON_URL="${PALACE_URL:-http://localhost:18810}"
echo "Testing: $DAEMON_URL"
echo ""

# Test 1: Health check
echo "1. Health check..."
curl -s "$DAEMON_URL/health" | jq . 2>/dev/null || echo "Failed"
echo ""

# Test 2: Wake-up context (with limits)
echo "2. Wake-up context (max 5 facts)..."
curl -s "$DAEMON_URL/wake-up-context?maxFacts=5" | jq '.data | {l0_agent: .l0.agent.name, l1_count: .l1Count, tokens: .tokenEstimate}' 2>/dev/null || echo "Failed"
echo ""

# Test 3: Critical facts
echo "3. Critical facts (category: standing_instructions)..."
curl -s "$DAEMON_URL/facts/critical?category=standing_instructions" | jq '.data.facts | length' 2>/dev/null || echo "Failed"
echo "  facts returned"
echo ""

# Test 4: Search deep facts
echo "4. Search deep facts ('infrastructure')..."
curl -s "$DAEMON_URL/facts/search?q=infrastructure" | jq '.data | {query: .query, results: .count, titles: [.facts[].content.title]}' 2>/dev/null || echo "Failed"
echo ""

# Test 5: Metrics
echo "5. Daemon metrics..."
curl -s "$DAEMON_URL/metrics" | jq '.data | {version: .daemon.version, requests: .requests.total, uptime: .daemon.uptime}' 2>/dev/null || echo "Failed"
echo ""

echo "=========================="
echo "Test complete"
