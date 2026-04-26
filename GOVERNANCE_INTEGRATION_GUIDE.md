# Phase 7: Governance Engine - Integration Guide

## Overview

The Governance Engine provides comprehensive security and compliance controls for mesh-memory Deal Rooms. It consists of four integrated modules:

1. **ABAC Policy Engine** - Attribute-based access control
2. **Compliance Validator** - Rule-based compliance checking
3. **Audit Vault** - WORM (Write-Once-Read-Many) audit logging
4. **Governance Integration** - Unified API and event management

## Quick Start

```javascript
import { initializeGovernance, enforcePolicy, checkGovernance } from './src/governance-integration.mjs';

// Initialize
await initializeGovernance({
  autoBlockNonCompliant: true,
  auditAllOperations: true
});

// Check access
const result = await enforcePolicy(
  { role: 'negotiator', agentId: 'liz' },
  'deal-room:dr_abc123',
  'propose'
);

if (result.allowed) {
  // Proceed with operation
} else {
  // Handle denial
  console.log('Access denied:', result.reason);
}
```

## Module Locations

| Module | Path | Size | Exports |
|--------|------|------|---------|
| ABAC Policy Engine | `src/abac-policy-engine.mjs` | ~28KB | 15+ functions |
| Compliance Validator | `src/compliance-validator.mjs` | ~30KB | 8+ functions |
| Audit Vault | `src/audit-requirements.mjs` | ~22KB | 12+ functions |
| Governance Integration | `src/governance-integration.mjs` | ~16KB | Unified API |
| Test Suite | `tests/governance-engine.test.mjs` | ~23KB | 37 tests |

## Integration with Deal Rooms

### 1. Room Creation

When creating a deal room, enforce founder permissions:

```javascript
import { createRoom } from './src/deal-room.mjs';
import { enforcePolicy } from './src/governance-integration.mjs';

async function createDealRoom(agent, purpose, scope, policy) {
  // Check permission
  const result = await enforcePolicy(
    agent,
    'deal-room:*',
    'create',
    { agentId: agent.agentId }
  );
  
  if (!result.allowed) {
    throw new Error(`Unauthorized: ${result.reason}`);
  }
  
  // Create room
  const room = await createRoom(purpose, scope, policy, participants, agent.agentId);
  
  // Log audit entry
  await logAudit({
    agentId: agent.agentId,
    action: AuditAction.CREATE,
    resource: `deal-room:${room.roomId}`,
    details: { purpose, scope },
    roomId: room.roomId
  });
  
  return room;
}
```

### 2. Context Escrow (Shared Pool)

Validate facts vs interpretations before writing to shared context:

```javascript
import { validateCompliance } from './src/governance-integration.mjs';

async function writeToContext(agent, roomId, entry) {
  // Validate compliance (facts vs interpretations)
  const compliance = await validateCompliance(
    { type: 'context_entry', entry },
    { agentId: agent.agentId, roomId }
  );
  
  if (!compliance.compliant) {
    const violations = compliance.results
      .filter(r => r.outcome === 'non_compliant');
    
    for (const v of violations) {
      console.error(`Compliance violation: ${v.ruleName} - ${v.remediation}`);
    }
    
    throw new Error('Context entry failed compliance check');
  }
  
  // Write to TKG
  await assertFact(roomId, entry.subject, entry.predicate, entry.object, ...);
}
```

### 3. Decision/Consensus

Validate consensus requirements for critical decisions:

```javascript
async function submitDecision(agent, roomId, decision) {
  // Full governance check
  const result = await checkGovernance({
    agent,
    resource: `deal-room:${roomId}`,
    action: 'propose',
    decision,
    context: { roomId, requiresConsensus: true }
  });
  
  if (!result.allowed) {
    throw new Error(`Decision blocked: ${result.policy.reason}`);
  }
  
  if (!result.compliance?.compliant) {
    throw new Error('Decision failed compliance validation');
  }
  
  // Proceed with consensus workflow
  // ...
}
```

### 4. Audit Trail

All deal room operations are automatically audited:

```javascript
// Room state changes
await logAudit({
  agentId,
  action: AuditAction.ROOM_STATE_CHANGE,
  resource: `deal-room:${roomId}`,
  details: { from: 'PENDING_CONSENT', to: 'ACTIVE' },
  roomId
});

// Participant actions
await logAudit({
  agentId,
  action: AuditAction.CONSENT,
  resource: `deal-room:${roomId}`,
  details: { accepted: true, role: 'negotiator' },
  roomId
});

// Policy changes
await logAudit({
  agentId,
  action: AuditAction.POLICY_CHANGE,
  resource: `deal-room:${roomId}`,
  details: { policyId, change: 'activated' },
  roomId,
  severity: AuditSeverity.WARNING
});
```

## Policy Configuration

### Sample Policies (see `policies/`)

1. **sample-policy-founder.json** - Full access for founders
2. **sample-policy-negotiator.json** - Standard negotiator access with time constraints
3. **sample-policy-reviewer.json** - Read-only for reviewers
4. **sample-policy-critical-ops.json** - Escalation requirements for critical operations

### Loading Policies

```javascript
import { loadPolicy } from './src/governance-integration.mjs';

// Load and activate
const policy = await loadPolicy('./policies/sample-policy-founder.json', {
  activate: true,
  loadedBy: 'admin'
});
```

