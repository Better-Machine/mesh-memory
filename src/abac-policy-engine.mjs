/**
 * @module abac-policy-engine
 * @description Attribute-Based Access Control (ABAC) Policy Engine for Mesh Memory Protocol v2.0
 * 
 * Provides fine-grained permissions based on agent attributes including:
 * - role, clearance_level, time_of_day, location, device_trust
 * 
 * Features:
 * - Policy evaluation: evaluate(agent, resource, action) → allow | deny | escalate
 * - Policy versioning with rollback capability
 * - Default deny (fail closed) security posture
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
let POLICY_DIR = 'memory/policies';

// SQLite database handle
let db = null;

// In-memory policy cache
const policyCache = new Map();

// Policy evaluation outcomes
export const PolicyDecision = {
  ALLOW: 'allow',
  DENY: 'deny',
  ESCALATE: 'escalate'
};

// Comparison operators for conditions
const OPERATORS = {
  '==': (a, b) => a == b,
  '!=': (a, b) => a != b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  'in': (a, b) => Array.isArray(b) && b.includes(a),
  'contains': (a, b) => Array.isArray(a) && a.includes(b),
  'startsWith': (a, b) => typeof a === 'string' && a.startsWith(b),
  'endsWith': (a, b) => typeof a === 'string' && a.endsWith(b),
  'regex': (a, b) => typeof a === 'string' && new RegExp(b).test(a)
};

/**
 * Initialize ABAC policy engine
 * @returns {Promise<void>}
 */
export async function initializeABAC() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  POLICY_DIR = join(baseDir, 'policies');
  
  await fs.mkdir(POLICY_DIR, { recursive: true });
  
  // Initialize SQLite database
  const dbPath = join(POLICY_DIR, 'policies.db');
  db = new sqlite3.Database(dbPath);
  
  // Promisify database methods
  db.run = promisify(db.run.bind(db));
  db.get = promisify(db.get.bind(db));
  db.all = promisify(db.all.bind(db));
  
  await initializeSchema();
  
  // Load active policies into cache
  await loadActivePolicies();
  
  console.log('[abac-policy-engine] Initialized');
}

/**
 * Initialize SQLite schema
 */
async function initializeSchema() {
  // Policies table with versioning
  await db.run(`
    CREATE TABLE IF NOT EXISTS policies (
      policy_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      rules JSON NOT NULL,
      is_active INTEGER DEFAULT 0,
      is_deprecated INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      policy_hash TEXT NOT NULL,
      parent_policy_id TEXT,
      FOREIGN KEY (parent_policy_id) REFERENCES policies(policy_id)
    )
  `);
  
  // Policy versions table for audit trail
  await db.run(`
    CREATE TABLE IF NOT EXISTS policy_versions (
      version_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      rules JSON NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by TEXT,
      change_reason TEXT,
      policy_hash TEXT NOT NULL,
      FOREIGN KEY (policy_id) REFERENCES policies(policy_id)
    )
  `);
  
  // Policy evaluation audit
  await db.run(`
    CREATE TABLE IF NOT EXISTS policy_evaluations (
      evaluation_id TEXT PRIMARY KEY,
      policy_id TEXT,
      agent_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      decision TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      attributes JSON,
      matched_rules JSON,
      FOREIGN KEY (policy_id) REFERENCES policies(policy_id)
    )
  `);
  
  // Indexes
  await db.run(`CREATE INDEX IF NOT EXISTS idx_policy_active ON policies(is_active)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_policy_priority ON policies(priority DESC)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_policy_versions ON policy_versions(policy_id, version)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_eval_time ON policy_evaluations(evaluated_at)`);
}

/**
 * Calculate SHA-256 hash of policy content
 * @param {Object} policy
 * @returns {string}
 */
