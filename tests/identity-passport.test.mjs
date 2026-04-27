/**
 * Identity Passport Tests
 * 
 * Tests for sovereign agent identity implementation.
 * Uses Node.js built-in test runner.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'fs';
import { readFile, unlink, rmdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentPassport, PassportRegistry } from '../src/identity-passport.mjs';

const testDir = join(tmpdir(), 'identity-test-' + Date.now());

describe('AgentPassport', () => {
  before(async () => {
    await mkdir(testDir, { recursive: true });
  });
  
  after(async () => {
    // Cleanup
    try {
      const files = ['passport.json', '.passport.key'];
      for (const f of files) {
        const path = join(testDir, f);
        if (existsSync(path)) await unlink(path);
      }
      await rmdir(testDir, { recursive: true });
    } catch {}
  });

  describe('Generation', () => {
    it('should generate a new passport with valid properties', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent',
        agentType: 'primary',
        createdBy: 'TestHuman',
        genesisNode: 'test-node',
        metadata: {
          displayName: 'Test Agent',
          emoji: '🧪'
        }
      });

      assert.strictEqual(passport.agentName, 'TestAgent');
      assert.strictEqual(passport.agentType, 'primary');
      assert.strictEqual(passport.createdBy, 'TestHuman');
      assert.strictEqual(passport.genesisNode, 'test-node');
      assert.ok(passport.passportId, 'passportId should be defined');
      assert.ok(passport.publicKey, 'publicKey should be defined');
      assert.ok(passport.keyFingerprint, 'keyFingerprint should be defined');
      assert.strictEqual(passport.passportVersion, 1);
      assert.strictEqual(passport.canSign, true);
    });

    it('should require agent name', async () => {
      try {
        await AgentPassport.generate({});
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error.message.includes('agentName'));
      }
    });

    it('should add genesis attestation on creation', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent',
        createdBy: 'Human'
      });

      assert.strictEqual(passport.attestations.length, 1);
      assert.strictEqual(passport.attestations[0].type, 'genesis');
      assert.strictEqual(passport.attestations[0].subject.passportId, passport.passportId);
    });
  });

  describe('Serialization', () => {
    it('should serialize without private key', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent'
      });

      const serialized = passport.toJSON();
      
      assert.strictEqual(serialized.passportId, passport.passportId);
      assert.strictEqual(serialized.agentName, 'TestAgent');
      assert.strictEqual(serialized._privateKey, undefined);
      assert.strictEqual(serialized.privateKey, undefined);
    });
  });

  describe('Signing & Verification', () => {
    it('should sign and verify data', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'Signer'
      });

      const message = { test: 'data', timestamp: Date.now() };
      const signature = passport.sign(message);
      
      assert.ok(signature, 'signature should be defined');
      assert.strictEqual(typeof signature, 'string');
      
      const isValid = passport.verify(message, signature);
      assert.strictEqual(isValid, true);
    });

    it('should reject tampered data', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'Signer'
      });

      const message = { test: 'original' };
      const signature = passport.sign(message);
      
      const tampered = { test: 'modified' };
      const isValid = passport.verify(tampered, signature);
      assert.strictEqual(isValid, false);
    });

    it('should throw when signing without private key', async () => {
      // Create passport without private key
      const passportPath = join(testDir, 'passport.json');
      const pkPath = join(testDir, '.passport.key');
      
      const original = await AgentPassport.generate({
        agentName: 'Original'
      });
      await original.save(passportPath, pkPath);

      // Load without private key
      const loaded = await AgentPassport.load(passportPath);
      
      assert.strictEqual(loaded.canSign, false);
      assert.throws(() => loaded.sign('test'), /Cannot sign/);
    });
  });

  describe('Attestations', () => {
    it('should create and verify attestation', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent'
      });

      const attestation = await passport.addAttestation({
        type: 'trust',
        issuer: passport.passportId,
        issuerType: 'agent',
        payload: { trustLevel: 0.9 }
      });

      assert.strictEqual(attestation.type, 'trust');
      assert.strictEqual(attestation.issuer, passport.passportId);
      assert.ok(attestation.signature, 'signature should be defined');
      assert.strictEqual(attestation.payload.trustLevel, 0.9);

      const verification = passport.verifyAttestation(attestation);
      assert.strictEqual(verification.valid, true);
    });

    it('should create migration attestation', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent'
      });

      const attestation = await passport.createMigrationAttestation(
        'new-node-01',
        'HumanAdmin'
      );

      assert.strictEqual(attestation.type, 'migration');
      assert.strictEqual(attestation.payload.targetNode, 'new-node-01');
      assert.strictEqual(attestation.payload.authorizedBy, 'HumanAdmin');
    });
  });

  describe('Persistence', () => {
    it('should save and load passport', async () => {
      const passportPath = join(testDir, 'passport.json');
      const pkPath = join(testDir, '.passport.key');

      const original = await AgentPassport.generate({
        agentName: 'PersistentAgent',
        metadata: { emoji: '📋' }
      });

      await original.save(passportPath, pkPath);

      // Verify files exist
      assert.ok(existsSync(passportPath), 'passport file should exist');
      assert.ok(existsSync(pkPath), 'private key file should exist');

      // Load with private key
      const loaded = await AgentPassport.load(passportPath, pkPath);
      
      assert.strictEqual(loaded.agentName, 'PersistentAgent');
      assert.strictEqual(loaded.passportId, original.passportId);
      assert.strictEqual(loaded.publicKey, original.publicKey);
      assert.strictEqual(loaded.canSign, true);

      // Load without private key
      const publicOnly = await AgentPassport.load(passportPath);
      assert.strictEqual(publicOnly.agentName, 'PersistentAgent');
      assert.strictEqual(publicOnly.canSign, false);
    });
  });

  describe('Key Fingerprint', () => {
    it('should have consistent fingerprint format', async () => {
      const passport = await AgentPassport.generate({
        agentName: 'TestAgent'
      });

      assert.ok(/^[a-f0-9]{64}$/.test(passport.keyFingerprint), 'fingerprint should be 64 hex chars');
    });
  });
});

describe('PassportRegistry', () => {
  const registryDir = join(tmpdir(), 'registry-test-' + Date.now());
  
  before(async () => {
    await mkdir(registryDir, { recursive: true });
  });
  
  after(async () => {
    // Cleanup
    try {
      await rmdir(registryDir, { recursive: true });
    } catch {}
  });

  it('should register and retrieve passport', async () => {
    const registry = new PassportRegistry(registryDir);
    
    const passport = await AgentPassport.generate({
      agentName: 'RegisteredAgent'
    });

    await registry.register(passport);

    const retrieved = await registry.getByName('RegisteredAgent');
    assert.ok(retrieved, 'retrieved should be defined');
    assert.strictEqual(retrieved.agentName, 'RegisteredAgent');
    assert.strictEqual(retrieved.passportId, passport.passportId);
  });

  it('should return null for unknown agent', async () => {
    const registry = new PassportRegistry(registryDir);
    
    const retrieved = await registry.getByName('NonExistent');
    assert.strictEqual(retrieved, null);
  });

  it('should verify peer identity', async () => {
    const registry = new PassportRegistry(registryDir);
    
    const passport = await AgentPassport.generate({
      agentName: 'PeerAgent'
    });

    await registry.register(passport);

    // Add passport to registry map manually for test
    registry.passports.set(passport.passportId, passport.toJSON());

    const verification = await registry.verifyPeer(
      passport.passportId,
      passport.keyFingerprint
    );

    assert.strictEqual(verification.valid, true);
    assert.ok(verification.passport, 'passport should be returned');
  });

  it('should reject unknown peer', async () => {
    const registry = new PassportRegistry(registryDir);
    
    const verification = await registry.verifyPeer(
      'unknown-id',
      'some-fingerprint'
    );

    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.reason, 'Passport not in registry');
  });

  it('should reject fingerprint mismatch', async () => {
    const registry = new PassportRegistry(registryDir);
    
    const passport = await AgentPassport.generate({
      agentName: 'PeerAgent'
    });

    await registry.register(passport);
    registry.passports.set(passport.passportId, passport.toJSON());

    const verification = await registry.verifyPeer(
      passport.passportId,
      'wrong-fingerprint-'.padEnd(64, '0')
    );

    assert.strictEqual(verification.valid, false);
    assert.strictEqual(verification.reason, 'Public key mismatch');
  });
});
