/**
 * @module governance-integration
 * @description Unified Governance API for Mesh Memory Protocol v2.0
 * 
 * Provides a single interface for all governance operations:
 * - enforcePolicy() — ABAC check
 * - validateCompliance() — compliance validation
 * - logAudit() — WORM audit logging
 * - getGovernanceReport() — comprehensive status
 * 
 * Real-time enforcement: blocks non-compliant operations
 * Event-driven notifications for violations and alerts
 * 
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { loadConfig } from '../config.mjs';

// Import governance modules
import {
  initializeABAC,
  evaluate as evaluatePolicy,
  createPolicy,
  activatePolicy,
  deactivatePolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  rollbackPolicy,
  getPolicyVersions,
  deprecatePolicy,
  loadPolicyFromFile,
  validatePolicyJSON,
  Policy,
  PolicyDecision
} from './abac-policy-engine.mjs';

import {
  initializeComplianceValidator,
  validate as validateComplianceDecision,
  createRule,
  getValidationHistory,
  generateComplianceReport,
  ComplianceRule,
  ComplianceSeverity,
  ComplianceOutcome,
  BUILTIN_RULES
} from './compliance-validator.mjs';

import {
  initializeAuditVault,
  logAudit as logAuditEntry,
  verifyChain,
  registerAgentKey,
  generateAgentKeyPair,
  queryAudit,
  archiveOldEntries,
  exportAudit,
  getAuditStats,
  getVerificationHistory,
  AuditEntry,
  AuditAction,
  AuditSeverity
} from './audit-requirements.mjs';

// Config
let config = null;
let initialized = false;

// Event emitter for governance events
const governanceEvents = new EventEmitter();

// Governance configuration
let governanceConfig = {
  autoBlockNonCompliant: true,
  escalateOnViolation: true,
  auditAllOperations: true,
  requireSignatures: false,
  defaultRetentionDays: 90,
  alertSeverityThreshold: ComplianceSeverity.HIGH
};

/**
 * Initialize the governance integration layer
 * @param {Object} options - Configuration options
 * @returns {Promise<void>}
 */
export async function initializeGovernance(options = {}) {
  if (initialized) {
    console.log('[governance-integration] Already initialized');
    return;
  }
  
  config = loadConfig();
  
  // Merge options
  governanceConfig = { ...governanceConfig, ...options };
  
  // Initialize all sub-modules
  await initializeABAC();
  await initializeComplianceValidator();
  await initializeAuditVault();
  
  // Log initialization
  await logGovernanceEvent('GOVERNANCE_INITIALIZED', 'system', {
    config: governanceConfig,
    timestamp: new Date().toISOString()
  });
  
  initialized = true;
  console.log('[governance-integration] Initialized');
}

/**
 * Log a governance event to audit
 * @param {string} action
 * @param {string} agentId
 * @param {Object} details
 */
async function logGovernanceEvent(action, agentId, details) {
  try {
    await logAuditEntry({
      agentId,
      action: AuditAction.POLICY_CHANGE,
      resource: 'governance-system',
      details: { event: action, ...details },
      severity: AuditSeverity.INFO
    });
  } catch (err) {
    console.error('[Governance] Failed to log event:', err.message);
  }
}

/**
 * Enforce ABAC policy on an operation
 * @param {Object} agent - Agent attributes
 * @param {string} resource - Resource identifier
 * @param {string} action - Requested action
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} { allowed: boolean, decision: string, reason: string, policy: Object }
 */
