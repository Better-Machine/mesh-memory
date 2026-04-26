# Phase 8: Deal Room Evolution — Design Document

**Status:** Design Complete | **Date:** 2026-04-26  
**Agent:** protocol-architect (Liz subagent)  
**Scope:** Multi-room workflows, cross-room intelligence, enhanced deal room features

---

## Executive Summary

Phase 8 extends mesh-memory Deal Rooms from single-room negotiations to **orchestrated multi-stage workflows** with **privacy-preserving cross-room intelligence**. This transforms Deal Rooms from isolated collaboration spaces into a **learning negotiation platform**.

### Key Architectural Principles

1. **Privacy-First by Design**: Cross-room intelligence uses only anonymized, differentially-private aggregations
2. **Composable Workflows**: Stage-gated workflows are templates, not code
3. **Event-Driven Architecture**: All state changes emit events for loose coupling
4. **Immutable History**: Version control extends audit principles to document evolution
5. **Separation of Concerns**: Workflow engine ≠ room logic ≠ intelligence layer

---

## 1. System Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Phase 8: Deal Room Evolution                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│  │  WORKFLOW        │    │  DEAL ROOM       │    │  INTELLIGENCE    │ │
│  │  ENGINE          │◄──►│  CORE (v2.0+)    │◄──►│  LAYER           │ │
│  │                  │    │                  │    │                  │ │
│  │ • Templates      │    │ • Room lifecycle │    │ • Pattern detect │ │
│  │ • Stage mgmt     │    │ • Context escrow │    │ • Risk scoring   │ │
│  │ • State machine  │    │ • Consensus      │    │ • Benchmarking   │ │
│  │ • Gate validation│    │ • Enhanced feat. │    │ • Differential   │ │
│  └──────────────────┘    └──────────────────┘    │   privacy        │ │
│           │                       │               └──────────────────┘ │
│           │                       │                      │             │
│           ▼                       ▼                      ▼             │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │                    GOVERNANCE ENGINE (Phase 7)                   │ │
│  │  • ABAC Policy Engine • Compliance Validator • Audit Vault       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Key Files |
|-----------|---------------|-----------|
| **Workflow Engine** | Orchestrate multi-room workflows, manage stage transitions, validate gates | `deal-room-workflow.mjs` |
| **Deal Room Core** | Single-room lifecycle, context escrow, consensus, enhanced features | `deal-room.mjs` (extended) |
| **Intelligence Layer** | Pattern detection, risk analysis, benchmarking with privacy guarantees | `cross-room-intelligence.mjs` |
| **Governance Engine** | Policy enforcement, compliance validation, audit (Phase 7) | Existing |

---

## 2. Feature 1: Multi-Room Workflows

### 2.1 Conceptual Model

A **Workflow** is a template that defines sequential stages, where each stage is a Deal Room. Rooms are linked through:
- **Explicit transitions**: Defined in workflow template
- **Context passing**: Sanitized data flows forward
- **Stage gates**: Criteria must be met before advancing

```
Workflow: Series A Negotiation
├── Stage 1: Discovery Room
│   ├── Duration: 7 days
│   ├── Purpose: Information gathering
│   ├── Gate: term_sheet_draft.exists
│   └── Output: → Stage 2 (sanitized)
│
├── Stage 2: Negotiation Room  
│   ├── Duration: 14 days
│   ├── Purpose: Term negotiation
│   ├── Gate: consensus.reached AND price.within_range
│   └── Output: → Stage 3 (full context)
│
└── Stage 3: Closing Room
    ├── Duration: 3 days
    ├── Purpose: Final signatures
    ├── Gate: signatures.all_collected
    └── Output: Deal complete
```

### 2.2 Data Model

```typescript
// Workflow Template Schema
interface WorkflowTemplate {
  id: string;                    // "wf_series_a_negotiation"
  name: string;
  description: string;
  version: string;
  category: "funding" | "partnership" | "employment" | "custom";
  
  stages: StageDefinition[];
  transitions: TransitionDefinition[];
  
  // Global workflow settings
  settings: {
    allowParallelStages: boolean;
    autoAdvance: boolean;
    notifyOnTransition: boolean;
  };
}

interface StageDefinition {
  id: string;                    // "discovery", "negotiation", "closing"
  name: string;
  order: number;                 // Sequential position
  
  // Room configuration for this stage
  roomTemplate: {
    purpose: string;
    scope: RoomScope;
    policy: RoomPolicy;
    defaultParticipants: ParticipantTemplate[];
  };
  
  // Time constraints
  duration: {
    days: number;
    canExtend: boolean;
    maxExtensions: number;
  };
  
  // Gate configuration
  gate: {
    type: "manual" | "automatic" | "hybrid";
    conditions: GateCondition[];
    approvers?: string[];        // For manual gates
  };
  
  // Context passing rules
  contextInheritance: {
    fromPrevious: "none" | "summary" | "full";
    sanitizeRules: SanitizeRule[];
  };
}

interface GateCondition {
  id: string;
  type: "artifact" | "consensus" | "consent" | "time" | "custom";
  
  // Artifact condition
  artifact?: {
    type: string;              // "document", "signature", "proposal"
    required: boolean;
    validator?: string;        // Function reference for custom validation
  };
  
  // Consensus condition
  consensus?: {
    threshold: "unanimous" | "majority" | number;  // number = percentage
    onProposal?: boolean;
  };
  
  // Time condition
  time?: {
    minDuration?: number;        // Minimum time in stage (seconds)
    maxDuration?: number;        // Maximum time in stage (seconds)
  };
  
  // Custom condition (JavaScript expression or function ref)
  custom?: {
    expression: string;          // e.g., "outputs.term_sheet_draft.exists"
    function?: string;           // Reference to validation function
  };
}

interface TransitionDefinition {
  from: string;                  // Stage ID
  to: string;                    // Stage ID
  
  // Auto-transition when gate met?
  autoTransition: boolean;
  
  // Pre-transition hooks
  beforeTransition?: string[];   // Event handlers
  
  // Context transformation
  contextMapping: ContextMapping[];
}
```

### 2.3 Workflow Instance Model

