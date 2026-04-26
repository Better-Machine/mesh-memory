# A2A Integration Test Report

**Date:** 2026-04-26T22:22:46.851Z
**Duration:** 344ms

## Results

| Metric | Value |
|--------|-------|
| Total | 25 |
| Passed | 22 |
| Failed | 3 |

## Test Cases

| Test | Status |
|------|--------|
| Should queue message with delivery guarantee | PASS |
| Should acknowledge delivery | PASS |
| Should mark delivery as sent | PASS |
| Should track failed attempts | PASS |
| Should retry from dead letter queue | PASS |
| Should calculate queue statistics | PASS |
| Should start with closed circuit | PASS |
| Should open circuit after 5 failures | PASS |
| Should close circuit on success | PASS |
| Should track consecutive failures | PASS |
| Should generate valid context ID | PASS |
| Should create new context | PASS |
| Should reuse existing context | PASS |
| Should store and retrieve messages | PASS |
| Should close context | PASS |
| Should register a new peer | PASS |
| Should reject invalid peer config | PASS |
| Should retrieve registered peer | PASS |
| Should return null for unknown peer | PASS |
| Should update peer health | FAIL |
| Should track failed requests | FAIL |
| Should filter by capability | PASS |
| Should unregister peer | FAIL |
| Should initialize integration | PASS |
| Should register and discover peers | PASS |

## Failures

### Should update peer health
- Expected values to be strictly equal:

5 !== 1


### Should track failed requests
- Expected values to be strictly equal:

5 !== 1


### Should unregister peer
- Should unregister successfully


## Conclusion

⚠️ 3 test(s) failed. Please review.
