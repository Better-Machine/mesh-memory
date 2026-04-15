/**
 * Token Manager Tests - Phase 1: Foundation Hardening
 * 
 * Tests:
 * - Token creation
 * - Token rotation
 * - Token revocation
 * - Token validation
 * - Auto-rotation behavior
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTokenManager, resetTokenManager } from '../../src/token-manager.mjs';
import { resetTokenStore } from '../../src/token-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_LOG_PATH = path.join(__dirname, '..', '.test-logs', 'token-audit.jsonl');
const TEST_TOKEN_PATH = path.join(__dirname, '..', '.test-tokens');

async function cleanup() {
  try {
    await fs.rm(TEST_LOG_PATH, { force: true });
    await fs.rm(TEST_TOKEN_PATH, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
  resetTokenManager();
  resetTokenStore();
}

describe('Token Manager', async () => {
  await cleanup();

  await test('creates a new token', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    const result = await manager.createToken({
      ttlHours: 1
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.token, 'Token should be generated');
    assert.ok(result.tokenId, 'Token ID should be generated');
    assert.ok(result.expiresAt, 'Expiry should be set');
  });

  await test('validates a token', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    // Create a token first
    const createResult = await manager.createToken({ ttlHours: 1 });
    assert.ok(createResult.success);

    // Validate it
    const validation = await manager.validateToken(createResult.token);

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.tokenId, createResult.tokenId);
    assert.strictEqual(validation.agentId, 'test-agent');
  });

  await test('rejects invalid tokens', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    const validation = await manager.validateToken('invalid-token-123');

    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.reason, 'not_found');
  });

  await test('revokes a token', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    // Create and revoke
    const createResult = await manager.createToken({ ttlHours: 1 });
    const revokeResult = await manager.revokeToken(createResult.tokenId, { reason: 'test' });

    assert.strictEqual(revokeResult.success, true);

    // Validation should fail
    const validation = await manager.validateToken(createResult.token);
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.reason, 'revoked');
  });

  await test('rotates a token', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    // Create and rotate
    const createResult = await manager.createToken({ ttlHours: 1 });
    const rotateResult = await manager.rotateToken(createResult.tokenId);

    assert.strictEqual(rotateResult.success, true);
    assert.ok(rotateResult.token, 'New token should be generated');
    assert.strictEqual(rotateResult.previousTokenId, createResult.tokenId);

    // Old token should be invalid (in rotating state)
    const oldValidation = await manager.validateToken(createResult.token);
    assert.strictEqual(oldValidation.valid, false);
    assert.strictEqual(oldValidation.reason, 'rotated');
  });

  await test('gets token status', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    const createResult = await manager.createToken({ ttlHours: 1 });
    const status = await manager.getTokenStatus(createResult.tokenId);

    assert.strictEqual(status.found, true);
    assert.strictEqual(status.id, createResult.tokenId);
    assert.strictEqual(status.agentId, 'test-agent');
    assert.strictEqual(status.isActive, true);
  });

  await test('lists all tokens', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    // Clean slate
    await cleanup();
    const freshManager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    await freshManager.createToken({ ttlHours: 1 });
    await freshManager.createToken({ ttlHours: 2 });

    const tokens = await freshManager.getAllTokens();
    assert.ok(tokens.length >= 2, 'Should have at least 2 tokens');
  });

  await cleanup();
});

describe('Token Audit Logging', async () => {
  await cleanup();

  await test('logs token creation', async () => {
    await cleanup();
    
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    await manager.createToken({ ttlHours: 1 });

    // Check audit log
    const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
    const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
    
    const creationEntry = entries.find(e => e.action === 'created');
    assert.ok(creationEntry, 'Should have creation audit entry');
    assert.strictEqual(creationEntry.actor, 'test-agent');
  });

  await test('logs token revocation', async () => {
    const manager = await getTokenManager({
      agentId: 'test-agent',
      auditLogPath: TEST_LOG_PATH,
      storePath: TEST_TOKEN_PATH
    });

    const result = await manager.createToken({ ttlHours: 1 });
    await manager.revokeToken(result.tokenId, { reason: 'security' });

    const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
    const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
    
    const revocationEntry = entries.find(e => e.action === 'revoked');
    assert.ok(revocationEntry, 'Should have revocation audit entry');
  });

  await cleanup();
});