export async function enforcePolicy(agent, resource, action, context = {}) {
  if (!initialized) {
    throw new Error('Governance system not initialized. Call initializeGovernance() first.');
  }
  
  const result = await evaluatePolicy(agent, resource, action, context);
  
  const allowed = result.decision === PolicyDecision.ALLOW;
  
  // Log to audit
  if (governanceConfig.auditAllOperations) {
    await logAuditEntry({
      agentId: agent.agentId || agent.id || 'unknown',
      action: AuditAction.ACCESS,
      resource,
      details: {
        requestedAction: action,
        decision: result.decision,
        reason: result.reason,
        matchedPolicy: result.matchedPolicy,
        matchedRules: result.matchedRules
      },
      severity: allowed ? AuditSeverity.INFO : AuditSeverity.WARNING,
      roomId: context.roomId
    });
  }
  
  // Emit event on violation
  if (!allowed) {
    governanceEvents.emit('policyViolation', {
      policy: result.matchedPolicy,
      agent: agent.agentId || agent.id,
      action,
      resource,
      reason: result.reason,
      timestamp: new Date().toISOString()
    });
  }
  
  return {
    allowed,
    decision: result.decision,
    reason: result.reason,
    policy: result.matchedPolicy,
    matchedRules: result.matchedRules
  };
}

/**
 * Validate a decision for compliance
 * @param {Object} decision - The decision to validate
 * @param {Object} context - Validation context
 * @returns {Promise<Object>} { compliant: boolean, outcome: string, results: Array, summary: Object }
 */
export async function validateCompliance(decision, context = {}) {
  if (!initialized) {
    throw new Error('Governance system not initialized. Call initializeGovernance() first.');
  }
  
  const result = await validateComplianceDecision(decision, context);
  
  // Log to audit for non-compliant results
  if (result.outcome !== ComplianceOutcome.COMPLIANT) {
    const severity = result.summary.criticalViolations > 0 
      ? AuditSeverity.ERROR 
      : AuditSeverity.WARNING;
    
    await logAuditEntry({
      agentId: context.agentId || decision.agentId || 'system',
      action: AuditAction.AUDIT_VERIFICATION,
      resource: context.resource || decision.resource || 'compliance-check',
      details: {
        decisionType: decision.type,
        complianceOutcome: result.outcome,
        violations: result.summary.nonCompliant,
        criticalViolations: result.summary.criticalViolations
      },
      severity,
      roomId: context.roomId
    });
    
    // Emit compliance failure event
    if (result.outcome === ComplianceOutcome.NON_COMPLIANT) {
      const violations = result.results.filter(r => r.outcome === ComplianceOutcome.NON_COMPLIANT);
      
      for (const violation of violations) {
        governanceEvents.emit('complianceFailure', {
          rule: violation.ruleId,
          ruleName: violation.ruleName,
          severity: violation.severity,
          decision: decision.type,
          details: violation.details,
          remediation: violation.remediation,
          timestamp: new Date().toISOString()
        });
      }
    }
  }
  
  return {
    compliant: result.outcome === ComplianceOutcome.COMPLIANT,
    outcome: result.outcome,
    results: result.results,
    summary: result.summary
  };
}

/**
 * Log an audit event
 * @param {Object} event - Event data
 * @param {Object} options - Logging options { signWithKey?, roomId? }
 * @returns {Promise<AuditEntry>}
 */
export async function logAudit(event, options = {}) {
  if (!initialized) {
    throw new Error('Governance system not initialized. Call initializeGovernance() first.');
  }
  
  return await logAuditEntry(event, options);
}

/**
 * Perform full governance check: policy + compliance + audit
 * @param {Object} request - { agent, resource, action, decision, context }
 * @returns {Promise<Object>} Full governance result
 */
export async function checkGovernance(request) {
  const { agent, resource, action, decision = {}, context = {} } = request;
  
  if (!initialized) {
    throw new Error('Governance system not initialized');
  }
  
  // Step 1: Policy enforcement
  const policyResult = await enforcePolicy(agent, resource, action, context);
  
  // Step 2: If policy allows, check compliance
  let complianceResult = null;
  if (policyResult.allowed) {
    complianceResult = await validateCompliance(decision, context);
  }
  
  // Step 3: Determine final outcome
  const finalAllowed = policyResult.allowed && (!complianceResult || complianceResult.compliant);
  
  // Step 4: Block if configured and non-compliant
  if (!finalAllowed && governanceConfig.autoBlockNonCompliant) {
    await logAuditEntry({
      agentId: agent.agentId || agent.id || 'unknown',
      action: AuditAction.ACCESS,
      resource: resource || 'governance-blocked',
      details: {
        requestedAction: action,
        policyDecision: policyResult.decision,
        complianceOutcome: complianceResult?.outcome,
        reason: 'Governance check failed - operation blocked'
      },
      severity: AuditSeverity.ERROR,
      roomId: context.roomId
    });
  }
  
  return {
    allowed: finalAllowed,
    policy: policyResult,
    compliance: complianceResult,
    blocked: !finalAllowed && governanceConfig.autoBlockNonCompliant
  };
}

