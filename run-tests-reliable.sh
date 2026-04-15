#!/bin/bash
# run-tests-reliable.sh
# Reliable test runner for mesh-memory with retry logic, timeouts, and memory limits
# Created: 2026-04-14 by Woodhouse

set -euo pipefail

# Configuration
MAX_RETRIES=3
PHASE1_2_TIMEOUT=300    # 5 minutes for unit and integration
PHASE3_TIMEOUT=600      # 10 minutes for e2e
MEMORY_LIMIT_KB=4194304 # 4GB virtual memory limit

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Set memory limit
echo "Setting memory limit to 4GB..."
ulimit -v $MEMORY_LIMIT_KB

# Function to run a test phase with retry logic
run_phase() {
    local phase_name=$1
    local test_cmd=$2
    local timeout_val=$3
    local attempt=1
    
    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  $phase_name${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Command: $test_cmd"
    echo "Timeout: ${timeout_val}s | Max Retries: $MAX_RETRIES"
    echo ""
    
    while [ $attempt -le $MAX_RETRIES ]; do
        echo -e "${YELLOW}[$phase_name] Attempt $attempt of $MAX_RETRIES...${NC}"
        
        # Run test with timeout
        if timeout $timeout_val bash -c "$test_cmd" 2>&1; then
            echo -e "${GREEN}[$phase_name] ✅ Success on attempt $attempt${NC}"
            return 0
        else
            local exit_code=$?
            if [ $exit_code -eq 124 ]; then
                echo -e "${RED}[$phase_name] ⏱️  Timeout after ${timeout_val}s${NC}"
            else
                echo -e "${RED}[$phase_name] ❌ Failed with exit code $exit_code${NC}"
            fi
            
            attempt=$((attempt + 1))
            if [ $attempt -le $MAX_RETRIES ]; then
                echo -e "${YELLOW}[$phase_name] Retrying in 5 seconds...${NC}"
                sleep 5
            fi
        fi
    done
    
    echo -e "${RED}[$phase_name] 💀 All $MAX_RETRIES attempts exhausted${NC}"
    return 1
}

# Track overall success
OVERALL_SUCCESS=0

# ════════════════════════════════════════════════════════════
# PHASE 1: Unit Tests
# ════════════════════════════════════════════════════════════

UNIT_TESTS="tests/memory-backend.test.mjs tests/critical-facts-loader.test.mjs tests/tunnel-publisher.test.mjs tests/palace-mvp.test.mjs"
UNIT_CMD="node --test --test-timeout=300000 $UNIT_TESTS"

if run_phase "PHASE 1: Unit Tests" "$UNIT_CMD" $PHASE1_2_TIMEOUT; then
    echo -e "${GREEN}✅ Phase 1 Complete${NC}\n"
else
    echo -e "${RED}❌ Phase 1 Failed${NC}\n"
    OVERALL_SUCCESS=1
fi

# ════════════════════════════════════════════════════════════
# PHASE 2: Integration Tests
# ════════════════════════════════════════════════════════════

# Check if integration test file exists
if [ -f "tests/tunnel-publisher.integration.test.mjs" ]; then
    INTEGRATION_CMD="node --test --test-timeout=300000 tests/tunnel-publisher.integration.test.mjs"
    
    if run_phase "PHASE 2: Integration Tests" "$INTEGRATION_CMD" $PHASE1_2_TIMEOUT; then
        echo -e "${GREEN}✅ Phase 2 Complete${NC}\n"
    else
        echo -e "${RED}❌ Phase 2 Failed${NC}\n"
        OVERALL_SUCCESS=1
    fi
else
    echo -e "${YELLOW}⚠️  Phase 2: No integration tests found (tests/tunnel-publisher.integration.test.mjs)${NC}\n"
fi

# ════════════════════════════════════════════════════════════
# PHASE 3: E2E Tests
# ════════════════════════════════════════════════════════════

# Check if any e2e test files exist
E2E_FILES=$(ls tests/*.e2e.test.mjs 2>/dev/null || true)

if [ -n "$E2E_FILES" ]; then
    echo -e "${YELLOW}Found E2E tests:${NC}"
    echo "$E2E_FILES"
    echo ""
    
    E2E_CMD="node --test --test-timeout=600000 tests/*.e2e.test.mjs"
    
    if run_phase "PHASE 3: E2E Tests" "$E2E_CMD" $PHASE3_TIMEOUT; then
        echo -e "${GREEN}✅ Phase 3 Complete${NC}\n"
    else
        echo -e "${RED}❌ Phase 3 Failed${NC}\n"
        OVERALL_SUCCESS=1
    fi
else
    echo -e "${YELLOW}⚠️  Phase 3: No E2E tests found (tests/*.e2e.test.mjs)${NC}\n"
fi

# ════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════

echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  TEST RUN SUMMARY${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $OVERALL_SUCCESS -eq 0 ]; then
    echo -e "${GREEN}✅ All phases completed successfully${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}❌ One or more phases failed${NC}"
    echo ""
    exit 1
fi
