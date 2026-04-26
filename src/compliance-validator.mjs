/**
 * @module compliance-validator
 * @description Compliance Rule Validation for Mesh Memory Protocol v2.0
 * 
 * Auto-validates decisions against compliance rules including:
 * - Data retention policies
 * - Privacy separation (facts vs interpretations)
 * - Audit requirements (WORM, tamper-evident logging)
 * - Multi-agent consensus requirements
 * 
 * @version 1.0.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let COMPLIANCE_DIR = 'memory/compliance';

// SQLite database handle
let db = null;

// Compliance severity levels
export const ComplianceSeverity = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

// Compliance outcomes
export const ComplianceOutcome = {
  COMPLIANT: 'compliant',
  NON_COMPLIANT: 'non_compliant',
  NEEDS_REVIEW: 'needs_review'
};

// Built-in compliance rules
export const BUILTIN_RULES = {
  FACTS_VS_INTERPRETATIONS: {
    id: 'COMPLIANCE-001',
    name: 'Facts vs Interpretations Separation',
    description: 'Prevents bias laundering by enforcing separation between facts and interpretations',
    severity: ComplianceSeverity.CRITICAL,
    category: 'bias_prevention',
    check: checkFactsVsInterpretations,
    remediation: 'Ensure all context entries are facts (observable, verifiable) not opinions or assessments'
  },
  
  WORM_AUDIT_REQUIREMENT: {
    id: 'COMPLIANCE-002',
    name: 'WORM Audit Trail',
    description: 'Requires tamper-evident write-once-read-many audit logging for all operations',
    severity: ComplianceSeverity.CRITICAL,
    category: 'audit',
    check: checkWORMAudit,
    remediation: 'Enable audit logging with cryptographic hash chaining for all deal room operations'
  },
  
  MULTI_AGENT_CONSENSUS: {
    id: 'COMPLIANCE-003',
    name: 'Multi-Agent Consensus for Critical Decisions',
    description: 'Requires consensus approval for high-stakes decisions',
    severity: ComplianceSeverity.HIGH,
    category: 'governance',
    check: checkConsensusRequirement,
    remediation: 'Route critical decisions through the consensus engine with required approvals'
  },
  
  DATA_RETENTION_POLICY: {
    id: 'COMPLIANCE-004',
    name: 'Data Retention Policy',
    description: 'Enforces configured retention periods for all stored data',
    severity: ComplianceSeverity.MEDIUM,
    category: 'data_governance',
    check: checkDataRetention,
    remediation: 'Configure retention policies and implement automatic archival/deletion workflows'
  },
  
  PRIVACY_FILTER_ENFORCEMENT: {
    id: 'COMPLIANCE-005',
    name: 'Privacy Filter Enforcement',
    description: 'Requires PII/PHI detection and redaction in shared contexts',
    severity: ComplianceSeverity.HIGH,
    category: 'privacy',
    check: checkPrivacyFilter,
    remediation: 'Enable privacy filter with automated PII/PHI detection and redaction'
  },
  
  ACCESS_CONTROL_VALIDATION: {
    id: 'COMPLIANCE-006',
    name: 'Access Control Validation',
    description: 'Verifies access decisions are logged and authorized',
    severity: ComplianceSeverity.HIGH,
    category: 'security',
    check: checkAccessControl,
    remediation: 'Ensure all access decisions are evaluated by ABAC and logged to audit trail'
  },
  
  AUDIT_CHAIN_INTEGRITY: {
    id: 'COMPLIANCE-007',
    name: 'Audit Chain Integrity',
    description: 'Verifies cryptographic integrity of the audit chain',
    severity: ComplianceSeverity.CRITICAL,
    category: 'audit',
    check: checkAuditChainIntegrity,
    remediation: 'Run audit chain verification and investigate any integrity violations'
  }
};

/**
 * Initialize compliance validator
 * @returns {Promise<void>}
 */