```typescript
interface WorkflowInstance {
  id: string;                    // "wfi_abc123"
  templateId: string;
  status: "active" | "completed" | "cancelled" | "paused";
  
  createdAt: string;
  createdBy: string;             // Agent ID
  
  // Stage instances
  stages: StageInstance[];
  currentStageId: string;
  
  // Participants across all stages
  participants: WorkflowParticipant[];
  
  // Global workflow outputs
  outputs: Record<string, unknown>;
  
  // Audit trail
  history: WorkflowEvent[];
}

interface StageInstance {
  id: string;
  stageDefinitionId: string;
  roomId: string;                // Associated deal room
  
  status: "pending" | "active" | "gated" | "completed" | "skipped";
  
  // Timeline
  activatedAt?: string;
  expectedCompletionAt?: string;
  completedAt?: string;
  
  // Gate status
  gateStatus: {
    conditions: ConditionStatus[];
    overallMet: boolean;
    checkedAt: string;
  };
  
  // Stage outputs (flow to next stage)
  outputs: Record<string, unknown>;
}
```

### 2.4 API Design

```javascript
// ============ WORKFLOW TEMPLATE MANAGEMENT ============

/**
 * Register a workflow template
 * @param {WorkflowTemplate} template - Template definition
 * @param {string} creatorAgentId - Creating agent
 * @returns {Promise<TemplateRegistrationResult>}
 */
async function registerWorkflowTemplate(template, creatorAgentId);

/**
 * Get available workflow templates
 * @param {Object} filters - { category, tags }
 * @returns {Promise<WorkflowTemplate[]>}
 */
async function listWorkflowTemplates(filters = {});

/**
 * Get template by ID
 * @param {string} templateId
 * @returns {Promise<WorkflowTemplate>}
 */
async function getWorkflowTemplate(templateId);

// ============ WORKFLOW INSTANCE OPERATIONS ============

/**
 * Create and start a workflow instance
 * @param {string} templateId - Workflow template
 * @param {Object} config - { participants, overrides, metadata }
 * @param {string} creatorAgentId - Creating agent
 * @returns {Promise<WorkflowInstance>} - Created instance
 */
async function createWorkflow(templateId, config, creatorAgentId);

/**
 * Get workflow instance
 * @param {string} instanceId
 * @returns {Promise<WorkflowInstance>}
 */
async function getWorkflow(instanceId);

/**
 * Advance to next stage (if gate conditions met)
 * @param {string} instanceId
 * @param {string} actorAgentId - Agent advancing
 * @param {Object} context - Additional context for transition
 * @returns {Promise<AdvanceResult>}
 */
async function advanceStage(instanceId, actorAgentId, context = {});

/**
 * Check if stage can advance (dry run)
 * @param {string} instanceId
 * @returns {Promise<GateCheckResult>}
 */
async function canAdvanceStage(instanceId);

/**
 * Get current stage status with gate details
 * @param {string} instanceId
 * @returns {Promise<StageStatus>}
 */
async function getStageStatus(instanceId);

/**
 * Pause workflow (emergency stop)
 * @param {string} instanceId
 * @param {string} reason
 * @param {string} actorAgentId
 * @returns {Promise<void>}
 */
async function pauseWorkflow(instanceId, reason, actorAgentId);

/**
 * Resume paused workflow
 * @param {string} instanceId
 * @param {string} actorAgentId
 * @returns {Promise<void>}
 */
async function resumeWorkflow(instanceId, actorAgentId);

/**
 * Cancel workflow
 * @param {string} instanceId
 * @param {string} reason
 * @param {string} actorAgentId
 * @returns {Promise<void>}
 */
async function cancelWorkflow(instanceId, reason, actorAgentId);

/**
 * List active workflows
 * @param {Object} filters - { status, participant, template }
 * @returns {Promise<WorkflowSummary[]>}
 */
async function listWorkflows(filters = {});

// ============ GATE MANAGEMENT ============

/**
 * Evaluate gate conditions for current stage
 * @param {string} instanceId
 * @returns {Promise<GateEvaluationResult>}
 */
async function evaluateGates(instanceId);

/**
 * Force gate approval (admin override)
 * @param {string} instanceId
 * @param {string} conditionId
 * @param {string} approverAgentId
 * @param {string} reason
 * @returns {Promise<void>}
 */
async function overrideGate(instanceId, conditionId, approverAgentId, reason);

/**
 * Submit artifact for gate condition
 * @param {string} instanceId
 * @param {string} conditionId
 * @param {Object} artifact - Artifact data
 * @param {string} submitterAgentId
 * @returns {Promise<void>}
 */
async function submitGateArtifact(instanceId, conditionId, artifact, submitterAgentId);
```

### 2.5 Workflow State Machine

```
                    ┌─────────────┐
                    │   PENDING   │
                    │   START     │
                    └──────┬──────┘
                           │ createWorkflow()
                           ▼
              ┌────────────────────────┐
              │      ACTIVE STAGE        │
              │    (Stage N Active)      │
              └───────────┬──────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │  GATED    │  │  EXPIRED  │  │ COMPLETED │
    │ (Waiting  │  │  (Time    │  │ (Gate met)│
    │ for gate) │  │  limit)   │  │           │
    └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
          │              │              │
          │ gate met     │              │ advanceStage()
          │              │              ▼
          └──────────────┴──────► ┌───────────┐
                                  │  NEXT     │
                                  │  STAGE    │
                                  └─────┬─────┘
                                        │
                          ┌─────────────┼─────────────┐
                          │             │             │
                          ▼             ▼             ▼
                   ┌───────────┐  ┌───────────┐  ┌───────────┐
                   │  ACTIVE   │  │ COMPLETED │  │ CANCELLED │
                   │  (Loop)   │  │ (Final)   │  │ (Final)   │
                   └───────────┘  └───────────┘  └───────────┘
```

### 2.6 Context Passing & Sanitization

