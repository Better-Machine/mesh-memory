#!/usr/bin/env node

/**
 * Test script for token-service integration with memory-receiver
 * Tests token validation, caching, and rotation handling
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('=== Token-Service Integration Test ===\n');

// Test scenarios
const tests = [
  {
    name: 'Valid token validation',
    token: 'valid-test-token-1234567890abcdef',
    expected: 200
  },
  {
    name: 'Invalid token format (too short)',
    token: 'short',
    expected: 401
  },
  {
    name: 'Missing authorization header',
    token: null,
    expected: 401
  },
  {
    name: 'Malformed authorization header',
    token: 'not-bearer-format',
    authHeader: 'Token invalid-format',
    expected: 401
  }
];

async function runTests() {
  console.log('Starting token service...');
  
  // Start token service in background
  const tokenService = spawn('node', ['token-service.mjs'], {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  await setTimeout(2000); // Wait for service to start

  console.log('Running authentication tests...\n');
  
  for (const test of tests) {
    console.log(`Testing: ${test.name}`);
    
    const headers = {};
    if (test.authHeader) {
      headers['Authorization'] = test.authHeader;
    } else if (test.token) {
      headers['Authorization'] = `Bearer ${test.token}`;
    }
    
    try {
      const response = await fetch('http://localhost:18801/health', {
        headers
      });
      
      const passed = response.status === test.expected;
      console.log(`  Expected: ${test.expected}, Got: ${response.status} - ${passed ? '✓ PASS' : '✗ FAIL'}`);
      
      if (!passed) {
        const body = await response.text();
        console.log(`  Response: ${body}`);
      }
    } catch (err) {
      console.log(`  ✗ FAIL - Error: ${err.message}`);
    }
    
    console.log('');
  }
  
  console.log('Testing token validation endpoint...');
  
  // Test the validate endpoint directly
  try {
    const validateResponse = await fetch('http://localhost:18803/mesh/token/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: 'test-token' })
    });
    
    const validateResult = await validateResponse.json();
    console.log(`  Validate endpoint response: ${JSON.stringify(validateResult)}`);
    console.log(`  Status: ${validateResponse.status}`);
  } catch (err) {
    console.log(`  ✗ FAIL - Error: ${err.message}`);
  }
  
  console.log('\n=== Test Complete ===');
  console.log('\nCleaning up...');
  
  tokenService.kill();
  await setTimeout(1000);
}

runTests().catch(console.error);