export async function initializeComplianceValidator() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  COMPLIANCE_DIR = join(baseDir, 'compliance');
  
  await fs.mkdir(COMPLIANCE_DIR, { recursive: true });
  
  // Initialize SQLite database
  const dbPath = join(COMPLIANCE_DIR, 'compliance.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  await initializeSchema();
  
  // Seed built-in rules
  await seedBuiltinRules();
  
  console.log('[compliance-validator] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Compliance rules table
  await db.run(`
    CREATE TABLE IF NOT EXISTS compliance_rules (
      rule_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
      category TEXT NOT NULL,
      is_builtin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      custom_check_logic JSON,
      remediation_template TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  
  // Validation results table
  await db.run(`
    CREATE TABLE IF NOT EXISTS validation_results (
      validation_id TEXT PRIMARY KEY,
      decision_id TEXT,
      rule_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('compliant', 'non_compliant', 'needs_review')),
      severity TEXT NOT NULL,
      details JSON,
      remediation_suggested TEXT,
      validated_at TEXT NOT NULL,
      validated_by TEXT,
      context_snapshot JSON,
      FOREIGN KEY (rule_id) REFERENCES compliance_rules(rule_id)
    )
  `);
  
  // Compliance reports table
  await db.run(`
    CREATE TABLE IF NOT EXISTS compliance_reports (
      report_id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by TEXT,
      summary JSON,
      details JSON,
      export_path TEXT
    )
  `);
  
  // Indexes
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rule_active ON compliance_rules(is_active)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rule_category ON compliance_rules(category)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_validation_decision ON validation_results(decision_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_validation_outcome ON validation_results(outcome)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_validation_time ON validation_results(validated_at)`);
}

/**
 * Seed built-in compliance rules
 */
async function seedBuiltinRules() {
  for (const [key, rule] of Object.entries(BUILTIN_RULES)) {
    const exists = await db.get(
      'SELECT rule_id FROM compliance_rules WHERE rule_id = ?',
      [rule.id]
    );
    
    if (!exists) {
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO compliance_rules (
          rule_id, name, description, severity, category, is_builtin, is_active,
          remediation_template, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.id, rule.name, rule.description, rule.severity, rule.category,
          1, 1, rule.remediation, now, now
        ]
      );
      console.log(`[Compliance] Seeded rule: ${rule.name}`);
    }
  }
}

/**
 * ComplianceRule class
 */
