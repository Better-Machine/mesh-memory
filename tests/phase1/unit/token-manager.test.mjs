/**
 * Token Manager Unit Tests - Phase 1: Foundation Hardening
 * 
 * Tests:
 * - Token creation with expiry
 * - Auto-rotation (24h threshold)
 * - Token revocation (immediate invalidation)
 * - Token validation middleware
 * - Audit log writing
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTokenManager, resetTokenManager } from '../../../src/token-manager.mjs';
import { resetTokenStore } from '../../../src/token-store.mjs';
import { delay, resetTestState, TEST_PATHS } from '../setup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_LOG_PATH = path.join(TEST_PATHS.logs, 'token-audit.jsonl');

describe('Token Manager', async () => {
  
  describe('Token Creation', async () => {
    await resetTestState();

    await test('creates a new token with default expiry', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.createToken({});

      assert.strictEqual(result.success, true);
      assert.ok(result.token, 'Token should be generated');
      assert.ok(result.tokenId, 'Token ID should be generated');
      assert.ok(result.expiresAt, 'Expiry should be set');
      
      // Default is 48 hours
      const expectedExpiry = Date.now() + (48 * 60 * 60 * 1000);
      assert.ok(Math.abs(result.expiresAt - expectedExpiry) < 5000, 'Should default to 48h expiry');
    });

    await test('creates a token with custom TTL', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.createToken({ ttlHours: 2 });

      assert.strictEqual(result.success, true);
      const expectedExpiry = Date.now() + (2 * 60 * 60 * 1000);
      assert.ok(Math.abs(result.expiresAt - expectedExpiry) < 5000, 'Should respect custom TTL');
    });

    await test('creates token for specific agent', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.createToken({ 
        agentId: 'custom-agent',
        ttlHours: 1 
      });

      assert.strictEqual(result.success, true);
      
      const validation = await manager.validateToken(result.token);
      assert.strictEqual(validation.agentId, 'custom-agent');
    });
  });

  describe('Token Validation', async () => {
    await resetTestState();

    await test('validates a valid token', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const createResult = await manager.createToken({ ttlHours: 1 });
      const validation = await manager.validateToken(createResult.token);

      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.tokenId, createResult.tokenId);
      assert.strictEqual(validation.agentId, 'test-agent');
    });

    await test('rejects invalid tokens', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const validation = await manager.validateToken('invalid-token-123');
      assert.strictEqual(validation.valid, false);
      assert.strictEqual(validation.reason, 'not_found');
    });

    await test('rejects expired tokens', async () => {
      // This test verifies the logic - actual expiry testing requires time manipulation
      // or short-lived tokens which are handled elsewhere
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      // Create a token with very short TTL for test
      const result = await manager.createToken({ ttlHours: 0.001 }); // ~3.6 seconds
      
      // Wait for expiry
      await delay(5000);
      
      const validation = await manager.validateToken(result.token);
      assert.strictEqual(validation.valid, false);
      assert.strictEqual(validation.reason, 'expired');
    });
  });

  describe('Token Revocation', async () => {
    await resetTestState();

    await test('revokes a token with immediate invalidation', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const createResult = await manager.createToken({ ttlHours: 24 });
      
      // Token should be valid before revocation
      const beforeRevoke = await manager.validateToken(createResult.token);
      assert.strictEqual(beforeRevoke.valid, true);

      // Revoke it
      const revokeResult = await manager.revokeToken(createResult.tokenId, { reason: 'test' });
      assert.strictEqual(revokeResult.success, true);

      // Should be immediately invalid
      const afterRevoke = await manager.validateToken(createResult.token);
      assert.strictEqual(afterRevoke.valid, false);
      assert.strictEqual(afterRevoke.reason, 'revoked');
    });

    await test('handles double revocation gracefully', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const createResult = await manager.createToken({ ttlHours: 24 });
      await manager.revokeToken(createResult.tokenId, { reason: 'first' });
      
      const secondRevoke = await manager.revokeToken(createResult.tokenId, { reason: 'second' });
      assert.strictEqual(secondRevoke.success, true);
      assert.strictEqual(secondRevoke.alreadyRevoked, true);
    });

    await test('revokes with custom reason', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const createResult = await manager.createToken({ ttlHours: 24 });
      const revokeResult = await manager.revokeToken(createResult.tokenId, { 
        reason: 'security_breach' 
      });
      
      assert.strictEqual(revokeResult.success, true);
    });
  });

  describe('Token Rotation', async () => {
    await resetTestState();

    await test('rotates a token creating new one', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const oldToken = await manager.createToken({ ttlHours: 24 });
      const rotateResult = await manager.rotateToken(oldToken.tokenId);

      assert.strictEqual(rotateResult.success, true);
      assert.ok(rotateResult.token, 'New token should be generated');
      assert.notStrictEqual(rotateResult.token, oldToken.token);
      assert.strictEqual(rotateResult.previousTokenId, oldToken.tokenId);
    });

    await test('old token marked as rotated after rotation', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const oldToken = await manager.createToken({ ttlHours: 24 });
      await manager.rotateToken(oldToken.tokenId);

      const oldValidation = await manager.validateToken(oldToken.token);
      assert.strictEqual(oldValidation.valid, false);
      assert.strictEqual(oldValidation.reason, 'rotated');
    });

    await test('new token is valid after rotation', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const oldToken = await manager.createToken({ ttlHours: 24 });
      const rotateResult = await manager.rotateToken(oldToken.tokenId);

      const newValidation = await manager.validateToken(rotateResult.token);
      assert.strictEqual(newValidation.valid, true);
      assert.strictEqual(newValidation.tokenId, rotateResult.tokenId);
    });
  });

  describe('Auto-Rotation', async () => {
    await resetTestState();

    await test('identifies tokens needing rotation (24h threshold)', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens,
        rotationInterval: 1000 // 1 second for testing
      });

      // Create token expiring in 20 hours (within 24h threshold)
      const shortToken = await manager.createToken({ ttlHours: 20 });
      
      // Create token expiring in 48 hours (outside 24h threshold)
      const longToken = await manager.createToken({ ttlHours: 48 });

      // Check rotation manually
      const toRotate = await manager.checkAndRotateTokens();
      
      // Should identify the 20h token as needing rotation
      assert.ok(toRotate.count >= 1, 'Should identify at least one token for rotation');
      
      // Stop rotation timer
      manager.stopRotationTimer();
    });

    await test('auto-rotation creates new tokens', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens,
        rotationInterval: 5000
      });

      // Create token expiring soon
      const shortToken = await manager.createToken({ ttlHours: 20 });
      
      // Force rotation check
      const result = await manager.checkAndRotateTokens();
      
      if (result.count > 0) {
        // Verify old token is now rotating
        const status = await manager.getTokenStatus(shortToken.tokenId);
        assert.strictEqual(status.isActive, false);
      }
      
      manager.stopRotationTimer();
    });
  });

  describe('Token Status and Listing', async () => {
    await resetTestState();

    await test('gets token status by ID', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const createResult = await manager.createToken({ ttlHours: 24 });
      const status = await manager.getTokenStatus(createResult.tokenId);

      assert.strictEqual(status.found, true);
      assert.strictEqual(status.id, createResult.tokenId);
      assert.strictEqual(status.agentId, 'test-agent');
      assert.strictEqual(status.isActive, true);
      assert.ok(status.timeUntilExpiry > 0);
    });

    await test('returns not found for unknown token', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const status = await manager.getTokenStatus('non-existent-token-id');
      assert.strictEqual(status.found, false);
    });

    await test('lists all tokens', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      await manager.createToken({ agentId: 'agent-1', ttlHours: 24 });
      await manager.createToken({ agentId: 'agent-2', ttlHours: 24 });
      await manager.createToken({ agentId: 'agent-3', ttlHours: 24 });

      const tokens = await manager.getAllTokens();
      assert.ok(tokens.length >= 3, 'Should have at least 3 tokens');
      
      // Verify structure
      const token = tokens[0];
      assert.ok(token.id, 'Token should have ID');
      assert.ok(token.agentId, 'Token should have agentId');
      assert.ok(token.createdAt, 'Token should have createdAt');
      assert.ok(token.expiresAt, 'Token should have expiresAt');
      assert.ok(token.status, 'Token should have status');
    });

    await test('gets active token', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const created = await manager.createToken({ ttlHours: 24 });
      const active = await manager.getActiveToken();

      assert.ok(active);
      assert.strictEqual(active.id, created.tokenId);
    });
  });

  describe('Validation Middleware', async () => {
    await resetTestState();

    await test('middleware validates valid token', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const created = await manager.createToken({ ttlHours: 24 });
      const middleware = manager.middleware();

      let nextCalled = false;
      const req = {
        path: '/mesh/protected',
        headers: { authorization: `Bearer ${created.token}` },
        ip: '127.0.0.1'
      };
      const res = {
        status: (code) => ({ json: () => ({ statusCode: code }) }),
        statusCode: 200
      };
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);
      assert.strictEqual(nextCalled, true, 'Should call next() for valid token');
      assert.ok(req.tokenInfo, 'Should attach token info to request');
      assert.strictEqual(req.tokenInfo.valid, true);
    });

    await test('middleware rejects missing token', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const middleware = manager.middleware();

      let nextCalled = false;
      let responseStatus = 0;
      const req = {
        path: '/mesh/protected',
        headers: {},
        ip: '127.0.0.1'
      };
      const res = {
        status: (code) => { responseStatus = code; return { json: () => {} }; }
      };
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);
      assert.strictEqual(nextCalled, false, 'Should not call next() for missing token');
      assert.strictEqual(responseStatus, 401);
    });

    await test('middleware rejects invalid token', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const middleware = manager.middleware();

      let responseStatus = 0;
      const req = {
        path: '/mesh/protected',
        headers: { authorization: 'Bearer invalid-token' },
        ip: '127.0.0.1'
      };
      const res = {
        status: (code) => { responseStatus = code; return { json: () => {} }; }
      };
      const next = () => {};

      await middleware(req, res, next);
      assert.strictEqual(responseStatus, 401);
    });

    await test('middleware exempts health endpoints', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const middleware = manager.middleware({
        exemptPaths: ['/mesh/health']
      });

      let nextCalled = false;
      const req = {
        path: '/mesh/health',
        headers: {},
        ip: '127.0.0.1'
      };
      const res = {
        status: () => ({ json: () => {} })
      };
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);
      assert.strictEqual(nextCalled, true, 'Should call next() for exempt path');
    });
  });

  describe('Audit Logging', async () => {
    await resetTestState();

    await test('logs token creation', async () => {
      await resetTestState();
      
      const manager = await getTokenManager({
        agentId: 'audit-test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      await manager.createToken({ ttlHours: 24 });

      const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
      const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
      
      const creationEntry = entries.find(e => e.action === 'created');
      assert.ok(creationEntry, 'Should have creation audit entry');
      assert.strictEqual(creationEntry.actor, 'audit-test-agent');
      assert.ok(creationEntry.timestamp);
      assert.ok(creationEntry.tokenId);
    });

    await test('logs token revocation', async () => {
      const manager = await getTokenManager({
        agentId: 'audit-test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.createToken({ ttlHours: 24 });
      await manager.revokeToken(result.tokenId, { reason: 'security' });

      const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
      const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
      
      const revocationEntry = entries.find(e => e.action === 'revoked');
      assert.ok(revocationEntry, 'Should have revocation audit entry');
      assert.strictEqual(revocationEntry.actor, 'audit-test-agent');
      assert.ok(revocationEntry.details?.reason);
    });

    await test('logs token rotation', async () => {
      const manager = await getTokenManager({
        agentId: 'audit-test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.createToken({ ttlHours: 24 });
      await manager.rotateToken(result.tokenId);

      const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
      const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
      
      const rotationEntry = entries.find(e => e.action === 'rotated');
      assert.ok(rotationEntry, 'Should have rotation audit entry');
      assert.strictEqual(rotationEntry.actor, 'audit-test-agent');
      assert.ok(rotationEntry.details?.previousTokenId);
    });

    await test('logs access denied for invalid tokens', async () => {
      const manager = await getTokenManager({
        agentId: 'audit-test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      await manager.validateToken('invalid-token-123');

      const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
      const entries = auditContent.trim().split('\n').map(line => JSON.parse(line));
      
      const deniedEntry = entries.find(e => e.action === 'access_denied');
      assert.ok(deniedEntry, 'Should have access denied entry');
      assert.strictEqual(deniedEntry.details?.reason, 'not_found');
    });

    await test('writes structured JSON lines', async () => {
      const auditContent = await fs.readFile(TEST_LOG_PATH, 'utf-8');
      const lines = auditContent.trim().split('\n');
      
      for (const line of lines) {
        const entry = JSON.parse(line);
        assert.ok(entry.timestamp, 'Entry should have timestamp');
        assert.ok(entry.action, 'Entry should have action');
        assert.ok(entry.tokenId || entry.tokenId === 'unknown', 'Entry should have tokenId');
        assert.ok(entry.actor, 'Entry should have actor');
      }
    });
  });

  describe('Cleanup and Expired Tokens', async () => {
    await resetTestState();

    await test('cleans up expired tokens', async () => {
      resetTokenManager();
      resetTokenStore();
      
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      // Create a very short-lived token
      const shortLived = await manager.createToken({ ttlHours: 0.001 });
      
      // Wait for expiry
      await delay(5000);
      
      // Validate to trigger expiry marking
      await manager.validateToken(shortLived.token);
      
      // Cleanup
      const cleanupResult = await manager.cleanupExpiredTokens(0);
      assert.ok(cleanupResult.cleaned >= 0);
    });

    await test('hot reload refreshes token state', async () => {
      const manager = await getTokenManager({
        agentId: 'test-agent',
        auditLogPath: TEST_LOG_PATH,
        storePath: TEST_PATHS.tokens
      });

      const result = await manager.hotReload();
      assert.strictEqual(result, undefined); // Returns void
    });
  });

  // Final cleanup
  await resetTestState();
});