function calculatePolicyHash(policy) {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Policy class representing an ABAC policy
 */
export class Policy {
  constructor(data = {}) {
    this.id = data.id || `policy_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    this.name = data.name || 'Unnamed Policy';
    this.version = data.version || 1;
    this.description = data.description || '';
    this.rules = data.rules || [];
    this.isActive = data.isActive || false;
    this.isDeprecated = data.isDeprecated || false;
    this.priority = data.priority || 100;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.createdBy = data.createdBy || 'system';
    this.parentPolicyId = data.parentPolicyId || null;
  }
  
  /**
   * Validate policy structure
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];
    
    if (!this.name || typeof this.name !== 'string') {
      errors.push('Policy name is required');
    }
    
    if (!Array.isArray(this.rules)) {
      errors.push('Rules must be an array');
    } else {
      for (let i = 0; i < this.rules.length; i++) {
        const ruleErrors = this.validateRule(this.rules[i], i);
        errors.push(...ruleErrors);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Validate a single rule
   * @param {Object} rule
   * @param {number} index
   * @returns {string[]}
   */
  validateRule(rule, index) {
    const errors = [];
    
    if (!rule || typeof rule !== 'object') {
      errors.push(`Rule ${index}: must be an object`);
      return errors;
    }
    
    if (!['allow', 'deny', 'escalate'].includes(rule.effect)) {
      errors.push(`Rule ${index}: effect must be 'allow', 'deny', or 'escalate'`);
    }
    
    if (!rule.principal || typeof rule.principal !== 'object') {
      errors.push(`Rule ${index}: principal is required`);
    }
    
    if (!rule.action) {
      errors.push(`Rule ${index}: action is required`);
    }
    
    if (!rule.resource) {
      errors.push(`Rule ${index}: resource is required`);
    }
    
    // Validate condition operators if present
    if (rule.condition) {
      for (const [key, condition] of Object.entries(rule.condition)) {
        if (typeof condition === 'object' && condition.operator) {
          if (!OPERATORS[condition.operator]) {
            errors.push(`Rule ${index}: unknown operator '${condition.operator}' for ${key}`);
          }
        }
      }
    }
    
    return errors;
  }
  
  /**
   * Convert to database format
   * @returns {Object}
   */
  toDB() {
    return {
      policy_id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      rules: JSON.stringify(this.rules),
      is_active: this.isActive ? 1 : 0,
      is_deprecated: this.isDeprecated ? 1 : 0,
      priority: this.priority,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      created_by: this.createdBy,
      parent_policy_id: this.parentPolicyId,
      policy_hash: calculatePolicyHash(this.toJSON())
    };
  }
  
  /**
   * Convert to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      description: this.description,
      rules: this.rules,
      isActive: this.isActive,
      isDeprecated: this.isDeprecated,
      priority: this.priority,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      parentPolicyId: this.parentPolicyId
    };
  }
  
  /**
   * Create Policy from database row
   * @param {Object} row
   * @returns {Policy}
   */
  static fromDB(row) {
    return new Policy({
      id: row.policy_id,
      name: row.name,
      version: row.version,
      description: row.description,
      rules: JSON.parse(row.rules),
      isActive: row.is_active === 1,
      isDeprecated: row.is_deprecated === 1,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      parentPolicyId: row.parent_policy_id
    });
  }
}

/**
 * Create and save a new policy
 * @param {Object} policyData
 * @param {string} createdBy
 * @returns {Promise<Policy>}
 */
export async function createPolicy(policyData, createdBy = 'system') {
  const policy = new Policy({
    ...policyData,
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  const validation = policy.validate();
  if (!validation.valid) {
    throw new Error(`Invalid policy: ${validation.errors.join(', ')}`);
  }
  
  const dbData = policy.toDB();
  
  await db.run(
    `INSERT INTO policies (
      policy_id, name, version, description, rules, is_active, is_deprecated,
      priority, created_at, updated_at, created_by, policy_hash, parent_policy_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dbData.policy_id, dbData.name, dbData.version, dbData.description, dbData.rules,
      dbData.is_active, dbData.is_deprecated, dbData.priority, dbData.created_at,
      dbData.updated_at, dbData.created_by, dbData.policy_hash, dbData.parent_policy_id
    ]
  );
  
  // Record initial version
  await recordPolicyVersion(policy);
  
  console.log(`[ABAC] Created policy: ${policy.name} (${policy.id})`);
  return policy;
}

/**
 * Record a policy version
 * @param {Policy} policy
 * @param {string} changedBy
 * @param {string} reason
 */
async function recordPolicyVersion(policy, changedBy = 'system', reason = 'Policy created/updated') {
  const versionId = `ver_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const versionHash = calculatePolicyHash(policy.toJSON());
  
  await db.run(
    `INSERT INTO policy_versions (version_id, policy_id, version, rules, changed_at, changed_by, change_reason, policy_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      versionId, policy.id, policy.version, JSON.stringify(policy.rules),
      new Date().toISOString(), changedBy, reason, versionHash
    ]
  );
}