```javascript
// Context inheritance rules define what passes between stages
const ContextInheritanceLevel = {
  NONE: 'none',           // Fresh room, no context
  SUMMARY: 'summary',     // Anonymized summary only
  FILTERED: 'filtered',   // Filtered by allowlist
  FULL: 'full'            // Complete context (rare, trusted stages)
};

// Sanitization rules
interface SanitizeRule {
  field: string;              // Field pattern (supports wildcards)
  action: 'redact' | 'hash' | 'tokenize' | 'allow';
  
  // For hash action: salt for deterministic hashing
  salt?: string;
  
  // For tokenize: mapping table reference
  tokenMap?: string;
  
  // Conditions for rule application
  condition?: {
    stage?: string[];         // Only apply in these stages
    participantRole?: string[]; // Only for these roles
  };
}

// Example: Series A workflow context passing
const seriesAContextRules = {
  discovery: {
    to: 'negotiation',
    inheritance: 'filtered',
    rules: [
      { field: 'company_name', action: 'allow' },
      { field: 'funding_round', action: 'allow' },
      { field: 'valuation_expectation', action: 'allow' },
      { field: 'financials.*', action: 'allow' },
      { field: 'founder_names', action: 'tokenize' },
      { field: 'proprietary.*', action: 'redact' }
    ]
  },
  negotiation: {
    to: 'closing',
    inheritance: 'full',  // Full context for closing
    rules: []           // No filtering needed
  }
};
```

---

## 3. Feature 2: Cross-Room Intelligence

### 3.1 Privacy Model

**Core Principle**: Intelligence is extracted from **anonymized aggregates**, never raw room data.

```
Raw Room Data          Anonymization Layer          Intelligence Output
─────────────────      ─────────────────────       ───────────────────
Room A:                Differential Privacy          Pattern:
  - Term: $5M              + Noise (ε=1.0)           "Series A valuation
  - Company: Acme                                    typically 4-8x ARR"
  - Founders: Alice
                                       
Room B:                Aggregation                   Risk Signal:
  - Term: $3M              Across N rooms            "73% of deals stall
  - Company: Beta                                      at term sheet stage"
  - Founders: Bob
                                       
Room C:                Pattern Extraction            Benchmark:
  - Term: $8M              ML on anonymized          "Your deal is 15%
  - Company: Gamma                                       faster than avg"
  - Founders: Carol
```

### 3.2 Differential Privacy Implementation

```typescript
// Privacy budget per query
interface PrivacyBudget {
  epsilon: number;       // Privacy parameter (lower = more private)
  delta: number;         // Failure probability
  maxQueries: number;    // Queries allowed before budget exhausted
}

// Default budgets by sensitivity
const PRIVACY_BUDGETS = {
  public: { epsilon: 1.0, delta: 1e-5, maxQueries: 100 },
  sensitive: { epsilon: 0.1, delta: 1e-6, maxQueries: 10 },
  critical: { epsilon: 0.01, delta: 1e-7, maxQueries: 5 }
};

// Noise mechanisms
enum NoiseMechanism {
  LAPLACE = 'laplace',    // For numeric queries
  GAUSSIAN = 'gaussian',  // For high-dimensional data
  EXPONENTIAL = 'exponential' // For selection queries
}

/**
 * Add Laplace noise for differential privacy
 * @param {number} value - True value
 * @param {number} sensitivity - Query sensitivity
 * @param {number} epsilon - Privacy parameter
 * @returns {number} Noisy value
 */
function addLaplaceNoise(value, sensitivity, epsilon) {
  const scale = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  return value + noise;
}
```

### 3.3 Data Model

```typescript
// Anonymized pattern storage
interface PatternRecord {
  id: string;
  patternType: PatternType;
  
  // Anonymized dimensions (k-anonymity >= 5)
  dimensions: {
    dealCategory: string;     // "series_a", "partnership", etc.
    industry: string;         // "saas", "fintech", etc. (coarse)
    dealSizeRange: string;    // "1-5M", "5-10M", etc.
    region: string;           // "na", "eu", "apac"
    participantCount: number; // 2, 3, 4+
  };
  
  // Pattern data (differentially private)
  pattern: {
    metric: string;           // "valuation_multiple", "time_to_close"
    value: number;            // Noisy aggregate
    confidence: number;       // Statistical confidence
    sampleSize: number;       // Minimum 5 (k-anonymity)
    noiseMagnitude: number;     // Amount of DP noise added
  };
  
  // Temporal
  timeWindow: {
    start: string;
    end: string;
  };
  
  // Privacy tracking
  privacy: {
    epsilonUsed: number;
    mechanism: NoiseMechanism;
    sourceRooms: number;      // Count only, no IDs
  };
  
  createdAt: string;
  expiresAt: string;          // TTL for stale patterns
}

// Risk signals
interface RiskSignal {
  id: string;
  signalType: 'stall_risk' | 'conflict_risk' | 'abandonment_risk';
  
  // Context
  dealCategory: string;
  currentStage: string;
  
  // Signal data
  signal: {
    level: 'low' | 'medium' | 'high' | 'critical';
    probability: number;        // 0-1, DP-noisy
    confidence: number;
    factors: string[];        // Contributing factors
  };
  
  // Anonymized precedent
  similarDeals: {
    count: number;              // How many similar deals
    outcomeRate: number;      // Success rate (DP-noisy)
    avgTimeToResolution: number;
  };
  
  generatedAt: string;
}

// Benchmark data
interface Benchmark {
  id: string;
  metric: string;             // "time_to_close", "negotiation_rounds"
  
  // Distribution (binned, DP-noisy)
  distribution: {
    bins: string[];           // ["0-7d", "7-14d", "14-30d", "30d+"]
    frequencies: number[];    // Percentage in each bin (DP-noisy)
  };
  
  // Statistics
  statistics: {
    median: number;           // DP-noisy
    p25: number;
    p75: number;
    p90: number;
  };
  
  // Context
  filters: {
    category?: string;
    industry?: string;
    sizeRange?: string;
  };
  
  sampleSize: number;
  generatedAt: string;
}
```

### 3.4 API Design

