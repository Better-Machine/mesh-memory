#!/bin/bash
# run-tests-reliable.sh
# Save to: ~/.openclaw/workspace/projects/mesh-memory/run-tests-reliable.sh

set -euo pipefail

MAX_RETRIES=3
PHASE1_2_TIMEOUT=300
PHASE3_TIMEOUT=600
MEMORY_LIMIT_KB=4194304

ulimit -v $MEMORY_LIMIT_KB

run_phase() {
 local phase_name=$1
 local test_cmd=$2
 local timeout_val=$3
 local attempt=1
 
 echo "=== $phase_name ==="
 
 while [ $attempt -le $MAX_RETRIES ]; do
 echo "[$phase_name] Attempt $attempt of $MAX_RETRIES..."
 
 if timeout $timeout_val bash -c "$test_cmd" 2>&1; then
 echo "[$phase_name] ✅ Success"
 return 0
 else
 echo "[$phase_name] ❌ Failed (exit code $?)"
 attempt=$((attempt + 1))
 [ $attempt -le $MAX_RETRIES ] && sleep 5
 fi
 done
 
 echo "[$phase_name] 💀 All retries exhausted"
 return 1
}

# Phase 1: Unit
UNIT_TESTS="tests/memory-backend.test.mjs tests/critical-facts-loader.test.mjs tests/tunnel-publisher.test.mjs tests/palace-mvp.test.mjs"
run_phase "PHASE 1: Unit Tests" "node --test --test-timeout=300000 $UNIT_TESTS" $PHASE1_2_TIMEOUT || exit 1

# Phase 2: Integration
if [ -f "tests/tunnel-publisher.integration.test.mjs" ]; then
 run_phase "PHASE 2: Integration" "node --test --test-timeout=300000 tests/tunnel-publisher.integration.test.mjs" $PHASE1_2_TIMEOUT || exit 1
fi

# Phase 3: E2E
if ls tests/*.e2e.test.mjs 1>/dev/null 2>&1; then
 run_phase "PHASE 3: E2E Tests" "node --test --test-timeout=600000 tests/*.e2e.test.mjs" $PHASE3_TIMEOUT || exit 1
fi

echo "✅ All phases complete"
