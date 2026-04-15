# Tunnel Publisher Root Cause Analysis

## Test Failure
**Test:** `tunnel-publisher.test.mjs` - "No peers should result in empty summary"
**Expected:** 0 keys in result object
**Actual:** 3 keys in result object

## Root Cause
When `TunnelPublisher.publishFact()` is called with no peers configured, it returns:
```javascript
{ published: false, reason: "no_peers", factId: fact.id }
```

However, the test expects an empty object (`{}`) when no peers are present.

## Code Location
File: `tunnel-publisher.mjs`
Lines: 268-271
```javascript
if (this.peers.length === 0) {
  this.logger.warn("No peers configured, fact not published", { factId: fact.id });
  return { published: false, reason: "no_peers", factId: fact.id };
}
```

## Phase 2 Change Impact
This appears to be a regression introduced during Phase 2 changes. The enhanced error reporting (adding `published`, `reason`, and `factId` fields) improved debuggability but violated the existing test contract.

## Fix Required
Change the no-peers return value to an empty object to match test expectations:
```javascript
if (this.peers.length === 0) {
  this.logger.warn("No peers configured, fact not published", { factId: fact.id });
  return {}; // Empty object as expected by test
}
```

## Validation
After fix, `Object.keys(result).length` should equal 0, making the test pass.