/**
 * Get comprehensive governance report
 * @param {Object} filters - Report filters
 * @returns {Promise<Object>}
 */
export async function getGovernanceReport(filters = {}) {
  if (!initialized) {
    throw new Error('Governance system not initialized');
  }
  
  const report = {
    generatedAt: new Date().toISOString(),
    period: filters.period || { start: null, end: null },
    
    policies: {
      total: 0,
      active: 0,
      deprecated: 0
    },
    
    compliance: {
      totalValidations: 0,
      compliant: 0,
      nonCompliant: 0,
      needsReview: 0,
      complianceRate: 0,
      criticalViolations: 0
    },
    
    audit: {
      totalEntries: 0,
      entriesBySeverity: {},
      chainStatus: {},
      archivedCount: 0
    },
    
    alerts: []
  };
  
  // Get policy stats
  const policies = await listPolicies({ includeDeprecated: true });
  report.policies.total = policies.length;
  report.policies.active = policies.filter(p => p.isActive).length;
  report.policies.deprecated = policies.filter(p => p.isDeprecated).length;
  
  // Get compliance report
  const complianceReport = await generateComplianceReport({
    startTime: filters.period?.start,
    endTime: filters.period?.end
  });
  report.compliance = complianceReport.summary;
  report.compliance.violationsByRule = complianceReport.violationsByRule;
  
  // Get audit stats
  const auditStats = await getAuditStats({
    startTime: filters.period?.start,
    endTime: filters.period?.end
  });
  report.audit = auditStats;
  
  // Verify chains
  try {
    const chains = await getActiveRoomIds();
    for (const roomId of chains) {
      try {
        const verification = await verifyChain(roomId);
        report.audit.chainStatus[roomId] = {
          valid: verification.valid,
          entries: verification.entriesChecked
        };
      } catch (err) {
        report.audit.chainStatus[roomId] = { valid: false, error: err.message };
      }
    }
  } catch (err) {
    report.audit.chainStatus = { error: 'No audit chains available' };
  }
  
  // Collect alerts
  if (report.compliance.criticalViolations > 0) {
    report.alerts.push({
      severity: 'critical',
      message: `${report.compliance.criticalViolations} critical compliance violations detected`,
      timestamp: report.generatedAt
    });
  }
  
  if (report.compliance.complianceRate < 90) {
    report.alerts.push({
      severity: 'high',
      message: `Compliance rate below target: ${report.compliance.complianceRate}%`,
      timestamp: report.generatedAt
    });
  }
  
  return report;
}

/**
 * Get list of active room IDs (helper)
 * @returns {Promise<Array>}
 */
async function getActiveRoomIds() {
  // Query audit entries for unique room IDs
  const rows = await queryAudit({ limit: 1000 });
  const roomIds = [...new Set(rows.map(e => e.roomId).filter(id => id))];
  return roomIds.length > 0 ? roomIds : ['global'];
}

/**
 * Subscribe to governance events
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 */
export function onGovernanceEvent(event, handler) {
  governanceEvents.on(event, handler);
}

/**
 * Remove governance event listener
 * @param {string} event
 * @param {Function} handler
 */
export function offGovernanceEvent(event, handler) {
  governanceEvents.off(event, handler);
}

/**
 * Load a policy from JSON file
 * @param {string} filePath
 * @param {Object} options - { activate, loadedBy }
 * @returns {Promise<Policy>}
 */
