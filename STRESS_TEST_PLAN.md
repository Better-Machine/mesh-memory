# Stress Test Plan — mesh-memory

## Overview

The stress test suite validates mesh-memory under load, verifying latency, reliability, and resource efficiency across single-agent and multi-agent scenarios.

## Test Scenarios

### 1. Burst Write
- **What:** 50 messages written to a JSONL file with no delay (maximum throughput)
- **Measures:** Per-write latency, total throughput
- **Why:** Validates the watcher can handle rapid bursts (e.g., fast conversation exchanges)

### 2. Sustained Write
- **What:** 100 messages at 10 messages/second (100ms interval)
- **Measures:** Per-write latency, consistency over time
- **Why:** Simulates realistic sustained conversation load

### 3. Receiver Delivery
- **What:** 50 MemoryEvents POSTed to the receiver endpoint
- **Measures:** HTTP round-trip latency, failure rate
- **Why:** Validates the receiver can handle incoming events at the rate the relay sends them
- **Requires:** `npm run receiver` running on localhost:18801

### 4. Malformed Event Rejection
- **What:** 6 malformed payloads sent to the receiver
- **Measures:** Rejection rate (should be 100%)
- **Why:** Validates input validation prevents bad data from corrupting the mesh

### 5. Unauthorized Access
- **What:** Event sent without bearer token
- **Measures:** Whether the request is rejected with 401
- **Why:** Validates authentication prevents unauthorized writes

## Multi-Agent Scenarios (Manual)

For multi-agent testing, run the following on separate machines or in separate terminals:

### 2-Agent Mesh
1. Start receiver on Agent A: `npm run receiver` (port 18801)
2. Start receiver on Agent B: `npm run receiver` (port 18801, different machine)
3. Configure each agent's peers to point to the other
4. Start watcher on Agent A: `npm run watcher`
5. Write test messages to Agent A's session JSONL
6. Verify messages appear in Agent B's `memory/mesh/` directory

### 3-Agent Mesh
Same as above with three agents. Verify:
- Messages from A appear on B and C
- Messages from B appear on A and C
- Messages from C appear on A and B

## Success Criteria

| Criteria | Target | How to Verify |
|----------|--------|---------------|
| p95 end-to-end latency | < 5 seconds | Stress test report, "Latency Results" table |
| Message loss rate | < 1% | Stress test report, "Delivery Results" table |
| CPU overhead at 10 msg/min | < 5% | Monitor system during sustained test, check resource table |
| Malformed event rejection | 100% | Stress test report, "Validation Results" table |
| Auth rejection | 100% | Stress test report, "Validation Results" table |
| Single peer failure | No cascade | Manually stop one peer, verify others still receive |

## How to Run

### Prerequisites
```bash
npm install
```

### Run with receiver (full test)
```bash
# Terminal 1: Start the receiver
npm run receiver

# Terminal 2: Run stress test
npm run stress-test
```

### Run without receiver (write tests only)
```bash
npm run stress-test
# Receiver tests will show 100% failure — this is expected
```

### View results
```bash
cat stress-test-report.md
```

## How to Interpret Results

### Latency Results Table
- **Avg:** Mean latency — useful for general performance sense
- **p50:** Median — what "typical" looks like
- **p95:** 95th percentile — the "slow" case that still happens often
- **p99:** 99th percentile — worst-case-ish (tail latency)

### Key things to look for
1. **p95 under 5s** for all operations → system meets latency target
2. **0 failures** in delivery → relay and receiver are reliable
3. **Memory delta under 50MB** → no memory leaks during test
4. **All validation tests PASS** → input validation and auth are working

### Red flags
- p99 >> p95: high tail latency, possible GC pauses or I/O contention
- Delivery failures > 0 (when receiver is running): relay or receiver bug
- Memory growing linearly with message count: possible leak in watcher offsets map
- Malformed test FAIL: input validation gap

## Test Report Location

Reports are written to `stress-test-report.md` in the project root.

## Authors

- **Agent B** — AI partner, Better Machine (@LizSquirrelBot)
- **Erik Ross** — Founder, Better Machine (@Kosfootel)
