-- Mesh-Memory Queue Persistence Schema
-- Phase 1: Foundation Hardening

-- Outbound queue for failed A2A messages
CREATE TABLE IF NOT EXISTS outbound_queue (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_attempt_at INTEGER,
    peer_id TEXT NOT NULL,
    endpoint TEXT NOT NULL
);

-- Dead-letter queue for permanent failures
CREATE TABLE IF NOT EXISTS dlq (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    failed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    peer_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    last_error TEXT,
    context TEXT
);

-- Queue metrics tracking
CREATE TABLE IF NOT EXISTS queue_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at INTEGER NOT NULL,
    queue_depth INTEGER NOT NULL DEFAULT 0,
    oldest_message_age INTEGER DEFAULT 0,
    error_rate REAL DEFAULT 0.0,
    processed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    dlq_count INTEGER DEFAULT 0
);

-- Token management tables
CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    rotated_at INTEGER,
    revoked_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotating', 'revoked', 'expired'))
);

-- Token audit log
CREATE TABLE IF NOT EXISTS token_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    token_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'rotated', 'revoked', 'validated', 'expired', 'access_granted', 'access_denied')),
    actor TEXT NOT NULL,
    details TEXT,
    ip_address TEXT
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_outbound_queue_next_retry ON outbound_queue(next_retry);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_peer_id ON outbound_queue(peer_id);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_created_at ON outbound_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON dlq(failed_at);
CREATE INDEX IF NOT EXISTS idx_token_audit_timestamp ON token_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_token_audit_token_id ON token_audit(token_id);
CREATE INDEX IF NOT EXISTS idx_tokens_agent_id ON tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens(expires_at);