/**
 * Evaluate an access request against all active policies
 * @param {Object} agent - Agent attributes { role, clearance_level, time_of_day, location, device_trust, ... }
 * @param {string} resource - Resource identifier (e.g., "deal-room:dr_abc123")
 * @param {string} action - Action requested (e.g., "read", "propose", "vote")
 * @param {Object} context - Additional context for evaluation
 * @returns {Promise<Object>} { decision: 'allow'|'deny'|'escalate', matchedPolicy: string|null, matchedRules: Array, reason: string }
 */
export async function evaluate(agent, resource, action, context = {}) {
  if (!agent || typeof agent !== 'object') {
    throw new Error('Agent attributes are required');
  }
  
  if (!resource || typeof resource !== 'string') {
    throw new Error('Resource identifier is required');
  }
  
  if (!action || typeof action !== 'string') {
    throw new Error('Action is required');
  }
  
  const evaluatedAt = new Date().toISOString();
  
  // Get all active policies, sorted by priority (highest first)
  const policies = await getActivePolicies();
  
  // Track matched rules for audit
  const matchedRules = [];
  
  // Evaluate against each policy
  for (const policy of policies) {
    for (const rule of policy.rules) {
      const matches = evaluateRule(rule, agent, resource, action, context);
      
      if (matches) {
        matchedRules.push({
          policyId: policy.id,
          policyName: policy.name,
          ruleEffect: rule.effect,
          rulePrincipal: rule.principal,
          ruleAction: rule.action,
          ruleResource: rule.resource
        });
        
        // Record evaluation
        await recordEvaluation(policy.id, agent, resource, action, rule.effect, context, matchedRules);
        
        // Return immediately on deny (fail closed)
        if (rule.effect === PolicyDecision.DENY) {
          return {
            decision: PolicyDecision.DENY,
            matchedPolicy: policy.id,
            matchedRules: [matchedRules[matchedRules.length - 1]],
            reason: `Denied by policy: ${policy.name}`
          };
        }
        
        // Return immediately on escalate
        if (rule.effect === PolicyDecision.ESCALATE) {
          return {
            decision: PolicyDecision.ESCALATE,
            matchedPolicy: policy.id,
            matchedRules: [matchedRules[matchedRules.length - 1]],
            reason: `Escalated by policy: ${policy.name}`
          };
        }
        
        // Continue checking other rules for allow (in case there's a deny)
      }
    }
  }
  
  // If any allow matched, grant access
  if (matchedRules.some(r => r.ruleEffect === PolicyDecision.ALLOW)) {
    const allowRule = matchedRules.find(r => r.ruleEffect === PolicyDecision.ALLOW);
    await recordEvaluation(null, agent, resource, action, PolicyDecision.ALLOW, context, matchedRules);
    
    return {
      decision: PolicyDecision.ALLOW,
      matchedPolicy: allowRule.policyId,
      matchedRules: matchedRules.filter(r => r.ruleEffect === PolicyDecision.ALLOW),
      reason: `Allowed by policy: ${allowRule.policyName}`
    };
  }
  
  // Default deny (fail closed)
  await recordEvaluation(null, agent, resource, action, PolicyDecision.DENY, context, []);
  
  return {
    decision: PolicyDecision.DENY,
    matchedPolicy: null,
    matchedRules: [],
    reason: 'No matching policy found (default deny)'
  };
}

