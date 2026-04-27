/**
 * Identity Passport Module
 * 
 * Sovereign agent identity for mesh-memory.
 * Implements portable, cryptographically-verifiable agent identity
 * per IDENTITY_ARCHITECTURE.md v0.1.0.
 * 
 * @module identity-passport
 */

import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const SCHEMA_VERSION = '0.1.0';

/**
 * Agent Passport - Immutable identity root
 */
export class AgentPassport {
  #privateKey = null; // Never serialized, never logged
  
  constructor(data = {}) {
    this.passportId = data.passportId || randomUUID();
    this.agentName = data.agentName || 'unnamed-agent';
    this.agentType = data.agentType || 'secondary';
    this.publicKey = data.publicKey || null;
    this.keyFingerprint = data.keyFingerprint || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.createdBy = data.createdBy || 'unknown';
    this.genesisNode = data.genesisNode || 'unknown';
    this.schemaVersion = data.schemaVersion || SCHEMA_VERSION;
    this.passportVersion = data.passportVersion || 1;
    this.metadata = data.metadata || {};
    this.keyHistory = data.keyHistory || [];
    this.attestations = data.attestations || [];
    
    // Load private key if provided (only for active passports)
    if (data._privateKey) {
      this.#privateKey = data._privateKey;
    }
  }

  /**
   * Generate a new passport with fresh Ed25519 keypair
   */
  static async generate(options = {}) {
    const { agentName, agentType = 'secondary', createdBy, genesisNode, metadata = {} } = options;
    
    if (!agentName) {
      throw new Error('agentName is required');
    }
    
    // Generate Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });
    
    const publicKeyB64 = publicKey.toString('base64');
    const fingerprint = crypto.createHash('sha256')
      .update(publicKey)
      .digest('hex');
    
    const passport = new AgentPassport({
      agentName,
      agentType,
      publicKey: publicKeyB64,
      keyFingerprint: fingerprint,
      createdBy: createdBy || 'self',
      genesisNode: genesisNode || 'local',
      metadata,
      _privateKey: privateKey.toString('base64')
    });
    
    // Add genesis attestation
    await passport.addAttestation({
      type: 'genesis',
      issuer: createdBy || 'self',
      issuerType: 'human',
      payload: {
        creationPurpose: metadata.description || 'Agent creation',
        initialCapabilities: []
      }
    });
    
    return passport;
  }

  /**
   * Load passport from file (with private key from secure storage)
   */
  static async load(passportPath, privateKeyPath = null) {
    const data = JSON.parse(await readFile(passportPath, 'utf-8'));
    
    // Load private key if available
    let privateKey = null;
    if (privateKeyPath && existsSync(privateKeyPath)) {
      privateKey = await readFile(privateKeyPath, 'base64');
    }
    
    return new AgentPassport({
      ...data,
      _privateKey: privateKey
    });
  }

  /**
   * Serialize passport (public data only - safe for sharing)
   */
  toJSON() {
    return {
      passportId: this.passportId,
      agentName: this.agentName,
      agentType: this.agentType,
      publicKey: this.publicKey,
      keyFingerprint: this.keyFingerprint,
      createdAt: this.createdAt,
      createdBy: this.createdBy,
      genesisNode: this.genesisNode,
      schemaVersion: this.schemaVersion,
      passportVersion: this.passportVersion,
      metadata: this.metadata,
      keyHistory: this.keyHistory,
      attestations: this.attestations
    };
  }

  /**
   * Check if passport has signing capability (private key loaded)
   */
  get canSign() {
    return this.#privateKey !== null;
  }

