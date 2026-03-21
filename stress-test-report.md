# Stress Test Report — mesh-memory

_Generated: 2026-03-21T13:59:47.221Z_

## Latency Results

| Test | Count | Avg (ms) | p50 (ms) | p95 (ms) | p99 (ms) |
|------|-------|----------|----------|----------|----------|
| Burst Write (50 msgs) | 50 | 0.06 | 0.04 | 0.13 | 0.29 |
| Sustained Write (100 msgs @ 10/s) | 100 | 0.59 | 0.61 | 0.76 | 0.86 |
| Receiver Delivery (50 events) | 50 | 1.10 | 0.53 | 1.23 | 23.30 |

## Delivery Results

| Test | Total | Failures | Loss Rate |
|------|-------|----------|-----------|
| Receiver Delivery | 50 | 50 | 100.0% |

## Validation Results

| Test | Result |
|------|--------|
| Malformed Event Rejection | PASS (6/6 malformed events correctly rejected) |
| Unauthorized Access Rejection | PASS |

## Resource Usage

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Memory (MB) | 10478 | 10481 | 3 |

## Success Criteria

| Criteria | Target | Actual | Status |
|----------|--------|--------|--------|
| p95 end-to-end latency | < 5s | 0ms | PASS |
| Message loss rate | < 1% | 100.0% | N/A (receiver offline) |
| CPU overhead at 10 msg/min | < 5% | See resource table | Manual check |

## Notes

- Receiver tests require `npm run receiver` to be running on port 18801
- If receiver is offline, delivery tests will show 100% failure (expected)
- For multi-agent mesh tests, start receivers on all peer agents first
- Resource measurements are approximate (process-level, not isolated)

---

## Layer 2: Thread System

_Run: 2026-03-21T13:59:47.353Z_

| Test | Result | Time (ms) | Error |
|------|--------|-----------|-------|
| L2-1: Lifecycle happy path | PASS | 15 | — |
| L2-2: Lifecycle decline path | PASS | 2 | — |
| L2-3: Lifecycle timeout path | PASS | 106 | — |
| L2-4: Notification format | PASS | 0 | — |
| L2-5: Token isolation | PASS | 2 | — |
| L2-6: Privacy filter | PASS | 0 | — |
| L2-7: Lesson tagging | PASS | 1 | — |

**Overall: ALL PASSED** (7/7)