```javascript
// ============ PATTERN DETECTION ============

/**
 * Detect patterns across rooms
 * @param {Object} query - { dealCategory, dimensions, metric }
 * @param {PrivacyBudget} budget - Privacy parameters
 * @returns {Promise<PatternResult>}
 */
async function detectPatterns(query, budget);

/**
 * Get common negotiation patterns
 * @param {string} dealCategory - "series_a", "partnership", etc.
 * @returns {Promise<Pattern[]>}
 */
async function getCommonPatterns(dealCategory);

/**
 * Analyze term frequency
 * @param {string} termType - "valuation", "equity_split", etc.
 * @param {Object} filters - Category, industry filters
 * @returns {Promise<TermFrequency>}
 */
async function analyzeTermFrequency(termType, filters);

// ============ SUCCESS PREDICTION ============

/**
 * Predict deal success likelihood
 * @param {string} roomId - Current deal room
 * @returns {Promise<PredictionResult>}
 */
async function predictSuccess(roomId);

/**
 * Get success factors for deal type
 * @param {string} dealCategory
 * @returns {Promise<SuccessFactor[]>}
 */
async function getSuccessFactors(dealCategory);

// ============ RISK IDENTIFICATION ============

/**
 * Identify risks for current deal
 * @param {string} roomId
 * @returns {Promise<RiskSignal[]>}
 */
async function identifyRisks(roomId);

/**
 * Get common failure modes
 * @param {string} dealCategory
 * @param {string} stage - Optional stage filter
 * @returns {Promise<FailureMode[]>}
 */
async function getCommonFailureModes(dealCategory, stage);

// ============ BENCHMARKING ============

/**
 * Compare current deal to benchmarks
 * @param {string} roomId
 * @param {Object} metrics - Metrics to compare
 * @returns {Promise<BenchmarkComparison>}
 */
async function benchmarkDeal(roomId, metrics);

/**
 * Get benchmark data
 * @param {string} metric
 * @param {Object} filters
 * @returns {Promise<Benchmark>}
 */
async function getBenchmark(metric, filters);

// ============ INSIGHT GENERATION ============

/**
 * Generate contextual insights for room
 * @param {string} roomId
 * @param {Object} context - Current negotiation context
 * @returns {Promise<Insight[]>}
 */
async function generateInsights(roomId, context);

/**
 * Get clause recommendations
 * @param {string} clauseType
 * @param {Object} dealContext
 * @returns {Promise<ClauseInsight>}
 */
async function getClauseInsights(clauseType, dealContext);

// ============ PRIVACY MANAGEMENT ============

/**
 * Check privacy budget status
 * @returns {Promise<BudgetStatus>}
 */
async function checkPrivacyBudget();

/**
 * Reset privacy budgets (admin only)
 * @param {string} adminAgentId
 * @returns {Promise<void>}
 */
async function resetPrivacyBudgets(adminAgentId);
```

### 3.5 Insight Generation Examples

```javascript
// Example insights the system can generate:

// Pattern insight
{
  type: "pattern",
  message: "Valuation multiples in Series A SaaS deals typically range 4-8x ARR",
  confidence: 0.87,
  sampleSize: 47,
  source: "anonymized_aggregate"
}

// Risk insight
{
  type: "risk",
  message: "Deals at the term sheet stage for >14 days have 73% stall risk",
  level: "high",
  confidence: 0.82,
  sampleSize: 23,
  factors: ["duration_exceeded", "no_recent_activity"]
}

// Benchmark insight
{
  type: "benchmark",
  message: "Your negotiation timeline is 15% faster than similar deals",
  percentile: 85,
  comparison: { current: 12, median: 14, unit: "days" }
}

// Clause insight
{
  type: "clause",
  message: "This liquidation preference clause was rejected in 3 of 12 similar deals",
  clause: "2x non-participating",
  prevalence: 0.25,
  rejectionRate: 0.75
}
```

---

## 4. Feature 3: Enhanced Deal Room Features

### 4.1 Real-Time Collaboration

```typescript
// Collaboration session
interface CollaborationSession {
  id: string;
  roomId: string;
  documentId: string;
  
  // Session state
  status: 'active' | 'locked' | 'closed';
  startedAt: string;
  endedAt?: string;
  
  // Participants
  participants: {
    agentId: string;
    joinedAt: string;
    cursor?: CursorPosition;
    selection?: TextSelection;
    isTyping: boolean;
  }[];
  
  // Document state (CRDT-based)
  document: CRDTDocument;
  
  // Operation log
  operations: Operation[];
}

// CRDT for conflict-free collaboration
interface CRDTDocument {
  id: string;
  content: string;
  version: number;
  
  // Operational transform or CRDT state
  crdtState: {
    type: 'yjs' | 'automerge';
    stateVector: Uint8Array;
    updates: Uint8Array[];
  };
}
```

### 4.2 Version Control

```typescript
// Document version
interface DocumentVersion {
  id: string;
  roomId: string;
  documentId: string;
  
  // Version metadata
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  
  // Content
  content: string;
  contentHash: string;       // SHA-256
  
  // Change tracking
  parentVersion?: string;    // Previous version (null for v1)
  changeSummary: string;
  diff: DiffResult;
  
  // Attribution
  contributors: string[];    // Agents who contributed
  operations: number;        // Number of edit operations
}

// Diff result
interface DiffResult {
  additions: number;
  deletions: number;
  modifications: number;
  hunks: DiffHunk[];
}
```

### 4.3 Conflict Resolution

```javascript
// Conflict resolution strategies
const ConflictResolution = {
  // Tie-breaking mechanisms
  FIRST_COME: 'first_come',       // First proposal wins
  LAST_PROPOSAL: 'last_proposal',   // Most recent wins
  VOTING: 'voting',                 // Participants vote
  RANDOM: 'random',                 // Random selection
  ADMIN: 'admin',                   // Admin decides
  SCORE: 'score',                   // Scoring function
  
  // Consensus approaches
  UNANIMOUS: 'unanimous',
  MAJORITY: 'majority',
  SUPERMAJORITY: 'supermajority',
  
  // Escalation
  ESCALATE: 'escalate'              // Escalate to human
};

/**
 * Resolve conflict between competing proposals
 * @param {string} roomId
 * @param {string[]} proposalIds
 * @param {string} strategy - Resolution strategy
 * @param {string} resolverAgentId
 * @returns {Promise<ResolutionResult>}
 */
async function resolveConflict(roomId, proposalIds, strategy, resolverAgentId);

/**
 * Initiate vote for conflict resolution
 * @param {string} roomId
 * @param {Object} voteConfig
 * @returns {Promise<VoteSession>}
 */
async function initiateResolutionVote(roomId, voteConfig);
```