export class ComplianceRule {
  constructor(data = {}) {
    this.id = data.id || `rule_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    this.name = data.name || 'Unnamed Rule';
    this.description = data.description || '';
    this.severity = data.severity || ComplianceSeverity.MEDIUM;
    this.category = data.category || 'general';
    this.isBuiltin = data.isBuiltin || false;
    this.isActive = data.isActive ?? true;
    this.customCheckLogic = data.customCheckLogic || null;
    this.remediationTemplate = data.remediationTemplate || '';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }
  
  /**
   * Convert to database format
   */
  toDB() {
    return {
      rule_id: this.id,
      name: this.name,
      description: this.description,
      severity: this.severity,
      category: this.category,
      is_builtin: this.isBuiltin ? 1 : 0,
      is_active: this.isActive ? 1 : 0,
      custom_check_logic: this.customCheckLogic ? JSON.stringify(this.customCheckLogic) : null,
      remediation_template: this.remediationTemplate,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }
}

/**
 * Validate a decision against all active compliance rules
 * @param {Object} decision - The decision to validate
 * @param {Object} context - Context for validation { roomId, agentId, operation, ... }
 * @returns {Promise<Object>} { outcome: 'compliant'|'non_compliant'|'needs_review', results: Array, summary: Object }
 */
export async function validate(decision, context = {}) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('Decision object is required');
  }
  
  // Get all active rules
  const rules = await getActiveRules();
  
  const results = [];
  let hasCriticalViolation = false;
  let hasViolation = false;
  let needsReview = false;
  
  for (const rule of rules) {
    const result = await validateAgainstRule(rule, decision, context);
    results.push(result);
    
    if (result.outcome === ComplianceOutcome.NON_COMPLIANT) {
      hasViolation = true;
      if (result.severity === ComplianceSeverity.CRITICAL) {
        hasCriticalViolation = true;
      }
    } else if (result.outcome === ComplianceOutcome.NEEDS_REVIEW) {
      needsReview = true;
    }
  }
  
  // Determine overall outcome
  let outcome;
  if (hasCriticalViolation) {
    outcome = ComplianceOutcome.NON_COMPLIANT;
  } else if (hasViolation) {
    outcome = ComplianceOutcome.NEEDS_REVIEW;
  } else if (needsReview) {
    outcome = ComplianceOutcome.NEEDS_REVIEW;
  } else {
    outcome = ComplianceOutcome.COMPLIANT;
  }
  
  const summary = {
    totalRules: rules.length,
    compliant: results.filter(r => r.outcome === ComplianceOutcome.COMPLIANT).length,
    nonCompliant: results.filter(r => r.outcome === ComplianceOutcome.NON_COMPLIANT).length,
    needsReview: results.filter(r => r.outcome === ComplianceOutcome.NEEDS_REVIEW).length,
    criticalViolations: results.filter(r => r.outcome === ComplianceOutcome.NON_COMPLIANT && r.severity === ComplianceSeverity.CRITICAL).length
  };
  
  return {
    outcome,
    results,
    summary
  };
}

/**
 * Validate a decision against a single rule
 * @param {Object} rule
 * @param {Object} decision
 * @param {Object} context
 * @returns {Promise<Object>}
 */
async function validateAgainstRule(rule, decision, context) {
  const validationId = `val_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const validatedAt = new Date().toISOString();
  
  let outcome;
  let details = {};
  let remediation = rule.remediationTemplate || '';
  
  try {
    // Use built-in check function if available
    if (BUILTIN_RULES[rule.rule_id] && BUILTIN_RULES[rule.rule_id].check) {
      const checkResult = await BUILTIN_RULES[rule.rule_id].check(decision, context);
      outcome = checkResult.outcome;
      details = checkResult.details || {};
      remediation = checkResult.remediation || remediation;
    } else if (rule.custom_check_logic) {
      // Use custom check logic
      const checkResult = await evaluateCustomCheck(rule.custom_check_logic, decision, context);
      outcome = checkResult.outcome;
      details = checkResult.details || {};
    } else {
      // No check defined - needs manual review
      outcome = ComplianceOutcome.NEEDS_REVIEW;
      details = { reason: 'No automated check defined for this rule' };
    }
  } catch (error) {
    outcome = ComplianceOutcome.NEEDS_REVIEW;
    details = { error: error.message, stack: error.stack };
    remediation = 'Review validation error and correct rule configuration';
  }
  
  // Store validation result
  await db.run(
    `INSERT INTO validation_results (
      validation_id, decision_id, rule_id, outcome, severity, details,
      remediation_suggested, validated_at, validated_by, context_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      validationId,
      decision.id || null,
      rule.rule_id,
      outcome,
      rule.severity,
      JSON.stringify(details),
      remediation,
      validatedAt,
      context.agentId || 'system',
      JSON.stringify(context)
    ]
  );
  
  return {
    ruleId: rule.rule_id,
    ruleName: rule.name,
    severity: rule.severity,
    category: rule.category,
    outcome,
    details,
    remediation,
    validatedAt
  };
}

/**
 * Check 1: Facts vs Interpretations Separation
 * Validates that shared context entries are facts, not interpretations
 */
async function checkFactsVsInterpretations(decision, context) {
  const details = {};
  
  // Check if decision involves context entries
  if (decision.type === 'context_entry' || decision.entry) {
    const entry = decision.entry || decision;
    
    // Check for interpretation markers
    const interpretationKeywords = [
      'think', 'believe', 'opinion', 'assessment', 'evaluate', 'judge',
      'consider', 'view', 'perspective', 'interpret', 'analysis'
    ];
    
    const entryText = JSON.stringify(entry).toLowerCase();
    const foundKeywords = interpretationKeywords.filter(kw => entryText.includes(kw));
    
    if (foundKeywords.length > 0) {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Entry contains interpretation keywords',
          foundKeywords,
          entryType: entry.type,
          suggestion: 'Convert to facts (observable, verifiable statements)'
        },
        remediation: 'Remove interpretations. Only include facts: who, what, when, where (observable data).'
      };
    }
    
    // Check entry type - should be 'fact' not 'opinion' or 'interpretation'
    if (entry.type && entry.type !== 'fact') {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: `Entry type is '${entry.type}', expected 'fact'`,
          entryType: entry.type
        },
        remediation: 'Change entry type to "fact" or separate interpretations from shared context'
      };
    }
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { message: 'Entry appears to be factual' }
  };
}

/**
 * Check 2: WORM Audit Trail
 * Validates that audit logging is enabled and operational
 */
async function checkWORMAudit(decision, context) {
  const details = {};
  
  // Check if operation requires audit
  const auditedOperations = ['create', 'update', 'delete', 'propose', 'vote', 'commit', 'access'];
  const operation = decision.operation || context.operation || 'unknown';
  
  if (auditedOperations.includes(operation)) {
    // Check if audit trail exists for this context
    const roomId = context.roomId || decision.roomId;
    
    if (roomId) {
      // Verify audit chain exists
      const auditPath = join(COMPLIANCE_DIR, '..', 'deal-rooms', roomId, 'audit');
      
      try {
        const auditFiles = await fs.readdir(auditPath);
        const hasAuditLogs = auditFiles.some(f => f.endsWith('.log'));
        
        if (!hasAuditLogs) {
          return {
            outcome: ComplianceOutcome.NON_COMPLIANT,
            details: {
              violation: 'No audit logs found for audited operation',
              operation,
              roomId
            },
            remediation: 'Ensure writeAuditLog() is called for all audited operations'
          };
        }
        
        details.auditFilesFound = auditFiles.length;
      } catch (error) {
        return {
          outcome: ComplianceOutcome.NON_COMPLIANT,
          details: {
            violation: 'Audit directory not accessible',
            error: error.message,
            roomId
          },
          remediation: 'Initialize audit infrastructure for this room'
        };
      }
    }
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { ...details, message: 'Audit trail verified' }
  };
}

/**
 * Check 3: Multi-Agent Consensus for Critical Decisions
 * Validates that critical decisions have proper consensus
 */
async function checkConsensusRequirement(decision, context) {
  const criticalTypes = ['contract_terms', 'financial_commitment', 'access_grant', 'data_share'];
  const decisionType = decision.type || context.decisionType;
  
  if (criticalTypes.includes(decisionType)) {
    // Check for consensus evidence
    const hasConsensus = decision.consensus &6 
      (decision.consensus.status === 'APPROVED' || 
       decision.consensus.votes?.length >= (decision.consensus.requiredVotes || 2));
    
    if (!hasConsensus) {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Critical decision lacks multi-agent consensus',
          decisionType,
          required: 'Consensus approval from multiple agents',
          actual: decision.consensus || 'none'
        },
        remediation: 'Route decision through consensus engine with required approvals'
      };
    }
    
    // Verify sufficient votes
    const votes = decision.consensus.votes || [];
    const approveVotes = votes.filter(v => v.vote === 'approve').length;
    const required = decision.consensus.requiredVotes || 2;
    
    if (approveVotes < required) {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Insufficient consensus votes',
          approveVotes,
          requiredVotes: required
        },
        remediation: 'Obtain additional approvals before proceeding'
      };
    }
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { message: 'Consensus requirements satisfied' }
  };
}

/**
 * Check 4: Data Retention Policy
 * Validates that data retention policies are enforced
 */
async function checkDataRetention(decision, context) {
  const details = {};
  
  // Check if room has retention policy configured
  const roomId = context.roomId || decision.roomId;
  const retentionDays = context.retentionDays || decision.retentionDays;
  
  if (roomId && !retentionDays) {
    return {
      outcome: ComplianceOutcome.NEEDS_REVIEW,
      details: {
        warning: 'No retention policy configured for room',
        roomId,
        recommendation: 'Set retentionDays in room policy'
      },
      remediation: 'Configure data retention policy (default: 2555 days / 7 years)'
    };
  }
  
  // Check for retention violations (data older than policy)
  if (decision.dataCreatedAt && retentionDays) {
    const dataAge = Date.now() - new Date(decision.dataCreatedAt).getTime();
    const maxAge = retentionDays * 24 * 60 * 60 * 1000;
    
    if (dataAge > maxAge) {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Data exceeds retention period',
          dataAge: Math.floor(dataAge / (24 * 60 * 60 * 1000)),
          retentionDays,
          dataCreatedAt: decision.dataCreatedAt
        },
        remediation: 'Archive or delete data per retention policy'
      };
    }
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { ...details, message: 'Retention policy configured' }
  };
}

/**
 * Check 5: Privacy Filter Enforcement
 * Validates that PII/PHI is properly filtered
 */
async function checkPrivacyFilter(decision, context) {
  // Check if content might contain PII
  const content = JSON.stringify(decision);
  
  // Simple PII patterns (in production, use proper detection)
  const piiPatterns = [
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: 'SSN' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: 'email' },
    { pattern: /\b\d{3}-\d{3}-\d{4}\b/, type: 'phone' },
    { pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b/, type: 'credit_card' }
  ];
  
  const detected = [];
  for (const { pattern, type } of piiPatterns) {
    if (pattern.test(content)) {
      detected.push(type);
    }
  }
  
  if (detected.length > 0 && !decision.privacyChecked) {
    return {
      outcome: ComplianceOutcome.NEEDS_REVIEW,
      details: {
        warning: 'Potential PII detected, verify privacy filter applied',
        detectedTypes: detected,
        privacyChecked: decision.privacyChecked || false
      },
      remediation: 'Run privacy filter and confirm redaction before sharing'
    };
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { message: 'Privacy filter verified' }
  };
}

/**
 * Check 6: Access Control Validation
 * Validates access control is properly enforced
 */
async function checkAccessControl(decision, context) {
  // Check if access was evaluated
  if (decision.requiresAccessCheck || context.requiresAccessCheck) {
    const accessEvaluated = decision.accessEvaluation || context.accessEvaluation;
    
    if (!accessEvaluated) {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Access control check not performed',
          resource: context.resource || decision.resource,
          action: context.action || decision.action
        },
        remediation: 'Call ABAC evaluate() before allowing access'
      };
    }
    
    if (accessEvaluated.decision !== 'allow') {
      return {
        outcome: ComplianceOutcome.NON_COMPLIANT,
        details: {
          violation: 'Access was denied by policy',
          decision: accessEvaluated.decision,
          reason: accessEvaluated.reason
        },
        remediation: 'Obtain proper authorization before proceeding'
      };
    }
  }
  
  return {
    outcome: ComplianceOutcome.COMPLIANT,
    details: { message: 'Access control verified' }
  };
}

/**
 * Check 7: Audit Chain Integrity
 * Validates the cryptographic integrity of the audit chain
 */
async function checkAuditChainIntegrity(decision, context) {
  const roomId = context.roomId || decision.roomId;
  
  if (!roomId) {
    return {
      outcome: ComplianceOutcome.NEEDS_REVIEW,
      details: { message: 'No room specified, cannot verify chain integrity' }
    };
  }
  
  // This would integrate with audit-requirements module
  // For now, return needs_review to prompt manual verification
  return {
    outcome: ComplianceOutcome.NEEDS_REVIEW,
    details: {
      message: 'Manual audit chain verification required',
      roomId,
      recommendation: 'Run verifyChain() from audit-requirements module'
    },
    remediation: 'Execute cryptographic chain verification and review results'
  };
}

/**
 * Evaluate custom check logic
 * @param {Object} logic
 * @param {Object} decision
 * @param {Object} context
 * @returns {Object}
 */
async function evaluateCustomCheck(logic, decision, context) {
  // Simple custom check evaluator
  // In production, this would use a safe expression evaluator
  
  try {
    const condition = logic.condition;
    const expectedOutcome = logic.expectedOutcome || 'compliant';
    
    // Evaluate condition against decision/context
    let conditionMet = true;
    
    if (condition.field) {
      const value = decision[condition.field] || context[condition.field];
      
      if (condition.equals !== undefined) {
        conditionMet = value === condition.equals;
      } else if (condition.exists) {
        conditionMet = value !== undefined && value !== null;
      }
    }
    
    return {
      outcome: conditionMet ? expectedOutcome : 'non_compliant',
      details: { conditionMet, logic }
    };
  } catch (error) {
    return {
      outcome: 'needs_review',
      details: { error: error.message }
    };
  }
}

/**
 * Get all active compliance rules
 * @returns {Promise<Array>}
 */
async function getActiveRules() {
  return await db.all(
    `SELECT * FROM compliance_rules WHERE is_active = 1 ORDER BY 
     CASE severity 
       WHEN 'critical' THEN 1 
       WHEN 'high' THEN 2 
       WHEN 'medium' THEN 3 
       WHEN 'low' THEN 4 
     END, created_at ASC`
  );
}

/**
 * Create a custom compliance rule
 * @param {Object} ruleData
 * @returns {Promise<ComplianceRule>}
 */
export async function createRule(ruleData) {
  const rule = new ComplianceRule({
    ...ruleData,
    isBuiltin: false
  });
  
  const dbData = rule.toDB();
  
  await db.run(
    `INSERT INTO compliance_rules (
      rule_id, name, description, severity, category, is_builtin, is_active,
      custom_check_logic, remediation_template, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dbData.rule_id, dbData.name, dbData.description, dbData.severity,
      dbData.category, dbData.is_builtin, dbData.is_active,
      dbData.custom_check_logic, dbData.remediation_template,
      dbData.created_at, dbData.updated_at
    ]
  );
  
  console.log(`[Compliance] Created rule: ${rule.name}`);
  return rule;
}

/**
 * Get validation history
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
export async function getValidationHistory(filters = {}) {
  let sql = 'SELECT * FROM validation_results WHERE 1=1';
  const params = [];
  
  if (filters.decisionId) {
    sql += ' AND decision_id = ?';
    params.push(filters.decisionId);
  }
  
  if (filters.ruleId) {
    sql += ' AND rule_id = ?';
    params.push(filters.ruleId);
  }
  
  if (filters.outcome) {
    sql += ' AND outcome = ?';
    params.push(filters.outcome);
  }
  
  if (filters.severity) {
    sql += ' AND severity = ?';
    params.push(filters.severity);
  }
  
  if (filters.startTime) {
    sql += ' AND validated_at >= ?';
    params.push(filters.startTime);
  }
  
  if (filters.endTime) {
    sql += ' AND validated_at <= ?';
    params.push(filters.endTime);
  }
  
  sql += ' ORDER BY validated_at DESC';
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  const rows = await db.all(sql, params);
  
  return rows.map(row => ({
    validationId: row.validation_id,
    decisionId: row.decision_id,
    ruleId: row.rule_id,
    outcome: row.outcome,
    severity: row.severity,
    details: JSON.parse(row.details || '{}'),
    remediationSuggested: row.remediation_suggested,
    validatedAt: row.validated_at,
    validatedBy: row.validated_by,
    contextSnapshot: JSON.parse(row.context_snapshot || '{}')
  }));
}

/**
 * Generate compliance report
 * @param {Object} options - { startTime, endTime, roomId }
 * @returns {Promise<Object>}
 */
export async function generateComplianceReport(options = {}) {
  const reportId = `report_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const generatedAt = new Date().toISOString();
  
  // Get validation stats
  const stats = await db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'compliant' THEN 1 ELSE 0 END) as compliant,
      SUM(CASE WHEN outcome = 'non_compliant' THEN 1 ELSE 0 END) as non_compliant,
      SUM(CASE WHEN outcome = 'needs_review' THEN 1 ELSE 0 END) as needs_review,
      SUM(CASE WHEN severity = 'critical' AND outcome = 'non_compliant' THEN 1 ELSE 0 END) as critical_violations
    FROM validation_results
    WHERE validated_at >= ? AND validated_at <= ?
  `, [options.startTime || '1970-01-01', options.endTime || '2099-12-31']);
  
