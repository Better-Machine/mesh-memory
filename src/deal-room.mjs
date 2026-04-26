/**
 * @module deal-room
 * @description Room Lifecycle Management for Mesh Memory Protocol v2.0
 * Manages room states: PENDING_CONSENT → ACTIVE → CLOSED
 * 
 * Data model:
 * deal-rooms/
 *   <room-id>/
 *     manifest.json       # purpose, scope, policy, participants, state
 *     context.kgt.jsonl   # temporal knowledge graph (escrowed facts)
 *     decisions/          # consensus decisions
 *     audit/              # WORM logs with hash chaining
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createHash, randomUUID } from 'crypto';
import { loadConfig } from '../config.mjs';

// Config and paths
let config = null;
let DEAL_ROOMS_DIR = 'memory/deal-rooms';

// Room state enum
export const RoomState = {
  PENDING_CONSENT: 'PENDING_CONSENT',
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRED'
};

// Participant roles
export const ParticipantRole = {
  NEGOTIATOR: 'negotiator',   // Can propose, vote, write to context
  REVIEWER: 'reviewer',         // Can vote, review context
  OBSERVER: 'observer'          // Read-only access
};

/**
 * Initialize deal room system
 * @returns {Promise<void>}
 */
export async function initializeDealRooms() {
  config = loadConfig();
  
  const baseDir = config.memory?.baseDir || 'memory';
  DEAL_ROOMS_DIR = join(baseDir, 'deal-rooms');
  
  await fs.mkdir(DEAL_ROOMS_DIR, { recursive: true });
  console.log(`[deal-room] Initialized at ${DEAL_ROOMS_DIR}`);
}

/**
 * Generate a unique room ID
 * @returns {string} Room ID with dr_ prefix
 */
function generateRoomId() {
  const uuid = randomUUID().replace(/-/g, '').slice(0, 16);
  return `dr_${uuid}`;
}

/**
 * Calculate SHA-256 hash of an object
 * @param {Object} obj
 * @returns {string} Full SHA-256 hex hash
 */
function calculateHash(obj) {
  const data = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Get the path to a room's directory
 * @param {string} roomId
 * @returns {string} Full path
 */
function getRoomPath(roomId) {
  return join(DEAL_ROOMS_DIR, roomId);
}

/**
 * Ensure room directory structure exists
 * @param {string} roomId
 */
async function ensureRoomStructure(roomId) {
  const roomPath = getRoomPath(roomId);
  await fs.mkdir(join(roomPath, 'decisions'), { recursive: true });
  await fs.mkdir(join(roomPath, 'audit'), { recursive: true });
}

/**
 * Write audit log entry with hash chaining
 * @param {string} roomId
 * @param {string} event
 * @param {string} actor
 * @param {Object} details
 */
async function writeAuditLog(roomId, event, actor, details = {}) {
  const auditDir = join(getRoomPath(roomId), 'audit');
  await fs.mkdir(auditDir, { recursive: true });
  
  const timestamp = new Date().toISOString();
  
  // Get previous hash for chaining
  let previousHash = '0';
  let sequence = 1;
  
  try {
    const auditFiles = await fs.readdir(auditDir);
    const logFiles = auditFiles.filter(f => f.endsWith('.log')).sort();
    if (logFiles.length > 0) {
      const latestLog = logFiles[logFiles.length - 1];
      const logPath = join(auditDir, latestLog);
      const logContent = await fs.readFile(logPath, 'utf8');
      const lines = logContent.trim().split('\n').filter(l => l);
      
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        previousHash = lastEntry.hash;
        sequence = lastEntry.sequence + 1;
      }
    }
  } catch (err) {
    // No previous logs, starting fresh
  }
  
  // Build audit entry
  const entry = {
    sequence,
    timestamp,
    event,
    actor,
    details,
    previousHash
  };
  
  // Calculate hash
  entry.hash = calculateHash(entry);
  
  // Write to audit log (WORM - append only)
  const auditFile = `audit-${timestamp.slice(0, 10)}.log`;
  const auditPath = join(auditDir, auditFile);
  
  const line = JSON.stringify(entry) + '\n';
  await fs.appendFile(auditPath, line);
  
  return entry;
}