export async function loadPolicy(filePath, options = {}) {
  const policy = await loadPolicyFromFile(filePath, options.loadedBy || 'system');
  
  if (options.activate) {
    await activatePolicy(policy.id, options.loadedBy || 'system');
  }
  
  return policy;
}

/**
 * Policy Management CLI operations
 * These are exposed for administrative use
 */

/**
 * List all policies
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
export async function listAllPolicies(filters = {}) {
  return await listPolicies(filters);
}

/**
 * Get a specific policy
 * @param {string} policyId
 * @returns {Promise<Policy>}
 */
export async function getPolicyById(policyId) {
  return await getPolicy(policyId);
}

/**
 * Activate a policy
 * @param {string} policyId
 * @param {string} activatedBy
 * @returns {Promise<Policy>}
 */
export async function enablePolicy(policyId, activatedBy = 'system') {
  const policy = await activatePolicy(policyId, activatedBy);
  
  await logGovernanceEvent('POLICY_ACTIVATED', activatedBy, {
    policyId,
    policyName: policy.name
  });
  
  return policy;
}

/**
 * Deactivate a policy
 * @param {string} policyId
 * @param {string} deactivatedBy
 * @returns {Promise<Policy>}
 */
export async function disablePolicy(policyId, deactivatedBy = 'system') {
  const policy = await deactivatePolicy(policyId, deactivatedBy);
  
  await logGovernanceEvent('POLICY_DEACTIVATED', deactivatedBy, {
    policyId,
    policyName: policy.name
  });
  
  return policy;
}

/**
 * Rollback a policy to a previous version
 * @param {string} policyId
 * @param {number} targetVersion
 * @param {string} rolledBackBy
 * @returns {Promise<Policy>}
 */
export async function rollbackPolicyVersion(policyId, targetVersion, rolledBackBy = 'system') {
  const policy = await rollbackPolicy(policyId, targetVersion, rolledBackBy);
  
  await logGovernanceEvent('POLICY_ROLLBACK', rolledBackBy, {
    policyId,
    targetVersion,
    newVersion: policy.version
  });
  
  return policy;
}

/**
 * Get policy version history
 * @param {string} policyId
 * @returns {Promise<Array>}
 */
export async function getPolicyHistory(policyId) {
  return await getPolicyVersions(policyId);
}

/**
 * Validate policy JSON syntax
 * @param {Object} json
 * @returns {Object}
 */
export function checkPolicySyntax(json) {
  return validatePolicyJSON(json);
}

/**
 * Close the governance system
 */
export async function closeGovernance() {
  if (!initialized) return;
  
  await logGovernanceEvent('GOVERNANCE_SHUTDOWN', 'system', {
    timestamp: new Date().toISOString()
  });
  
  // Close sub-modules
  const { closeABAC } = await import('./abac-policy-engine.mjs');
  const { closeComplianceValidator } = await import('./compliance-validator.mjs');
  const { closeAuditVault } = await import('./audit-requirements.mjs');
  
  await closeAuditVault();
  await closeComplianceValidator();
  await closeABAC();
  
  initialized = false;
  governanceEvents.removeAllListeners();
  
  console.log('[governance-integration] Closed');
}

// Export all functions
export default {
  // Initialization
  initializeGovernance,
  closeGovernance,
  
  // Core governance operations
  enforcePolicy,
  validateCompliance,
  logAudit,
  checkGovernance,
  getGovernanceReport,
  
  // Policy management
  loadPolicy,
  listAllPolicies,
  getPolicyById,
  enablePolicy,
  disablePolicy,
  rollbackPolicyVersion,
  getPolicyHistory,
  checkPolicySyntax,
  
  // Events
  onGovernanceEvent,
  offGovernanceEvent,
  
  // Re-exports for convenience
  Policy,
  PolicyDecision,
  ComplianceRule,
  ComplianceSeverity,
  ComplianceOutcome,
  BUILTIN_RULES,
  AuditEntry,
  AuditAction,
  AuditSeverity
};