  // Get violations by rule
  const violationsByRule = await db.all(`
    SELECT 
      r.name,
      r.severity,
      COUNT(*) as violation_count
    FROM validation_results v
    JOIN compliance_rules r ON v.rule_id = r.rule_id
    WHERE v.outcome = 'non_compliant'
      AND v.validated_at >= ? AND v.validated_at <= ?
    GROUP BY r.rule_id
    ORDER BY violation_count DESC
  `, [options.startTime || '1970-01-01', options.endTime || '2099-12-31']);
  
  const summary = {
    totalValidations: stats.total,
    compliant: stats.compliant,
    nonCompliant: stats.non_compliant,
    needsReview: stats.needs_review,
    criticalViolations: stats.critical_violations,
    complianceRate: stats.total > 0 ? ((stats.compliant / stats.total) * 100).toFixed(2) : 0
  };
  
  const report = {
    reportId,
    generatedAt,
    generatedBy: options.generatedBy || 'system',
    period: { start: options.startTime, end: options.endTime },
    summary,
    violationsByRule,
    recommendations: generateRecommendations(summary, violationsByRule)
  };
  
  // Store report
  await db.run(
    `INSERT INTO compliance_reports (report_id, report_type, generated_at, generated_by, summary, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      reportId, 'validation_summary', generatedAt, report.generatedBy,
      JSON.stringify(summary), JSON.stringify(report)
    ]
  );
  
  return report;
}

/**
 * Generate recommendations based on report data
 * @param {Object} summary
 * @param {Array} violationsByRule
 * @returns {Array}
 */
function generateRecommendations(summary, violationsByRule) {
  const recommendations = [];
  
  if (summary.criticalViolations > 0) {
    recommendations.push({
      priority: 'critical',
      message: `Address ${summary.criticalViolations} critical compliance violations immediately`
    });
  }
  
  if (summary.complianceRate < 90) {
    recommendations.push({
      priority: 'high',
      message: `Compliance rate (${summary.complianceRate}%) below target. Review validation processes.`
    });
  }
  
  if (violationsByRule.length > 0) {
    const topViolation = violationsByRule[0];
    recommendations.push({
      priority: 'medium',
      message: `Focus on '${topViolation.name}' rule with ${topViolation.violation_count} violations`
    });
  }
  
  return recommendations;
}

/**
 * Close database connection
 */
export async function closeComplianceValidator() {
  if (db) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    db = null;
  }
}

// Export all functions
export default {
  initializeComplianceValidator,
  validate,
  createRule,
  getValidationHistory,
  generateComplianceReport,
  closeComplianceValidator,
  ComplianceRule,
  ComplianceSeverity,
  ComplianceOutcome,
  BUILTIN_RULES
};