### 4.4 Time-Boxing

```typescript
// Time-boxed room configuration
interface TimeBoxConfig {
  enabled: boolean;
  
  // Duration
  duration: {
    days?: number;
    hours?: number;
    minutes?: number;
  };
  
  // Extensions
  extensions: {
    allowed: boolean;
    maxExtensions: number;
    extensionDuration: number;  // hours per extension
    requiresConsensus: boolean;
  };
  
  // Actions on expiry
  onExpiry: {
    action: 'close' | 'auto_resolve' | 'escalate';
    autoResolveStrategy?: string;
    escalationTarget?: string;
  };
  
  // Warnings
  warnings: {
    enabled: boolean;
    thresholds: number[];  // Hours before expiry to warn
  };
}

// Expiry tracking
interface ExpiryTracker {
  roomId: string;
  expiryAt: string;
  warningsSent: number[];
  extensionsUsed: number;
  isExtended: boolean;
}
```

### 4.5 Notification System

```typescript
// Notification configuration
interface NotificationConfig {
  roomId: string;
  
  // Event subscriptions
  subscriptions: {
    event: NotificationEvent;
    channels: NotificationChannel[];
    filters?: NotificationFilter;
  }[];
  
  // Channel configurations
  channels: {
    a2a: boolean;           // A2A message
    webhook?: string;       // HTTP callback
    email?: string;         // Email notification
    sms?: string;           // SMS (for critical only)
  };
}

// Notification events
enum NotificationEvent {
  ROOM_CREATED = 'room_created',
  STAGE_ADVANCED = 'stage_advanced',
  PROPOSAL_SUBMITTED = 'proposal_submitted',
  CONSENSUS_REACHED = 'consensus_reached',
  CONFLICT_DETECTED = 'conflict_detected',
  EXPIRY_WARNING = 'expiry_warning',
  ROOM_EXPIRED = 'room_expired',
  ROOM_CLOSED = 'room_closed',
  GATE_CONDITION_MET = 'gate_condition_met',
  PARTICIPANT_JOINED = 'participant_joined',
  CUSTOM = 'custom'
}
```

### 4.6 Export System

```javascript
// Export formats
const ExportFormat = {
  JSON: 'json',
  JSONL: 'jsonl',
  PDF: 'pdf',
  MARKDOWN: 'markdown',
  CSV: 'csv'
};

/**
 * Export deal room data
 * @param {string} roomId
 * @param {Object} options - { format, includeAudit, redactPII }
 * @returns {Promise<ExportResult>}
 */
async function exportRoom(roomId, options);

/**
 * Generate deal summary
 * @param {string} roomId
 * @returns {Promise<DealSummary>}
 */
async function generateDealSummary(roomId);

/**
 * Export audit trail
 * @param {string} roomId
 * @param {ExportFormat} format
 * @returns {Promise<ExportResult>}
 */
async function exportAuditTrail(roomId, format);
```

---

## 5. Integration Architecture

### 5.1 Integration with Deal Room Core

```javascript
// Enhanced Deal Room with Phase 8 features
class EnhancedDealRoom {
  constructor(baseRoom) {
    this.baseRoom = baseRoom;
    this.versionControl = new VersionControl();
    this.collaboration = new CollaborationSession();
    this.timeBox = new TimeBoxTracker();
    this.notifications = new NotificationManager();
  }
  
  // Extended room creation with Phase 8 features
  async createEnhancedRoom(config) {
    const room = await createRoom(config.baseConfig);
    
    // Initialize enhanced features
    await this.versionControl.initialize(room.id);
    await this.timeBox.configure(room.id, config.timeBox);
    await this.notifications.configure(room.id, config.notifications);
    
    return room;
  }
}
```

### 5.2 Integration with Workflow Engine

```javascript
// Workflow creates rooms through enhanced API
async function createStageRoom(workflowInstance, stageDefinition) {
  // Create base room
  const room = await createRoom(
    stageDefinition.roomTemplate.purpose,
    stageDefinition.roomTemplate.scope,
    stageDefinition.roomTemplate.policy,
    stageDefinition.roomTemplate.defaultParticipants,
    workflowInstance.createdBy
  );
  
  // Configure enhanced features
  await configureTimeBoxing(room.roomId, stageDefinition.duration);
  await configureNotifications(room.roomId, stageDefinition.notifications);
  
  // Link to workflow
  await linkRoomToWorkflow(workflowInstance.id, stageDefinition.id, room.roomId);
  
  return room;
}
```

### 5.3 Integration with Intelligence Layer

```javascript
// Intelligence operates on anonymized aggregates only
async function updateIntelligence(roomId, event) {
  // Extract anonymized features (no PII)
  const features = await extractAnonymizedFeatures(roomId, event);
  
  // Update pattern database with DP guarantees
  await updatePatterns(features, PRIVACY_BUDGETS.sensitive);
  
  // Generate insights for participants
  const insights = await generateInsights(roomId);
  await notifyParticipants(roomId, insights);
}

// Privacy boundary enforcement
async function extractAnonymizedFeatures(roomId, event) {
  const room = await getRoom(roomId);
  
  // Remove all identifying information
  return {
    dealCategory: room.category,
    industry: coarseIndustry(room.industry),  // Aggregate to coarse level
    dealSizeRange: binDealSize(room.dealSize),
    participantCount: binParticipantCount(room.participants.length),
    stage: room.state,
    duration: anonymizeDuration(room.duration),
    // Never include: company names, founder names, specific terms
  };
}
```

---

## 6. Privacy Safeguards

### 6.1 Data Classification

| Data Class | Can Cross Rooms | Can Be Aggregated | Retention |
|------------|-----------------|-------------------|-----------|
| **Raw Room Data** | ❌ Never | ❌ Never | Room lifetime + retention policy |
| **Anonymized Summaries** | ✅ With filters | ✅ Limited | 90 days |
| **Pattern Aggregates** | ✅ Always | ✅ DP-noisy | 1 year |
| **Benchmark Data** | ✅ Always | ✅ Fully anonymized | 2 years |

