#!/usr/bin/env node
/**
 * Token Cleanup - Emergency Retention Policy
 * Removes expired tokens older than retention period
 * Run: node token-cleanup.mjs [--dry-run]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_STORE_PATH = process.env.MESH_TOKEN_STORE_PATH || 
  path.join(process.env.HOME, '.openclaw/workspace/projects/mesh-memory/.tokens');

// Retention: 7 days for expired tokens
const RETENTION_DAYS = 7;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

async function cleanupTokens(dryRun = false) {
  const now = Date.now();
  let deleted = 0;
  let kept = 0;
  let errors = 0;
  
  console.log(`[token-cleanup] Scanning ${TOKEN_STORE_PATH}...`);
  console.log(`[token-cleanup] Retention: ${RETENTION_DAYS} days for expired tokens`);
  
  if (dryRun) {
    console.log('[token-cleanup] DRY RUN - no files will be deleted');
  }
  
  try {
    const files = await fs.readdir(TOKEN_STORE_PATH);
    const tokenFiles = files.filter(f => f.endsWith('.enc'));
    
    console.log(`[token-cleanup] Found ${tokenFiles.length} token files`);
    
    for (const file of tokenFiles) {
      const filePath = path.join(TOKEN_STORE_PATH, file);
      
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtime.getTime();
        
        // Read token to check expiry
        let isExpired = false;
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const token = JSON.parse(content);
          if (token.expiresAt && token.expiresAt < now) {
            isExpired = true;
          }
        } catch (err) {
          // Corrupt file - treat as expired
          isExpired = true;
        }
        
        if (isExpired && age > RETENTION_MS) {
          if (!dryRun) {
            await fs.unlink(filePath);
          }
          deleted++;
          if (deleted % 1000 === 0) {
            console.log(`[token-cleanup] ${dryRun ? 'Would delete' : 'Deleted'} ${deleted} files...`);
          }
        } else {
          kept++;
        }
      } catch (err) {
        errors++;
      }
    }
    
    console.log(`[token-cleanup] Complete: ${deleted} deleted, ${kept} kept, ${errors} errors`);
    return { deleted, kept, errors };
    
  } catch (err) {
    console.error('[token-cleanup] Error:', err.message);
    throw err;
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  cleanupTokens(dryRun).then(result => {
    process.exit(0);
  }).catch(err => {
    process.exit(1);
  });
}

export { cleanupTokens };
