/**
 * Mesh-Memory Integration API TypeScript Definitions
 * 
 * @version 1.0.0
 * @module mesh-memory/api
 * 
 * This file provides complete TypeScript definitions for the OpenClaw
 * to mesh-memory integration interface.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unique identifier for an agent in the mesh
 * @example "liz", "ray", "woodhouse"
 */
export type AgentId = string;

/**
 * Unique identifier for a node in the mesh
 * @example "node_liz_001"
 */
export type NodeId = string;

/**
 * UUID for threads, messages, and entries
 * @example "550e8400-e29b-41d4-a716-446655440000"
 */
export type UUID = string;

/**
 * ISO 8601 timestamp string
 * @example "2026-04-13T10:30:00.000Z"
 */
export type ISOTimestamp = string;

/**
 * Vector clock for distributed consistency
 * Maps agent IDs to their logical timestamps
 */
export interface VectorClock {
  [agentId: string]: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Agent References
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reference to an agent in the mesh
 */
export interface AgentReference {
  /** Agent identifier */
  agentId: AgentId;
  /** Node identifier */
  nodeId: NodeId;
  /** Base URL for agent endpoints */
  url: string;
  /** Agent capabilities */
  capabilities: MeshCapability[];
}

/**
 * Extended agent identity with public key
 */
export interface AgentIdentity extends AgentReference {
  /** Ed25519 public key (optional for future) */
  publicKey?: string;
}

/**
 * Mesh capabilities an agent can possess
 */
export type MeshCapability =
  | 'read'
  | 'write'
  | 'sync'
  | 'admin'
  | 'thread:participate'
  | 'thread:moderate'
  | 'forward';

// ═══════════════════════════════════════════════════════════════════════════
// A2A Message Schema (v1.0.0 Compatible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A2A Protocol message
 */
export interface A2AMessage {
  /** Protocol version */
  protocol: 'a2a/1.0.0';
  /** Unique message identifier */
  messageId: UUID;
  /** Message timestamp */
  timestamp: ISOTimestamp;
  /** Sending agent */
  sender: AgentIdentity;
  /** Recipient agent */
  recipient: AgentIdentity;
  /** Message type */
  type: 'task' | 'response' | 'notification' | 'error';
  /** Message payload */
  payload: TaskPayload | ResponsePayload | NotificationPayload | ErrorPayload;
  /** Optional cryptographic signature */
  signature?: string;
}

/**
 * Task request payload
 */
export interface TaskPayload {
  /** Unique task identifier */
  taskId: UUID;
  /** Task type/category */
  type: string;
  /** Task parameters */
  parameters: Record<string, unknown>;
  /** Task priority */
  priority: 'critical' | 'high' | 'normal' | 'low';
  /** Optional deadline */
  deadline?: ISOTimestamp;
}

/**
 * Task response payload
 */
export interface ResponsePayload {
  /** Task ID being responded to */
  taskId: UUID;
  /** Response status */
  status: 'success' | 'partial' | 'failure';
  /** Result data (if successful) */
  result?: unknown;
  /** Error details (if failed) */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Performance metrics */
  metrics?: {
    durationMs: number;
    tokensUsed?: number;
  };
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  /** Notification category */
  category: 'thread_update' | 'sync_complete' | 'trust_alert' | 'system';
  /** Severity level */
  severity: 'info' | 'warning' | 'critical';
  /** Human-readable message */
  message: string;
  /** Additional structured data */
  data?: unknown;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Request that caused the error */
  requestId?: UUID;
  /** Retryable flag */
  recoverable: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plugin Entry Points (OpenClaw → Mesh)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Delivery status for sent messages
 */
export interface DeliveryStatus {
  /** Delivery outcome */
  status: 'delivered' | 'queued' | 'failed';
  /** Message identifier */
  messageId: UUID;
  /** Delivery timestamp */
  timestamp: ISOTimestamp;
  /** Peer verification results */
  peerVerification: PeerVerification;
  /** Retry attempt number (if applicable) */
  retryAttempt?: number;
  /** Error details (if failed) */
  error?: DeliveryError;
}

/**
 * Peer verification results
 */
export interface PeerVerification {
  /** A2A gateway reachable (L1) */
  l1Health: boolean;
  /** Mesh receiver reachable (L2) */
  l2Health: boolean;
  /** Trust score (0.0 - 1.0) */
  trustScore: number;
}

/**
 * Delivery error details
 */
export interface DeliveryError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Whether error is recoverable via retry */
  recoverable: boolean;
}

/**
 * Send a message to a peer agent
 * @param peerId - Target agent ID
 * @param message - A2A-compatible message
 * @returns Promise resolving to delivery status
 */
export function sendMessage(
  peerId: AgentId,
  message: A2AMessage
): Promise<DeliveryStatus>;

// ═══════════════════════════════════════════════════════════════════════════
// Thread Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thread query options
 */
export interface ThreadQueryOptions {
  /** Consistency level */
  consistency?: 'eventual' | 'strong';
  /** Include full history */
  includeHistory?: boolean;
  /** Maximum entries to return */
  maxEntries?: number;
  /** Pagination cursor */
  cursor?: string;
}

/**
 * Thread state representation
 */
export interface ThreadState {
  /** Thread identifier */
  threadId: UUID;
  /** Thread status */
  status: 'active' | 'closed' | 'archived';
  /** Creation timestamp */
  createdAt: ISOTimestamp;
  /** Last update timestamp */
  updatedAt: ISOTimestamp;
  /** Participating agents */
  participants: AgentReference[];
  /** Thread entries */
  entries: ThreadEntry[];
  /** Current consensus state */
  consensusState?: ConsensusState;
  /** Thread metadata */
  metadata: ThreadMetadata;
  /** Next page cursor for pagination */
  nextCursor?: string;
}

/**
 * Thread entry
 */
export interface ThreadEntry {
  /** Entry identifier */
  entryId: UUID;
  /** Author agent ID */
  agentId: AgentId;
  /** Entry type */
  type: 'message' | 'proposal' | 'correction' | 'fact';
  /** Entry content */
  content: string;
  /** Entry timestamp */
  timestamp: ISOTimestamp;
  /** Vector clock for ordering */
  vectorClock: VectorClock;
  /** Optional tags */
  tags?: string[];
}

/**
 * Consensus state for a thread
 */
export interface ConsensusState {
  /** Pending proposals awaiting confirmation */
  pendingProposals: Proposal[];
  /** Agreed-upon facts */
  agreedFacts: FactEntry[];
  /** Active conflicts */
  conflicts: Conflict[];
}

/**
 * Thread metadata
 */
export interface ThreadMetadata {
  /** Thread title */
  title?: string;
  /** Thread category */
  category?: string;
  /** Custom properties */
  properties: Record<string, unknown>;
}

/**
 * Proposal for thread consensus
 */
export interface Proposal {
  /** Proposal identifier */
  proposalId: UUID;
  /** Proposal type */
  type: 'fact' | 'interpretation' | 'thread_close';
  /** Proposal content */
  content: string;
  /** Agent who proposed */
  proposedBy: AgentId;
  /** Proposal timestamp */
  proposedAt: ISOTimestamp;
  /** Expiration timestamp */
  expiresAt: ISOTimestamp;
  /** Agent responses */
  responses: ProposalResponse[];
  /** Current status */
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

/**
 * Response to a proposal
 */
export interface ProposalResponse {
  /** Responding agent */
  agentId: AgentId;
  /** Response type */
  response: 'accept' | 'reject' | 'abstain';
  /** Optional reason */
  reason?: string;
  /** Response timestamp */
  timestamp: ISOTimestamp;
}

/**
 * Conflict in thread
 */
export interface Conflict {
  /** Conflict identifier */
  conflictId: UUID;
  /** Entry IDs in conflict */
  entryIds: UUID[];
  /** Conflict description */
  description: string;
  /** Resolution strategy */
  resolutionStrategy: 'last_write_wins' | 'merge' | 'human_resolve';
  /** Agent who resolved (if resolved) */
  resolvedBy?: AgentId;
  /** Resolution content */
  resolution?: string;
}

/**
 * Retrieve thread state
 * @param threadId - Thread identifier
 * @param options - Query options
 * @returns Promise resolving to thread state
 */
export function getThread(
  threadId: UUID,
  options?: ThreadQueryOptions
): Promise<ThreadState>;

// ═══════════════════════════════════════════════════════════════════════════
// Memory Search
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search options
 */
export interface SearchOptions {
  /** Memory tier to search */
  tier?: 'critical' | 'recent' | 'archived';
  /** Filter by agent IDs */
  agentFilter?: AgentId[];
  /** Time range filter */
  timeRange?: {
    from?: ISOTimestamp;
    to?: ISOTimestamp;
  };
  /** Filter by entry types */
  typeFilter?: ('fact' | 'interpretation' | 'message' | 'lesson')[];
  /** Apply bias-resistance filtering */
  biasResistant?: boolean;
  /** Maximum results to return */
  maxResults?: number;
  /** Minimum confidence threshold (0.0 - 1.0) */
  minConfidence?: number;
}

/**
 * Search results
 */
export interface SearchResults {
  /** Matching entries */
  entries: MemoryEntry[];
  /** Total entries found */
  totalFound: number;
  /** Query execution time */
  queryTimeMs: number;
  /** Bias score (lower is better) */
  biasScore: number;
  /** Unique sources in results */
  sources: AgentReference[];
}

/**
 * Memory entry (unified)
 */
export interface MemoryEntry {
  /** Entry identifier */
  entryId: UUID;
  /** Entry type */
  type: 'fact' | 'interpretation' | 'message' | 'lesson';
  /** Entry content */
  content: string;
  /** Author agent ID */
  agentId: AgentId;
  /** Entry timestamp */
  timestamp: ISOTimestamp;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Provenance information */
  provenance: Provenance;
  /** Optional tags */
  tags?: string[];
}

/**
 * Provenance metadata
 */
export interface Provenance {
  /** Source of the entry */
  source: string;
  /** Original timestamp */
  timestamp: ISOTimestamp;
  /** Method of acquisition */
  method: 'direct' | 'sync' | 'inference';
  /** Receipt ID for verification */
  receiptId?: string;
}

/**
 * Search memory
 * @param query - Search query
 * @param options - Search options
 * @returns Promise resolving to search results
 */
export function searchMemory(
  query: string,
  options?: SearchOptions
): Promise<SearchResults>;

// ═══════════════════════════════════════════════════════════════════════════
// Memory Writes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fact value types
 */
export type FactValue = string | object | number | boolean;

/**
 * Fact metadata
 */
export interface FactMetadata {
  /** Fact category */
  category: string;
  /** Fact source */
  source: string;
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Optional expiration time */
  expiresAt?: ISOTimestamp;
  /** Optional tags */
  tags?: string[];
  /** Whether confirmation is required from peers */
  requiresConfirmation?: boolean;
}

/**
 * Write confirmation
 */
export interface WriteConfirmation {
  /** Receipt identifier */
  receiptId: string;
  /** Entry identifier */
  entryId: UUID;
  /** Confirmation timestamp */
  timestamp: ISOTimestamp;
  /** Durability level */
  durability: 'fsync_confirmed' | 'acknowledged' | 'pending';
  /** Nodes that confirmed */
  confirmedNodes: NodeId[];
  /** Sync status across peers */
  syncStatus: SyncStatus;
}

/**
 * Sync status
 */
export interface SyncStatus {
  /** Peers awaiting confirmation */
  pendingPeers: AgentId[];
  /** Peers that confirmed */
  confirmedPeers: AgentId[];
  /** Peers that failed to sync */
  failedPeers: AgentId[];
}

/**
 * Write a fact to mesh memory
 * @param key - Fact key/identifier
 * @param value - Fact value
 * @param metadata - Fact metadata
 * @returns Promise resolving to write confirmation
 */
export function writeFact(
  key: string,
  value: FactValue,
  metadata: FactMetadata
): Promise<WriteConfirmation>;

/**
 * Interpretation value
 */
export interface InterpretationValue {
  /** Interpretation content */
  content: string;
  /** References to supporting facts */
  basis: UUID[];
  /** Confidence level (0.0 - 1.0) */
  confidence: number;
  /** Alternative interpretations acknowledged */
  alternativeViews?: AlternativeView[];
}

/**
 * Alternative view
 */
export interface AlternativeView {
  /** Agent ID of alternative */
  agentId: AgentId;
  /** Alternative content */
  content: string;
  /** Alternative confidence */
  confidence: number;
}

/**
 * Write an interpretation to mesh memory
 * @param key - Interpretation key
 * @param value - Interpretation value
 * @param agentId - Agent providing the interpretation
 * @returns Promise resolving to write confirmation
 */
export function writeInterpretation(
  key: string,
  value: InterpretationValue,
  agentId: AgentId
): Promise<WriteConfirmation>;

// ═══════════════════════════════════════════════════════════════════════════
// Event Callbacks (Mesh → OpenClaw)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Incoming message from peer
 */
export interface IncomingMessage {
  /** Message identifier */
  messageId: UUID;
  /** Sending agent */
  from: AgentReference;
  /** Recipient (this agent) */
  to: AgentId;
  /** Message content */
  content: string;
  /** Message type */
  type: 'task' | 'query' | 'notification' | 'consensus';
  /** Thread ID (if applicable) */
  threadId?: UUID;
  /** Message timestamp */
  timestamp: ISOTimestamp;
  /** Message priority */
  priority: 'high' | 'normal' | 'low';
  /** Whether acknowledgment is required */
  requiresAck: boolean;
  /** Message metadata */
  metadata: MessageMetadata;
}

/**
 * Message metadata
 */
export interface MessageMetadata {
  /** Distributed trace ID */
  traceId: string;
  /** Original source channel */
  sourceChannel?: string;
  /** Original timestamp before relay */
  originalTimestamp?: ISOTimestamp;
}

/**
 * Callback: Message received from mesh
 * @param message - Incoming message
 */
export function onMeshMessageReceived(
  message: IncomingMessage
): void | Promise<void>;

/**
 * Thread update notification
 */
export interface ThreadUpdate {
  /** Type of update */
  updateType: 'new_entry' | 'proposal' | 'consensus_reached' | 'conflict_detected' | 'closed';
  /** New entry (if applicable) */
  entry?: ThreadEntry;
  /** Proposal (if applicable) */
  proposal?: Proposal;
  /** Conflict (if applicable) */
  conflict?: Conflict;
  /** Update timestamp */
  timestamp: ISOTimestamp;
  /** Agent that made the change */
  actor: AgentId;
}

/**
 * Callback: Thread updated
 * @param threadId - Thread identifier
 * @param update - Update details
 */
export function onThreadUpdate(
  threadId: UUID,
  update: ThreadUpdate
): void | Promise<void>;

/**
 * Sync result
 */
export interface SyncResult {
  /** Sync operation ID */
  syncId: UUID;
  /** Sync status */
  status: 'success' | 'partial' | 'failed';
  /** Peer that was synced with */
  peerId: AgentId;
  /** Entries synced */
  entriesSynced: number;
  /** Conflicts found */
  conflictsFound: number;
  /** Conflicts resolved */
  conflictsResolved: number;
  /** New facts discovered */
  newFacts: UUID[];
  /** New interpretations discovered */
  newInterpretations: UUID[];
  /** Errors encountered */
  errors: SyncError[];
  /** Operation duration */
  durationMs: number;
}

/**
 * Sync error
 */
export interface SyncError {
  /** Entry ID (if applicable) */
  entryId?: UUID;
  /** Error code */
  errorCode: string;
  /** Error message */
  message: string;
  /** Whether error is recoverable */
  recoverable: boolean;
}

/**
 * Callback: Memory sync completed
 * @param syncId - Sync operation ID
 * @param result - Sync result
 */
export function onMemorySyncCompleted(
  syncId: UUID,
  result: SyncResult
): void | Promise<void>;

// ═══════════════════════════════════════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Whether to add jitter */
  jitter: boolean;
}

/**
 * Mesh error codes
 */
export type MeshErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'SYNC_CONFLICT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'IDENTITY_MISMATCH'
  | 'CIRCUIT_OPEN'
  | 'DEGRADED_MODE';

/**
 * Mesh error
 */
export interface MeshError extends Error {
  /** Error code */
  code: MeshErrorCode;
  /** HTTP status code (if applicable) */
  statusCode?: number;
  /** Whether error is retryable */
  retryable: boolean;
  /** Retry after milliseconds (if applicable) */
  retryAfterMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Circuit Breaker
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreaker {
  /** Peer ID */
  peerId: AgentId;
  /** Current state */
  state: CircuitState;
  /** Current failure count */
  failureCount: number;
  /** Current success count (half-open) */
  successCount: number;
  /** Last failure timestamp */
  lastFailureTime?: ISOTimestamp;
  /** Last success timestamp */
  lastSuccessTime?: ISOTimestamp;
  /** Threshold to open circuit */
  failureThreshold: number;
  /** Threshold to close circuit */
  successThreshold: number;
  /** Timeout before half-open */
  timeoutMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Authentication
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mesh token structure
 */
export interface MeshToken {
  /** Token header */
  header: {
    /** Algorithm */
    alg: 'HS256';
    /** Token type */
    typ: 'mesh+jwt';
    /** Key ID */
    kid: string;
  };
  /** Token payload */
  payload: {
    /** Subject (agent ID) */
    sub: AgentId;
    /** Issuer (node ID) */
    iss: NodeId;
    /** Issued at (epoch seconds) */
    iat: number;
    /** Expires at (epoch seconds) */
    exp: number;
    /** Mesh-specific claims */
    mesh: {
      /** Node identifier */
      nodeId: NodeId;
      /** Granted capabilities */
      capabilities: MeshCapability[];
      /** Rate limit (requests per hour) */
      rateLimit: number;
    };
  };
  /** Token signature */
  signature: string;
}

/**
 * Forwarded message structure
 */
export interface ForwardedMessage {
  /** Original message */
  originalMessage: A2AMessage;
  /** Relay agent ID */
  forwardedBy: AgentId;
  /** Forward timestamp */
  forwardedAt: ISOTimestamp;
  /** Original sender's token */
  originalToken: string;
  /** Relay agent's token */
  relayToken: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Memory Entry Schemas (Detailed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base memory entry
 */
export interface BaseMemoryEntry {
  /** Entry identifier */
  entryId: UUID;
  /** Entry timestamp */
  timestamp: ISOTimestamp;
  /** Author agent ID */
  agentId: AgentId;
  /** Receipt identifier */
  receiptId: string;
  /** Vector clock */
  vectorClock: VectorClock;
}

/**
 * Fact entry - verified, bias-resistant
 */
export interface FactEntry extends BaseMemoryEntry {
  /** Entry type */
  type: 'fact';
  /** Fact key */
  key: string;
  /** Fact value */
  value: unknown;
  /** Fact category */
  category: string;
  /** Confidence level */
  confidence: number;
  /** Number of confirmations */
  confirmationCount: number;
  /** Agents that confirmed */
  confirmedBy: AgentId[];
  /** Provenance */
  provenance: Provenance;
  /** Time-to-live in seconds */
  ttl?: number;
}

/**
 * Interpretation entry - agent-specific view
 */
export interface InterpretationEntry extends BaseMemoryEntry {
  /** Entry type */
  type: 'interpretation';
  /** Interpretation key */
  key: string;
  /** Interpretation content */
  content: string;
  /** References to supporting facts */
  basis: UUID[];
  /** Confidence level */
  confidence: number;
  /** Alternative interpretations */
  alternatives: AlternativeView[];
  /** Computed bias score (higher = more biased) */
  biasScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Thread Manifest
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thread manifest
 */
export interface ThreadManifest {
  /** Thread identifier */
  threadId: UUID;
  /** Manifest version */
  version: number;
  /** Creation timestamp */
  createdAt: ISOTimestamp;
  /** Creator agent ID */
  createdBy: AgentId;
  /** Thread status */
  status: 'active' | 'frozen' | 'closed' | 'archived';
  /** Participants */
  participants: AgentReference[];
  /** Thread permissions */
  permissions: ThreadPermissions;
  /** Consensus rules */
  consensusRules: ConsensusRules;
}

/**
 * Thread permissions
 */
export interface ThreadPermissions {
  /** Agents with read access */
  canRead: AgentId[];
  /** Agents with write access */
  canWrite: AgentId[];
  /** Agents with moderation access */
  canModerate: AgentId[];
  /** Agents who can invite others */
  canInvite: AgentId[];
}

/**
 * Consensus rules
 */
export interface ConsensusRules {
  /** Whether confirmation is required */
  requireConfirmation: boolean;
  /** Minimum agents needed for confirmation */
  confirmationThreshold: number;
  /** Proposal timeout in milliseconds */
  timeoutMs: number;
  /** Auto-close on consensus reached */
  autoCloseOnConsensus: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mesh configuration
 */
export interface MeshConfig {
  /** Agent identity */
  agent: {
    agentId: AgentId;
    nodeId: NodeId;
  };
  /** Security settings */
  security: {
    sharedSecret: string;
    tokenTtlHours: number;
  };
  /** Endpoint configuration */
  endpoints: {
    receiverPort: number;
    receiverBind: string;
    healthCheckIntervalMs: number;
  };
  /** Retry configuration */
  retry: RetryPolicy;
  /** Circuit breaker configuration */
  circuitBreaker: {
    failureThreshold: number;
    successThreshold: number;
    timeoutMs: number;
  };
  /** Peer configuration */
  peers: PeerConfig[];
}

/**
 * Peer configuration
 */
export interface PeerConfig {
  /** Peer agent ID */
  agentId: AgentId;
  /** Peer URL */
  url: string;
  /** Authentication token */
  token: string;
}

/**
 * Degraded mode configuration
 */
export interface DegradedModeConfig {
  /** Whether degraded mode is enabled */
  enabled: boolean;
  /** Use only local memory */
  localOnly: boolean;
  /** Queue writes for later sync */
  asyncSync: boolean;
  /** Accept eventual consistency only */
  reducedConsistency: boolean;
  /** Alert after N degraded operations */
  alertThreshold: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plugin Manifest
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Plugin entry point definition
 */
export interface PluginEntryPoint {
  /** Entry point name */
  name: string;
  /** Path to handler */
  path: string;
}

/**
 * Plugin callback definition
 */
export interface PluginCallback {
  /** Callback name */
  name: string;
  /** Path to callback handler */
  path: string;
}

/**
 * Plugin manifest
 */
export interface PluginManifest {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Entry points */
  entryPoints: PluginEntryPoint[];
  /** Callbacks */
  callbacks: PluginCallback[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Re-exports
// ═══════════════════════════════════════════════════════════════════════════

export * from './mesh-api';