### 6.2 Privacy Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                    PRIVACY ARCHITECTURE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   ROOM A    │    │   ROOM B    │    │   ROOM C    │        │
│  │  (Private)  │    │  (Private)  │    │  (Private)  │        │
│  │             │    │             │    │             │        │
│  │ • Raw data  │    │ • Raw data  │    │ • Raw data  │        │
│  │ • Context   │    │ • Context   │    │ • Context   │        │
│  │ • Proposals │    │ • Proposals │    │ • Proposals │        │
│  │ • Decisions │    │ • Decisions │    │ • Decisions │        │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘        │
│         │                  │                  │               │
│         │  NO DIRECT FLOW  │  NO DIRECT FLOW  │               │
│         │                  │                  │               │
│         ▼                  ▼                  ▼               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │              ANONYMIZATION LAYER                     │     │
│  │                                                      │     │
│  │  • k-anonymity (k ≥ 5)                              │     │
│  │  • Differential privacy (ε ≤ 1.0)                   │     │
│  │  • PII redaction                                    │     │
│  │  • Tokenization                                     │     │
│  │                                                      │     │
│  └─────────────────────────┬───────────────────────────┘     │
│                            │                                   │
│                            ▼                                   │
│  ┌─────────────────────────────────────────────────────┐     │
│  │         PATTERN / INTELLIGENCE LAYER                 │     │
│  │                                                      │     │
│  │  • Aggregated statistics (noisy)                  │     │
│  │  • Pattern trends                                   │     │
│  │  • Risk signals (anonymized)                      │     │
│  │  • Benchmarks                                     │     │
│  │                                                      │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 6.3 Differential Privacy Guarantees

| Metric | ε | δ | Use Case |
|--------|---|---|----------|
| Pattern counts | 1.0 | 1e-5 | "How many deals in Q1?" |
| Term frequencies | 0.5 | 1e-6 | "Common negotiation terms" |
| Success rates | 0.1 | 1e-6 | "Likelihood of closing" |
| Duration statistics | 1.0 | 1e-5 | "Time to close benchmarks" |
| Risk signals | 0.1 | 1e-7 | "Stall risk prediction" |

### 6.4 Context Passing Rules

```javascript
// Workflow context inheritance is EXPLICIT and FILTERED
const CONTEXT_INHERITANCE_RULES = {
  // Level: What can flow
  levels: {
    NONE: {
      description: "No context passes",
      useCase: "Fresh start, highly sensitive negotiations"
    },
    SUMMARY: {
      description: "Anonymized summary only",
      useCase: "Standard workflow progression",
      allowed: ['deal_category', 'stage_outcome', 'duration']
    },
    FILTERED: {
      description: "Filtered by explicit allowlist",
      useCase: "Controlled information sharing",
      requires: 'explicit_sanitize_rules'
    },
    FULL: {
      description: "Complete context (rare)",
      useCase: "Trusted internal stages only",
      requires: ['admin_approval', 'same_organization']
    }
  }
};
```

---

## 7. Database Schema

### 7.1 New Tables

```sql
-- Workflow Templates
CREATE TABLE workflow_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  version TEXT NOT NULL,
  definition JSON NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

-- Workflow Instances
CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'cancelled', 'paused')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  current_stage_id TEXT,
  outputs JSON,
  FOREIGN KEY (template_id) REFERENCES workflow_templates(id)
);

-- Stage Instances
CREATE TABLE stage_instances (
  id TEXT PRIMARY KEY,
  workflow_instance_id TEXT NOT NULL,
  stage_definition_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'gated', 'completed', 'skipped')),
  activated_at TEXT,
  expected_completion_at TEXT,
  completed_at TEXT,
  gate_status JSON,
  outputs JSON,
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id)
);

-- Workflow Participants
CREATE TABLE workflow_participants (
  workflow_instance_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (workflow_instance_id, agent_id),
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id)
);

-- Workflow Events (Audit)
CREATE TABLE workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_instance_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stage_id TEXT,
  actor TEXT NOT NULL,
  details JSON,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id)
);

-- Pattern Records (Anonymized)
CREATE TABLE pattern_records (
  id TEXT PRIMARY KEY,
  pattern_type TEXT NOT NULL,
  dimensions JSON NOT NULL,
  pattern JSON NOT NULL,
  time_window JSON NOT NULL,
  privacy JSON NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Risk Signals
CREATE TABLE risk_signals (
  id TEXT PRIMARY KEY,
  signal_type TEXT NOT NULL,
  deal_category TEXT NOT NULL,
  current_stage TEXT,
  signal JSON NOT NULL,
  similar_deals JSON,
  generated_at TEXT NOT NULL
);

-- Benchmarks
CREATE TABLE benchmarks (
  id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  distribution JSON NOT NULL,
  statistics JSON NOT NULL,
  filters JSON,
  sample_size INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);

-- Document Versions
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  change_summary TEXT,
  diff JSON,
  contributors JSON,
  FOREIGN KEY (room_id) REFERENCES deal_rooms(room_id)
);

-- Collaboration Sessions
CREATE TABLE collaboration_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  crdt_state JSON,
  FOREIGN KEY (room_id) REFERENCES deal_rooms(room_id)
);

-- Expiry Trackers
CREATE TABLE expiry_trackers (
  room_id TEXT PRIMARY KEY,
  expiry_at TEXT NOT NULL,
  warnings_sent JSON,
  extensions_used INTEGER DEFAULT 0,
  is_extended BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (room_id) REFERENCES deal_rooms(room_id)
);

-- Notification Subscriptions
CREATE TABLE notification_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channels JSON NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES deal_rooms(room_id)
);

-- Privacy Budget Tracking
CREATE TABLE privacy_budget_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_type TEXT NOT NULL,
  epsilon_used REAL NOT NULL,
  delta_used REAL NOT NULL,
  timestamp TEXT NOT NULL
);
```

---

## 8. Sample Workflow Templates

### 8.1 Template 1: Series A Funding