### Policy Attributes

Available agent attributes for policy conditions:
- `role` - Agent role (founder, admin, negotiator, reviewer, observer)
- `clearance_level` - Numeric clearance level (1-5)
- `time_of_day` - Current time (HH:MM)
- `location` - Geographic location
- `device_trust` - Device trust score (0.0-1.0)
- Custom attributes via context

## Compliance Rules

### Built-in Rules

| Rule ID | Name | Severity | Description |
|---------|------|----------|-------------|
| COMPLIANCE-001 | Facts vs Interpretations | CRITICAL | Prevents bias laundering |
| COMPLIANCE-002 | WORM Audit Trail | CRITICAL | Requires audit logging |
| COMPLIANCE-003 | Multi-Agent Consensus | HIGH | Requires consensus for critical decisions |
| COMPLIANCE-004 | Data Retention Policy | MEDIUM | Enforces retention policies |
| COMPLIANCE-005 | Privacy Filter Enforcement | HIGH | Requires PII/PHI redaction |
| COMPLIANCE-006 | Access Control Validation | HIGH | Verifies ABAC enforcement |
| COMPLIANCE-007 | Audit Chain Integrity | CRITICAL | Verifies hash chain integrity |

### Custom Rules

```javascript
import { createRule } from './src/compliance-validator.mjs';

const customRule = await createRule({
  name: 'Custom Business Rule',
  description: 'Enforces custom business logic',
  severity: ComplianceSeverity.MEDIUM,
  category: 'business',
  customCheckLogic: {
    condition: { field: 'dealValue', operator: '<=', value: 100000 },
    expectedOutcome: 'compliant'
  }
});
```

## Audit Vault

### Hash Chain Verification

```javascript
import { verifyChain } from './src/audit-requirements.mjs';

// Verify room audit chain
const verification = await verifyChain('dr_abc123');

if (!verification.valid) {
  console.error('Audit chain tampered!');
  for (const invalid of verification.invalidEntries) {
    console.error(`  Entry ${invalid.entryId}: ${invalid.error}`);
  }
}
```

### Export for Compliance

```javascript
import { exportAudit } from './src/audit-requirements.mjs';

const export = await exportAudit({
  roomId: 'dr_abc123',
  startTime: '2026-04-01T00:00:00Z',
  endTime: '2026-04-30T23:59:59Z',
  format: 'jsonl'  // or 'json', 'csv'
});

console.log(`Exported ${export.entryCount} entries to ${export.exportPath}`);
```

## Event Handling

### Subscribe to Governance Events

```javascript
import { onGovernanceEvent } from './src/governance-integration.mjs';

// Policy violations
onGovernanceEvent('policyViolation', (event) => {
  console.warn(`Policy violation by ${event.agent}: ${event.reason}`);
  // Send alert, notify admin, etc.
});

// Compliance failures
onGovernanceEvent('complianceFailure', (event) => {
  console.error(`Compliance failure: ${event.ruleName}`);
  console.error(`Remediation: ${event.remediation}`);
  // Escalate, block operation, etc.
});

// Audit alerts
onGovernanceEvent('auditAlert', (event) => {
  console.error(`Audit alert: ${event.severity} - ${event.message}`);
});
```

## Monitoring

### Governance Report

```javascript
import { getGovernanceReport } from './src/governance-integration.mjs';

const report = await getGovernanceReport({
  period: {
    start: '2026-04-01T00:00:00Z',
    end: '2026-04-30T23:59:59Z'
  }
});

console.log('Policies:', report.policies.total);
console.log('Compliance Rate:', report.compliance.complianceRate + '%');
console.log('Total Audit Entries:', report.audit.totalEntries);

if (report.alerts.length > 0) {
  for (const alert of report.alerts) {
    console.warn(`[${alert.severity.toUpperCase()}] ${alert.message}`);
  }
}
```

## Testing

Run the test suite:

```bash
node --test tests/governance-engine.test.mjs
```

Test coverage:
- ABAC Policy Engine: 10 tests
- Compliance Validator: 8 tests
- Audit Vault: 8 tests
- Governance Integration: 4 tests
- Policy Management CLI: 4 tests
- Deal Room Integration: 3 tests
- **Total: 37 tests**

## Migration from v1.x

1. Initialize governance on startup
2. Load existing deal rooms into audit chain
3. Create policies matching existing access controls
4. Gradually enable auto-blocking

## Best Practices

1. **Always initialize governance** before other operations
2. **Use checkGovernance()** for critical operations (combines policy + compliance)
3. **Handle policy violations gracefully** - provide clear error messages
4. **Monitor compliance reports** regularly
5. **Verify audit chains** periodically
6. **Archive old audit entries** to manage storage
7. **Use signed audit entries** for high-security environments

## Troubleshooting

### Policy not matching
- Check agent attributes match principal pattern
- Verify policy is activated
- Check condition constraints (time, location, etc.)

### Compliance false positives
- Review built-in rule logic
- Adjust custom rules as needed
- Use `needs_review` outcome for edge cases

### Audit chain breaks
- Indicates tampering or corruption
- Restore from backup if necessary
- Investigate security incident

## Support

For questions or issues:
1. Check test suite for usage examples
2. Review sample policies in `policies/`
3. Consult the mesh-memory protocol documentation