/**
 * Create a new deal room
 * @param {string} purpose - Room purpose/description
 * @param {Object} scope - Room scope {topics, documents, maxParticipants}
 * @param {Object} policy - Room policy {autoClose, consensusRequired, dataResidency, retentionDays}
 * @param {Array} proposedParticipants - Array of {agentId, role} objects
 * @param {string} creatorAgentId - Agent creating the room
 * @returns {Promise<Object>} Room manifest
 */
export async function createRoom(purpose, scope, policy, proposedParticipants, creatorAgentId) {
  if (!purpose || typeof purpose !== 'string') {
    throw new Error('Invalid purpose: must be a non-empty string');
  }
  
  if (!Array.isArray(proposedParticipants) || proposedParticipants.length === 0) {
    throw new Error('Invalid proposedParticipants: must be a non-empty array');
  }
  
  // Validate participant roles
  for (const participant of proposedParticipants) {
    if (!participant.agentId || typeof participant.agentId !== 'string') {
      throw new Error('Invalid participant: agentId is required');
    }
    if (!Object.values(ParticipantRole).includes(participant.role)) {
      throw new Error(`Invalid role: ${participant.role}. Must be one of: ${Object.values(ParticipantRole).join(', ')}`);
    }
  }
  
  const roomId = generateRoomId();
  const now = new Date().toISOString();
  
  // Default policy values
  const finalPolicy = {
    autoClose: policy?.autoClose || null,  // ISO timestamp
    consensusRequired: policy?.consensusRequired || 'unanimous',  // unanimous | majority
    dataResidency: policy?.dataResidency || 'us-east-1',
    retentionDays: policy?.retentionDays || 2555,  // 7 years default
    ...policy
  };
  
  // Build manifest
  const manifest = {
    roomId,
    purpose,
    scope: {
      topics: scope?.topics || [],
      documents: scope?.documents || [],
      maxParticipants: scope?.maxParticipants || 10,
      ...scope
    },
    policy: finalPolicy,
    state: RoomState.PENDING_CONSENT,
    createdAt: now,
    updatedAt: now,
    participants: [],
    pendingConsents: proposedParticipants.map(p => ({
      agentId: p.agentId,
      role: p.role,
      invitedAt: now,
      status: 'pending'
    }))
  };
  
  // Ensure directory structure
  await ensureRoomStructure(roomId);
  
  // Write manifest
  const manifestPath = join(getRoomPath(roomId), 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Initialize context.kgt.jsonl (empty)
  const contextPath = join(getRoomPath(roomId), 'context.kgt.jsonl');
  await fs.writeFile(contextPath, '');
  
  // Write audit log
  await writeAuditLog(roomId, 'ROOM_CREATED', creatorAgentId, {
    purpose,
    scope: manifest.scope,
    policy: finalPolicy,
    proposedParticipants: proposedParticipants.map(p => p.agentId)
  });
  
  console.log(`[deal-room] Created room ${roomId} with ${proposedParticipants.length} pending consents`);
  
  return {
    roomId,
    status: RoomState.PENDING_CONSENT,
    expiresAt: null,  // Could set based on policy
    manifest
  };
}

/**
 * Invite a participant to a room
 * @param {string} roomId
 * @param {string} agentId
 * @param {string} role - negotiator | reviewer | observer
 * @param {string} inviterAgentId - Agent sending the invite
 * @returns {Promise<Object>} Updated manifest
 */
export async function inviteParticipant(roomId, agentId, role, inviterAgentId) {
  const roomPath = getRoomPath(roomId);
  const manifestPath = join(roomPath, 'manifest.json');
  
  // Load current manifest
  let manifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(content);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);
  }
  
  // Validate room state
  if (manifest.state !== RoomState.PENDING_CONSENT && manifest.state !== RoomState.ACTIVE) {
    throw new Error(`Cannot invite to room in ${manifest.state} state`);
  }
  
  // Validate role
  if (!Object.values(ParticipantRole).includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  
  // Check if already participant
  if (manifest.participants.some(p => p.agentId === agentId)) {
    throw new Error(`Agent ${agentId} is already a participant`);
  }
  
  // Check if already pending
  if (manifest.pendingConsents?.some(p => p.agentId === agentId)) {
    throw new Error(`Agent ${agentId} already has a pending invitation`);
  }
  
  // Check max participants
  const currentCount = (manifest.participants?.length || 0) + (manifest.pendingConsents?.length || 0);
  if (currentCount >= manifest.scope.maxParticipants) {
    throw new Error(`Room has reached maximum participants (${manifest.scope.maxParticipants})`);
  }
  
  const now = new Date().toISOString();
  
  // Add to pending consents
  if (!manifest.pendingConsents) {
    manifest.pendingConsents = [];
  }
  
  manifest.pendingConsents.push({
    agentId,
    role,
    invitedAt: now,
    status: 'pending'
  });
  
  manifest.updatedAt = now;
  
  // Save manifest
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Write audit log
  await writeAuditLog(roomId, 'PARTICIPANT_INVITED', inviterAgentId, {
    invitedAgent: agentId,
    role
  });
  
  console.log(`[deal-room] Invited ${agentId} to room ${roomId} as ${role}`);
  
  return manifest;
}