```json
{
  "id": "wf_series_a_funding",
  "name": "Series A Funding Negotiation",
  "description": "Standard workflow for Series A venture capital negotiations",
  "category": "funding",
  "version": "1.0.0",
  
  "stages": [
    {
      "id": "discovery",
      "name": "Discovery & Information Gathering",
      "order": 1,
      "roomTemplate": {
        "purpose": "Initial information sharing and due diligence preparation",
        "scope": {
          "topics": ["company_overview", "market_analysis", "team_background"],
          "maxParticipants": 6
        },
        "policy": {
          "consensusRequired": "majority",
          "retentionDays": 2555
        },
        "defaultParticipants": [
          { "role": "founder", "roleTemplate": "negotiator" },
          { "role": "vc_lead", "roleTemplate": "negotiator" },
          { "role": "vc_associate", "roleTemplate": "reviewer" }
        ]
      },
      "duration": { "days": 14, "canExtend": true, "maxExtensions": 2 },
      "gate": {
        "type": "hybrid",
        "conditions": [
          { "type": "artifact", "artifact": { "type": "term_sheet_draft", "required": true } },
          { "type": "consensus", "consensus": { "threshold": "majority" } },
          { "type": "time", "time": { "minDuration": 604800 } }
        ]
      },
      "contextInheritance": { "fromPrevious": "none", "sanitizeRules": [] }
    },
    {
      "id": "negotiation",
      "name": "Term Negotiation",
      "order": 2,
      "roomTemplate": {
        "purpose": "Negotiate final term sheet terms",
        "scope": {
          "topics": ["valuation", "equity_split", "liquidation_preference", "board_seats"],
          "maxParticipants": 6
        },
        "policy": {
          "consensusRequired": "unanimous",
          "retentionDays": 2555
        }
      },
      "duration": { "days": 21, "canExtend": true, "maxExtensions": 3 },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "consensus", "consensus": { "threshold": "unanimous", "onProposal": true } },
          { "type": "artifact", "artifact": { "type": "signed_term_sheet", "required": true } }
        ]
      },
      "contextInheritance": {
        "fromPrevious": "filtered",
        "sanitizeRules": [
          { "field": "company_name", "action": "allow" },
          { "field": "valuation_range", "action": "allow" },
          { "field": "founder_names", "action": "tokenize" },
          { "field": "proprietary_metrics", "action": "redact" }
        ]
      }
    },
    {
      "id": "closing",
      "name": "Deal Closing",
      "order": 3,
      "roomTemplate": {
        "purpose": "Final documentation and fund transfer coordination",
        "scope": {
          "topics": ["final_docs", "wire_transfer", "announcement"],
          "maxParticipants": 8
        },
        "policy": {
          "consensusRequired": "unanimous",
          "retentionDays": 2555
        }
      },
      "duration": { "days": 7, "canExtend": false },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "artifact", "artifact": { "type": "signed_agreements", "required": true } },
          { "type": "artifact", "artifact": { "type": "wire_confirmation", "required": true } }
        ]
      },
      "contextInheritance": { "fromPrevious": "full", "sanitizeRules": [] }
    }
  ],
  
  "transitions": [
    {
      "from": "discovery",
      "to": "negotiation",
      "autoTransition": true,
      "contextMapping": [
        { "from": "term_sheet_draft", "to": "starting_document" }
      ]
    },
    {
      "from": "negotiation",
      "to": "closing",
      "autoTransition": true,
      "contextMapping": [
        { "from": "signed_term_sheet", "to": "governing_terms" }
      ]
    }
  ],
  
  "settings": {
    "allowParallelStages": false,
    "autoAdvance": true,
    "notifyOnTransition": true
  }
}
```

### 8.2 Template 2: Strategic Partnership

```json
{
  "id": "wf_strategic_partnership",
  "name": "Strategic Partnership Negotiation",
  "description": "Workflow for establishing strategic business partnerships",
  "category": "partnership",
  "version": "1.0.0",
  
  "stages": [
    {
      "id": "exploration",
      "name": "Partnership Exploration",
      "order": 1,
      "duration": { "days": 30, "canExtend": true, "maxExtensions": 2 },
      "gate": {
        "type": "manual",
        "conditions": [
          { "type": "consent", "approvers": ["biz_dev_lead"] }
        ]
      },
      "contextInheritance": { "fromPrevious": "none" }
    },
    {
      "id": "terms",
      "name": "Partnership Terms",
      "order": 2,
      "duration": { "days": 45, "canExtend": true, "maxExtensions": 3 },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "consensus", "consensus": { "threshold": "majority" } },
          { "type": "artifact", "artifact": { "type": "partnership_agreement", "required": true } }
        ]
      },
      "contextInheritance": { "fromPrevious": "filtered" }
    },
    {
      "id": "legal",
      "name": "Legal Review",
      "order": 3,
      "duration": { "days": 14, "canExtend": true, "maxExtensions": 1 },
      "gate": {
        "type": "manual",
        "conditions": [
          { "type": "consent", "approvers": ["legal_counsel"] }
        ]
      },
      "contextInheritance": { "fromPrevious": "full" }
    },
    {
      "id": "execution",
      "name": "Partnership Execution",
      "order": 4,
      "duration": { "days": 14, "canExtend": false },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "artifact", "artifact": { "type": "executed_agreement", "required": true } }
        ]
      },
      "contextInheritance": { "fromPrevious": "full" }
    }
  ],
  
  "transitions": [
    { "from": "exploration", "to": "terms", "autoTransition": false },
    { "from": "terms", "to": "legal", "autoTransition": true },
    { "from": "legal", "to": "execution", "autoTransition": false }
  ],
  
  "settings": {
    "allowParallelStages": false,
    "autoAdvance": false,
    "notifyOnTransition": true
  }
}
```

### 8.3 Template 3: Employment Offer