  /**
   * Sign data with this passport's private key
   * Uses Node.js crypto with Ed25519
   */
  sign(data) {
    if (!this.canSign) {
      throw new Error('Cannot sign: private key not loaded');
    }
    
    const message = typeof data === 'string' 
      ? Buffer.from(data, 'utf-8')
      : Buffer.from(JSON.stringify(data), 'utf-8');
    
    // Parse the private key from PKCS8 DER format
    const privateKeyDER = Buffer.from(this.#privateKey, 'base64');
    const privateKeyObject = crypto.createPrivateKey({
      key: privateKeyDER,
      format: 'der',
      type: 'pkcs8'
    });
    
    const signature = crypto.sign(null, message, privateKeyObject);
    return signature.toString('base64');
  }

  /**
   * Verify data signed by this passport
   */
  verify(data, signature) {
    const message = typeof data === 'string'
      ? Buffer.from(data, 'utf-8')
      : Buffer.from(JSON.stringify(data), 'utf-8');
    
    // Parse the public key from SPKI DER format
    const publicKeyDER = Buffer.from(this.publicKey, 'base64');
    const publicKeyObject = crypto.createPublicKey({
      key: publicKeyDER,
      format: 'der',
      type: 'spki'
    });
    
    const signatureBuffer = Buffer.from(signature, 'base64');
    return crypto.verify(null, message, publicKeyObject, signatureBuffer);
  }

  /**
   * Add an attestation to this passport
   */
  async addAttestation(options) {
    const { type, issuer, issuerType = 'agent', payload = {} } = options;
    
    if (!this.canSign && issuerType === 'agent') {
      throw new Error('Cannot create attestation: private key not loaded');
    }
    
    const attestation = {
      type,
      issuer,
      issuerType,
      issuedAt: new Date().toISOString(),
      subject: {
        passportId: this.passportId,
        passportVersion: this.passportVersion,
        keyFingerprint: this.keyFingerprint
      },
      payload,
      algorithm: 'Ed25519'
    };
    
    // Sign attestation if we're the issuing agent
    if (issuerType === 'agent' && this.canSign) {
      attestation.signature = this.sign(attestation);
    }
    
    this.attestations.push(attestation);
    return attestation;
  }

  /**
   * Verify an attestation's signature
   */
  verifyAttestation(attestation) {
    if (!attestation.signature) {
      return { valid: false, reason: 'No signature present' };
    }
    
    if (attestation.subject.keyFingerprint !== this.keyFingerprint) {
      // Check key history
      const historicalKey = this.keyHistory.find(
        k => k.fingerprint === attestation.subject.keyFingerprint
      );
      if (!historicalKey) {
        return { valid: false, reason: 'Key fingerprint mismatch and not in history' };
      }
    }
    
    try {
      const { signature, ...payload } = attestation;
      const isValid = this.verify(payload, signature);
      return { valid: isValid, reason: isValid ? 'Signature valid' : 'Invalid signature' };
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Create migration attestation for moving to new hardware
   */
  async createMigrationAttestation(targetNode, authorizedBy) {
    return this.addAttestation({
      type: 'migration',
      issuer: this.passportId,
      issuerType: 'agent',
      payload: {
        sourceNode: this.genesisNode, // Or last known location
        targetNode,
        authorizedBy,
        migrationReason: 'Hardware transition'
      }
    });
  }

  /**
   * Save passport to file system
   */
  async save(passportPath, privateKeyPath = null) {
    // Ensure directory exists
    await mkdir(dirname(passportPath), { recursive: true });
    
    // Save public passport
    await writeFile(
      passportPath,
      JSON.stringify(this.toJSON(), null, 2),
      'utf-8'
    );
    
    // Save private key separately if path provided
    if (privateKeyPath && this.#privateKey) {
      await mkdir(dirname(privateKeyPath), { recursive: true });
      await writeFile(privateKeyPath, this.#privateKey, { encoding: 'base64', mode: 0o600 });
    }
  }

  /**
   * Get default paths for this agent
   */
  static getDefaultPaths(agentName) {
    const openclawDir = join(homedir(), '.openclaw');
    return {
      passport: join(openclawDir, 'passport.json'),
      privateKey: join(openclawDir, '.passport.key'),
      meshRegistry: join(process.cwd(), 'passports', `${agentName}.json`)
    };
  }
}

/**
 * Passport Registry - Manages multiple agent passports in mesh context
 */
export class PassportRegistry {
  constructor(registryPath) {
    this.registryPath = registryPath;
    this.passports = new Map();
  }

  /**
   * Load all passports from registry directory
   */
  async load() {
    if (!existsSync(this.registryPath)) {
      return;
    }
    
    // TODO: Implement directory scanning
  }

  /**
   * Register a passport in the mesh registry
   */
  async register(passport) {
    const publicPassport = passport.toJSON();
    const path = join(this.registryPath, `${passport.agentName}.json`);
    
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(publicPassport, null, 2), 'utf-8');
    
    this.passports.set(passport.passportId, publicPassport);
  }

  /**
   * Get passport by agent name
   */
  async getByName(agentName) {
    const path = join(this.registryPath, `${agentName}.json`);
    if (!existsSync(path)) {
      return null;
    }
    
    const data = JSON.parse(await readFile(path, 'utf-8'));
    return new AgentPassport(data);
  }

  /**
   * Verify peer identity against registry
   */
  async verifyPeer(passportId, publicKey) {
    const passport = this.passports.get(passportId);
    if (!passport) {
      return { valid: false, reason: 'Passport not in registry' };
    }
    
    if (passport.keyFingerprint !== publicKey) {
      return { valid: false, reason: 'Public key mismatch' };
    }
    
    // Verify genesis attestation exists
    const genesisAttestation = passport.attestations.find(a => a.type === 'genesis');
    if (!genesisAttestation) {
      return { valid: false, reason: 'No genesis attestation' };
    }
    
    return { valid: true, passport };
  }
}

export default { AgentPassport, PassportRegistry };