/**
 * Process a consent response from a participant
 * @param {string} roomId
 * @param {string} agentId
 * @param {boolean} accepted - Whether consent was granted
 * @returns {Promise<Object>} Result with room state and manifest
 */
export async function processConsent(roomId, agentId, accepted) {
  const roomPath = getRoomPath(roomId);
  const manifestPath = join(roomPath, 'manifest.json');
  
  // Load current manifest
  let manifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(content);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);
  }
  
  // Check if in pending consents
  const consentIndex = manifest.pendingConsents?.findIndex(p => p.agentId === agentId);
  if (consentIndex === -1 || consentIndex === undefined) {
    throw new Error(`No pending invitation found for agent ${agentId}`);
  }
  
  const consent = manifest.pendingConsents[consentIndex];
  const now = new Date().toISOString();
  
  if (accepted) {
    // Move to participants
    consent.status = 'accepted';
    consent.acceptedAt = now;
    
    if (!manifest.participants) {
      manifest.participants = [];
    }
    
    manifest.participants.push({
      agentId,
      role: consent.role,
      joinedAt: now,
      status: 'active'
    });
    
    // Remove from pending consents
    manifest.pendingConsents.splice(consentIndex, 1);
    
    // Check if we should transition to ACTIVE
    if (manifest.pendingConsents.length === 0 && manifest.participants.length > 0) {
      const oldState = manifest.state;
      manifest.state = RoomState.ACTIVE;
      manifest.activatedAt = now;
      
      // Write transition audit log
      await writeAuditLog(roomId, 'ROOM_STATE_CHANGED', agentId, {
        from: oldState,
        to: RoomState.ACTIVE,
        reason: 'all_consents_received'
      });
    }
    
    // Write audit log
    await writeAuditLog(roomId, 'CONSENT_ACCEPTED', agentId, {
      role: consent.role
    });
    
    console.log(`[deal-room] ${agentId} accepted invitation to room ${roomId}`);
    
  } else {
    // Declined
    consent.status = 'declined';
    consent.declinedAt = now;
    
    // Remove from pending consents
    manifest.pendingConsents.splice(consentIndex, 1);
    
    // Write audit log
    await writeAuditLog(roomId, 'CONSENT_DECLINED', agentId, {
      role: consent.role
    });
    
    console.log(`[deal-room] ${agentId} declined invitation to room ${roomId}`);
  }
  
  manifest.updatedAt = now;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  return {
    roomId,
    state: manifest.state,
    accepted,
    manifest
  };
}

/**
 * Close a deal room
 * @param {string} roomId
 * @param {string} reason - Reason for closure
 * @param {string} closerAgentId - Agent closing the room
 * @returns {Promise<Object>} Result
 */
export async function closeRoom(roomId, reason, closerAgentId) {
  const roomPath = getRoomPath(roomId);
  const manifestPath = join(roomPath, 'manifest.json');
  
  // Load current manifest
  let manifest;
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(content);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);
  }
  
  // Validate room state
  if (manifest.state === RoomState.CLOSED) {
    throw new Error(`Room ${roomId} is already closed`);
  }
  
  if (manifest.state === RoomState.EXPIRED) {
    throw new Error(`Room ${roomId} has expired`);
  }
  
  const now = new Date().toISOString();
  const oldState = manifest.state;
  
  // Transition to CLOSED
  manifest.state = RoomState.CLOSED;
  manifest.closedAt = now;
  manifest.closedBy = closerAgentId;
  manifest.closeReason = reason;
  manifest.updatedAt = now;
  
  // Mark all participants as inactive
  if (manifest.participants) {
    manifest.participants = manifest.participants.map(p => ({
      ...p,
      status: 'inactive'
    }));
  }
  
  // Save manifest
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Write audit log
  await writeAuditLog(roomId, 'ROOM_CLOSED', closerAgentId, {
    from: oldState,
    to: RoomState.CLOSED,
    reason
  });
  
  // Notify all participants (in real implementation, would trigger A2A notifications)
  const notifiedParticipants = manifest.participants?.map(p => p.agentId) || [];
  
  console.log(`[deal-room] Closed room ${roomId}. Reason: ${reason}`);
  
  return {
    roomId,
    state: RoomState.CLOSED,
    reason,
    notifiedParticipants,
    manifest
  };
}