```json
{
  "id": "wf_employment_offer",
  "name": "Executive Employment Offer",
  "description": "Workflow for negotiating executive employment agreements",
  "category": "employment",
  "version": "1.0.0",
  
  "stages": [
    {
      "id": "offer",
      "name": "Initial Offer",
      "order": 1,
      "duration": { "days": 7, "canExtend": false },
      "gate": {
        "type": "manual",
        "conditions": [
          { "type": "consent", "approvers": ["candidate", "hiring_manager"] }
        ]
      },
      "contextInheritance": { "fromPrevious": "none" }
    },
    {
      "id": "negotiation",
      "name": "Offer Negotiation",
      "order": 2,
      "duration": { "days": 14, "canExtend": true, "maxExtensions": 2 },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "consensus", "consensus": { "threshold": "unanimous" } }
        ]
      },
      "contextInheritance": { "fromPrevious": "filtered" }
    },
    {
      "id": "background",
      "name": "Background Check & References",
      "order": 3,
      "duration": { "days": 10, "canExtend": false },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "artifact", "artifact": { "type": "background_check_clear", "required": true } }
        ]
      },
      "contextInheritance": { "fromPrevious": "none" }
    },
    {
      "id": "onboarding",
      "name": "Onboarding Preparation",
      "order": 4,
      "duration": { "days": 7, "canExtend": false },
      "gate": {
        "type": "automatic",
        "conditions": [
          { "type": "artifact", "artifact": { "type": "signed_offer_letter", "required": true } }
        ]
      },
      "contextInheritance": { "fromPrevious": "full" }
    }
  ],
  
  "transitions": [
    { "from": "offer", "to": "negotiation", "autoTransition": false },
    { "from": "negotiation", "to": "background", "autoTransition": true },
    { "from": "background", "to": "onboarding", "autoTransition": true }
  ],
  
  "settings": {
    "allowParallelStages": true,
    "autoAdvance": true,
    "notifyOnTransition": true
  }
}
```

---

## 9. Implementation Estimation

### 9.1 Effort Breakdown

| Component | Complexity | Est. LOC | Duration | Dependencies |
|-----------|------------|----------|----------|--------------|
| **Workflow Engine** | High | 2,500 | 2 weeks | Deal Room Core |
| **Workflow Templates** | Medium | 800 | 3 days | Workflow Engine |
| **Cross-Room Intelligence** | High | 2,200 | 2.5 weeks | SQLite, DP lib |
| **Pattern Detection** | Medium | 1,000 | 1 week | Intelligence |
| **Privacy Layer** | High | 1,500 | 1.5 weeks | Intelligence |
| **Enhanced Deal Rooms** | Medium | 1,800 | 1.5 weeks | Deal Room Core |
| **Version Control** | Medium | 900 | 1 week | Enhanced Rooms |
| **Collaboration** | High | 1,200 | 1.5 weeks | Enhanced Rooms |
| **Notifications** | Low | 600 | 4 days | Enhanced Rooms |
| **Integration Layer** | Medium | 800 | 5 days | All above |
| **Tests** | - | 2,500 | 1 week | All above |
| **Documentation** | - | - | 3 days | All above |

### 9.2 Total Estimation

| Metric | Value |
|--------|-------|
| **Total Lines of Code** | ~14,000 |
| **Calendar Duration** | 6-7 weeks |
| **Engineering Weeks** | 8 weeks |
| **Test Coverage Target** | 85%+ |
| **Documentation** | 5 documents |

### 9.3 Critical Path

```
Week 1-2: Workflow Engine + Templates
    │
    ▼
Week 2-3: Cross-Room Intelligence (parallel with Privacy Layer)
    │
    ▼
Week 4-5: Enhanced Deal Rooms + Version Control
    │
    ▼
Week 5-6: Collaboration + Notifications
    │
    ▼
Week 6-7: Integration + Testing + Documentation
```

### 9.4 Risk Factors

| Risk | Impact | Mitigation |
|------|--------|------------|
| Differential Privacy complexity | High | Use established library (Google DP lib) |
| CRDT implementation | Medium | Use existing library (Yjs or Automerge) |
| Privacy budget exhaustion | Medium | Implement budget monitoring, alerting |
| Cross-room data leaks | Critical | Comprehensive privacy audit before release |

---

## 10. Key Architectural Decisions

### ADR-001: Workflow State Machine
**Decision**: Use explicit state machine with gate conditions  
**Rationale**: Clear separation between orchestration logic and business rules  
**Alternative**: Event-driven choreography — rejected for complexity

### ADR-002: Context Passing Model
**Decision**: Filtered inheritance with explicit sanitize rules  
**Rationale**: Privacy by design, auditability of what flows where  
**Alternative**: Automatic inference — rejected for opacity

### ADR-003: Differential Privacy Strategy
**Decision**: ε ≤ 1.0 with per-query budget tracking  
**Rationale**: Balance utility and privacy, prevent budget exhaustion  
**Alternative**: Centralized anonymization — rejected for single point of failure

### ADR-004: Collaboration Architecture
**Decision**: CRDT-based (Yjs) for conflict-free collaboration  
**Rationale**: Proven technology, handles offline/online transitions  
**Alternative**: Operational Transform — rejected for complexity

### ADR-005: Pattern Storage
**Decision**: Structured tables with JSON flexibility  
**Rationale**: Queryable aggregates with extensible dimensions  
**Alternative**: Pure document store — rejected for analytical queries

---

## 11. Ready to Build Assessment

### Checklist

| Item | Status |
|------|--------|
| Architecture documented | ✅ |
| API contracts defined | ✅ |
| Data model specified | ✅ |
| Privacy boundaries explicit | ✅ |
| Sample templates provided | ✅ |
| Integration points mapped | ✅ |
| Effort estimated | ✅ |
| Risk factors identified | ✅ |
| ADRs drafted | ✅ |

### Recommendation

**Status**: ✅ **READY TO BUILD** with one caveat

The design is comprehensive and implementation-ready. Privacy safeguards are well-defined. The one area requiring extra attention is the **differential privacy implementation** — recommend using an established library (Google DP, OpenDP) rather than custom implementation.

### Immediate Next Steps

1. **Create GitHub issues** for each component
2. **Set up DP library** (OpenDP or Google DP) evaluation
3. **Create feature branch** `phase8-deal-room-evolution`
4. **Begin with Workflow Engine** (foundational dependency)

---

## Document Information

- **Author**: protocol-architect (Liz subagent)
- **Reviewers**: Woodhouse, Ray, Erik
- **Created**: 2026-04-26
- **Status**: Design Complete
- **Location**: `/projects/mesh-memory/DESIGN_PHASE8.md`