/**
 * Evaluate a single rule against the request
 * @param {Object} rule
 * @param {Object} agent
 * @param {string} resource
 * @param {string} action
 * @param {Object} context
 * @returns {boolean}
 */
function evaluateRule(rule, agent, resource, action, context) {
  // Check principal attributes
  if (!matchesPrincipal(rule.principal, agent)) {
    return false;
  }
  
  // Check action match
  if (!matchesAction(rule.action, action)) {
    return false;
  }
  
  // Check resource match
  if (!matchesResource(rule.resource, resource)) {
    return false;
  }
  
  // Check conditions
  if (rule.condition && !evaluateConditions(rule.condition, agent, context)) {
    return false;
  }
  
  return true;
}

/**
 * Check if agent attributes match the principal pattern
 * @param {Object} principal
 * @param {Object} agent
 * @returns {boolean}
 */
function matchesPrincipal(principal, agent) {
  for (const [key, expectedValue] of Object.entries(principal)) {
    const actualValue = agent[key];
    
    if (typeof expectedValue === 'object' && expectedValue.operator) {
      // Complex condition with operator
      const op = OPERATORS[expectedValue.operator];
      if (!op || !op(actualValue, expectedValue.value)) {
        return false;
      }
    } else if (typeof expectedValue === 'string' && expectedValue.startsWith('>=')) {
      // Handle >= shorthand for numeric comparisons
      const threshold = parseFloat(expectedValue.slice(2));
      if (typeof actualValue !== 'number' || actualValue < threshold) {
        return false;
      }
    } else if (Array.isArray(expectedValue)) {
      // Match any in array
      if (!expectedValue.includes(actualValue)) {
        return false;
      }
    } else {
      // Direct equality
      if (actualValue !== expectedValue) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Check if action matches the rule pattern
 * @param {string|Array} ruleAction
 * @param {string} action
 * @returns {boolean}
 */
function matchesAction(ruleAction, action) {
  if (ruleAction === '*') return true;
  if (typeof ruleAction === 'string') return ruleAction === action;
  if (Array.isArray(ruleAction)) return ruleAction.includes(action);
  return false;
}

/**
 * Check if resource matches the rule pattern
 * Supports wildcards: "deal-room:*" matches "deal-room:dr_abc123"
 * @param {string} ruleResource
 * @param {string} resource
 * @returns {boolean}
 */
function matchesResource(ruleResource, resource) {
  if (ruleResource === '*') return true;
  
  // Handle wildcard patterns
  if (ruleResource.includes('*')) {
    const regex = new RegExp('^' + ruleResource.replace(/\*/g, '.*') + '$');
    return regex.test(resource);
  }
  
  return ruleResource === resource;
}

/**
 * Evaluate rule conditions
 * @param {Object} conditions
 * @param {Object} agent
 * @param {Object} context
 * @returns {boolean}
 */
function evaluateConditions(conditions, agent, context) {
  for (const [key, condition] of Object.entries(conditions)) {
    let actualValue;
    
    // Get the value from agent or context
    if (key.startsWith('agent.')) {
      actualValue = agent[key.slice(6)];
    } else if (key.startsWith('context.')) {
      actualValue = context[key.slice(8)];
    } else {
      // Try agent first, then context
      actualValue = agent[key] ?? context[key];
    }
    
    if (typeof condition === 'object' && condition.operator) {
      const op = OPERATORS[condition.operator];
      if (!op || !op(actualValue, condition.value)) {
        return false;
      }
    } else if (key === 'time_of_day' && typeof condition === 'string' && condition.includes('-')) {
      // Handle time ranges like "09:00-18:00"
      if (!isWithinTimeRange(actualValue, condition)) {
        return false;
      }
    } else {
      // Direct equality
      if (actualValue !== condition) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Check if current time is within the specified range
 * @param {string} currentTime - Current time (HH:MM format or full ISO)
 * @param {string} range - Time range like "09:00-18:00"
 * @returns {boolean}
 */
function isWithinTimeRange(currentTime, range) {
  const [start, end] = range.split('-');
  
  // Extract HH:MM from current time
  const current = currentTime.includes('T') 
    ? currentTime.split('T')[1].slice(0, 5)
    : currentTime.slice(0, 5);
  
  return current >= start && current <= end;
}

/**
 * Record a policy evaluation
 * @param {string|null} policyId
 * @param {Object} agent
 * @param {string} resource
 * @param {string} action
 * @param {string} decision
 * @param {Object} context
 * @param {Array} matchedRules
 */
async function recordEvaluation(policyId, agent, resource, action, decision, context, matchedRules) {
  const evaluationId = `eval_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  
  await db.run(
    `INSERT INTO policy_evaluations (evaluation_id, policy_id, agent_id, resource, action, decision, evaluated_at, attributes, matched_rules)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evaluationId,
      policyId,
      agent.agent_id || agent.id || 'unknown',
      resource,
      action,
      decision,
      new Date().toISOString(),
      JSON.stringify(agent),
      JSON.stringify(matchedRules)
    ]
  );
}

/**
 * Get all active policies sorted by priority
 * @returns {Promise<Policy[]>}
 */
async function getActivePolicies() {
  const rows = await db.all(
    `SELECT * FROM policies 
     WHERE is_active = 1 AND is_deprecated = 0
     ORDER BY priority DESC, created_at ASC`
  );
  
  return rows.map(row => Policy.fromDB(row));
}

/**
 * Load active policies into memory cache
 */
async function loadActivePolicies() {
  const policies = await getActivePolicies();
  policyCache.clear();
  
  for (const policy of policies) {
    policyCache.set(policy.id, policy);
  }
  
  console.log(`[ABAC] Loaded ${policies.length} active policies into cache`);
}

/**
 * Activate a policy
 * @param {string} policyId
 * @param {string} activatedBy
 * @returns {Promise<Policy>}
 */
export async function activatePolicy(policyId, activatedBy = 'system') {
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE policies SET is_active = 1, updated_at = ?, updated_by = ? WHERE policy_id = ?`,
    [now, activatedBy, policyId]
  );
  
  // Reload cache
  await loadActivePolicies();
  
  const policy = await getPolicy(policyId);
  console.log(`[ABAC] Activated policy: ${policy.name}`);
  return policy;
}

/**
 * Deactivate a policy
 * @param {string} policyId
 * @param {string} deactivatedBy
 * @returns {Promise<Policy>}
 */
export async function deactivatePolicy(policyId, deactivatedBy = 'system') {
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE policies SET is_active = 0, updated_at = ?, updated_by = ? WHERE policy_id = ?`,
    [now, deactivatedBy, policyId]
  );
  
  // Reload cache
  await loadActivePolicies();
  
  const policy = await getPolicy(policyId);
  console.log(`[ABAC] Deactivated policy: ${policy.name}`);
  return policy;
}

/**
 * Get a policy by ID
 * @param {string} policyId
 * @returns {Promise<Policy>}
 */
export async function getPolicy(policyId) {
  const row = await db.get(
    'SELECT * FROM policies WHERE policy_id = ?',
    [policyId]
  );
  
  if (!row) {
    throw new Error(`Policy not found: ${policyId}`);
  }
  
  return Policy.fromDB(row);
}

/**
 * List all policies
 * @param {Object} filters - { activeOnly, includeDeprecated }
 * @returns {Promise<Policy[]>}
 */
export async function listPolicies(filters = {}) {
  let sql = 'SELECT * FROM policies WHERE 1=1';
  const params = [];
  
  if (filters.activeOnly) {
    sql += ' AND is_active = 1';
  }
  
  if (!filters.includeDeprecated) {
    sql += ' AND is_deprecated = 0';
  }
  
  sql += ' ORDER BY priority DESC, created_at DESC';
  
  const rows = await db.all(sql, params);
  return rows.map(row => Policy.fromDB(row));
}

/**
 * Get policy version history
 * @param {string} policyId
 * @returns {Promise<Array>}
 */
export async function getPolicyVersions(policyId) {
  const rows = await db.all(
    `SELECT * FROM policy_versions 
     WHERE policy_id = ?
     ORDER BY version DESC`,
    [policyId]
  );
  
  return rows.map(row => ({
    versionId: row.version_id,
    policyId: row.policy_id,
    version: row.version,
    rules: JSON.parse(row.rules),
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    changeReason: row.change_reason,
    policyHash: row.policy_hash
  }));
}

/**
 * Rollback a policy to a specific version
 * @param {string} policyId
 * @param {number} targetVersion
 * @param {string} rolledBackBy
 * @param {string} reason
 * @returns {Promise<Policy>}
 */
export async function rollbackPolicy(policyId, targetVersion, rolledBackBy = 'system', reason = 'Rollback requested') {
  // Get the target version
  const versionRow = await db.get(
    `SELECT * FROM policy_versions WHERE policy_id = ? AND version = ?`,
    [policyId, targetVersion]
  );
  
  if (!versionRow) {
    throw new Error(`Version ${targetVersion} not found for policy ${policyId}`);
  }
  
  // Get current policy
  const currentPolicy = await getPolicy(policyId);
  const newVersion = currentPolicy.version + 1;
  
  // Update policy with old rules as new version
  const now = new Date().toISOString();
  await db.run(
    `UPDATE policies SET 
       version = ?,
       rules = ?,
       updated_at = ?,
       parent_policy_id = ?
     WHERE policy_id = ?`,
    [newVersion, versionRow.rules, now, currentPolicy.id, policyId]
  );
  
  // Record the rollback as a new version
  await db.run(
    `INSERT INTO policy_versions (version_id, policy_id, version, rules, changed_at, changed_by, change_reason, policy_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `ver_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      policyId,
      newVersion,
      versionRow.rules,
      now,
      rolledBackBy,
      `Rollback to version ${targetVersion}: ${reason}`,
      versionRow.policy_hash
    ]
  );
  
  // Reload cache
  await loadActivePolicies();
  
  console.log(`[ABAC] Rolled back policy ${policyId} to version ${targetVersion} (now v${newVersion})`);
  return getPolicy(policyId);
}

/**
 * Update a policy (creates new version)
 * @param {string} policyId
 * @param {Object} updates
 * @param {string} updatedBy
 * @param {string} reason
 * @returns {Promise<Policy>}
 */
export async function updatePolicy(policyId, updates, updatedBy = 'system', reason = 'Policy update') {
  const currentPolicy = await getPolicy(policyId);
  const newVersion = currentPolicy.version + 1;
  
  const updatedPolicy = new Policy({
    ...currentPolicy.toJSON(),
    ...updates,
    version: newVersion,
    updatedAt: new Date().toISOString(),
    parentPolicyId: currentPolicy.id
  });
  
  const validation = updatedPolicy.validate();
  if (!validation.valid) {
    throw new Error(`Invalid policy update: ${validation.errors.join(', ')}`);
  }
  
  const dbData = updatedPolicy.toDB();
  
  await db.run(
    `UPDATE policies SET 
       name = ?,
       version = ?,
       description = ?,
       rules = ?,
       priority = ?,
       updated_at = ?,
       policy_hash = ?,
       parent_policy_id = ?
     WHERE policy_id = ?`,
    [
      dbData.name, dbData.version, dbData.description, dbData.rules, dbData.priority,
      dbData.updated_at, dbData.policy_hash, dbData.parent_policy_id, policyId
    ]
  );
  
  // Record version
  await recordPolicyVersion(updatedPolicy, updatedBy, reason);
  
  // Reload cache
  await loadActivePolicies();
  
  console.log(`[ABAC] Updated policy ${policyId} to version ${newVersion}`);
  return updatedPolicy;
}

/**
 * Deprecate a policy (soft delete)
 * @param {string} policyId
 * @param {string} deprecatedBy
 * @param {string} reason
 * @returns {Promise<Policy>}
 */
export async function deprecatePolicy(policyId, deprecatedBy = 'system', reason = 'Policy deprecated') {
  const now = new Date().toISOString();
  
  await db.run(
    `UPDATE policies SET is_deprecated = 1, is_active = 0, updated_at = ?, updated_by = ? WHERE policy_id = ?`,
    [now, deprecatedBy, policyId]
  );
  
  // Reload cache
  await loadActivePolicies();
  
  console.log(`[ABAC] Deprecated policy ${policyId}: ${reason}`);
  return getPolicy(policyId);
}

/**
 * Get evaluation history
 * @param {Object} filters - { agentId, resource, action, startTime, endTime, limit }
 * @returns {Promise<Array>}
 */
export async function getEvaluationHistory(filters = {}) {
  let sql = 'SELECT * FROM policy_evaluations WHERE 1=1';
  const params = [];
  
  if (filters.agentId) {
    sql += ' AND agent_id = ?';
    params.push(filters.agentId);
  }
  
  if (filters.resource) {
    sql += ' AND resource = ?';
    params.push(filters.resource);
  }
  
  if (filters.action) {
    sql += ' AND action = ?';
    params.push(filters.action);
  }
  
  if (filters.startTime) {
    sql += ' AND evaluated_at >= ?';
    params.push(filters.startTime);
  }
  
  if (filters.endTime) {
    sql += ' AND evaluated_at <= ?';
    params.push(filters.endTime);
  }
  
  sql += ' ORDER BY evaluated_at DESC';
  
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
  }
  
  const rows = await db.all(sql, params);
  
  return rows.map(row => ({
    evaluationId: row.evaluation_id,
    policyId: row.policy_id,
    agentId: row.agent_id,
    resource: row.resource,
    action: row.action,
    decision: row.decision,
    evaluatedAt: row.evaluated_at,
    attributes: JSON.parse(row.attributes || '{}'),
    matchedRules: JSON.parse(row.matched_rules || '[]')
  }));
}

/**
 * Validate policy JSON syntax
 * @param {Object} json
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validatePolicyJSON(json) {
  try {
    const policy = new Policy(json);
    return policy.validate();
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}

/**
 * Load policy from JSON file
 * @param {string} filePath
 * @param {string} loadedBy
 * @returns {Promise<Policy>}
 */
export async function loadPolicyFromFile(filePath, loadedBy = 'system') {
  const content = await fs.readFile(filePath, 'utf8');
  const json = JSON.parse(content);
  return createPolicy(json, loadedBy);
}

/**
 * Close database connection
 */
export async function closeABAC() {
  if (db) {
    await new Promise((resolve) => {
      db.close(() => resolve());
    });
    db = null;
  }
  policyCache.clear();
}

// Export all functions
export default {
  initializeABAC,
  createPolicy,
  activatePolicy,
  deactivatePolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  rollbackPolicy,
  deprecatePolicy,
  getPolicyVersions,
  evaluate,
  getEvaluationHistory,
  validatePolicyJSON,
  loadPolicyFromFile,
  closeABAC,
  Policy,
  PolicyDecision
};