/**
 * Get room manifest
 * @param {string} roomId
 * @returns {Promise<Object>} Room manifest
 */
export async function getRoom(roomId) {
  const roomPath = getRoomPath(roomId);
  const manifestPath = join(roomPath, 'manifest.json');
  
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Room not found: ${roomId}`);
  }
}

/**
 * List all rooms
 * @param {Object} filters - Optional filters {state, agentId}
 * @returns {Promise<Array>} Array of room summaries
 */
export async function listRooms(filters = {}) {
  const rooms = [];
  
  try {
    const entries = await fs.readdir(DEAL_ROOMS_DIR);
    
    for (const entry of entries) {
      const roomPath = join(DEAL_ROOMS_DIR, entry);
      const stat = await fs.stat(roomPath);
      
      if (stat.isDirectory() && entry.startsWith('dr_')) {
        try {
          const manifestPath = join(roomPath, 'manifest.json');
          const content = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(content);
          
          // Apply filters
          if (filters.state && manifest.state !== filters.state) {
            continue;
          }
          
          if (filters.agentId) {
            const isParticipant = manifest.participants?.some(p => p.agentId === filters.agentId);
            const isPending = manifest.pendingConsents?.some(p => p.agentId === filters.agentId);
            if (!isParticipant && !isPending) {
              continue;
            }
          }
          
          // Add summary
          rooms.push({
            roomId: manifest.roomId,
            purpose: manifest.purpose,
            state: manifest.state,
            createdAt: manifest.createdAt,
            participantCount: manifest.participants?.length || 0,
            pendingConsentCount: manifest.pendingConsents?.length || 0
          });
        } catch (err) {
          // Skip invalid rooms
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist yet
  }
  
  return rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get room audit trail
 * @param {string} roomId
 * @param {Object} options - {startSequence, limit}
 * @returns {Promise<Array>} Audit entries
 */
export async function getAuditTrail(roomId, options = {}) {
  const auditDir = join(getRoomPath(roomId), 'audit');
  const entries = [];
  
  try {
    const files = await fs.readdir(auditDir);
    const logFiles = files.filter(f => f.endsWith('.log')).sort();
    
    for (const logFile of logFiles) {
      const logPath = join(auditDir, logFile);
      const content = await fs.readFile(logPath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);
        } catch (err) {
          // Skip malformed entries
        }
      }
    }
  } catch (err) {
    // No audit logs yet
  }
  
  // Sort by sequence
  entries.sort((a, b) => a.sequence - b.sequence);
  
  // Verify chain integrity
  let previousHash = '0';
  let verified = true;
  
  for (const entry of entries) {
    if (entry.previousHash !== previousHash) {
      entry.chainVerified = false;
      verified = false;
    } else {
      entry.chainVerified = true;
    }
    previousHash = entry.hash;
  }
  
  return {
    entries,
    verified,
    total: entries.length
  };
}

/**
 * Verify room integrity
 * @param {string} roomId
 * @returns {Promise<Object>} Verification result
 */
export async function verifyRoomIntegrity(roomId) {
  const roomPath = getRoomPath(roomId);
  
  try {
    // Check manifest exists
    const manifestPath = join(roomPath, 'manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    // Verify audit chain
    const auditResult = await getAuditTrail(roomId);
    
    return {
      roomId,
      exists: true,
      manifestValid: !!manifest.roomId,
      auditChainVerified: auditResult.verified,
      auditEntryCount: auditResult.total,
      state: manifest.state
    };
  } catch (err) {
    return {
      roomId,
      exists: false,
      error: err.message
    };
  }
}

// Export all functions
export default {
  initializeDealRooms,
  createRoom,
  inviteParticipant,
  processConsent,
  closeRoom,
  getRoom,
  listRooms,
  getAuditTrail,
  verifyRoomIntegrity,
  RoomState,
  ParticipantRole
};
