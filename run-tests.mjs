#!/usr/bin/env node
/**
 * Test Runner for mesh-memory Palace MVP (P1-P5)
 * Runs all test suites and generates a pass/fail summary
 * Exit code 0 = all pass, non-zero = failures
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test files configuration
const TEST_SUITES = [
  {
    name: 'Critical Facts Loader (Unit Tests)',
    file: 'tests/critical-facts-loader.test.mjs',
    type: 'unit'
  },
  {
    name: 'Tunnel Publisher (Integration Tests)',
    file: 'tests/tunnel-publisher.integration.test.mjs',
    type: 'integration'
  },
  {
    name: 'A2A Palace Adapter (E2E Tests)',
    file: 'tests/a2a-palace-adapter.e2e.test.mjs',
    type: 'e2e'
  }
];

// Color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function colorize(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(color, message));
}

function logHeader(title) {
  console.log('');
  console.log(colorize('bold', '='.repeat(60)));
  console.log(colorize('cyan', `  ${title}`));
  console.log(colorize('bold', '='.repeat(60)));
}

function logSection(title) {
  console.log('');
  console.log(colorize('blue', `▶ ${title}`));
  console.log(colorize('blue', '-'.repeat(50)));
}

// Run a single test file
async function runTest(testConfig) {
  const testPath = path.join(__dirname, testConfig.file);
  
  if (!existsSync(testPath)) {
    return {
      name: testConfig.name,
      status: 'MISSING',
      exitCode: -1,
      output: `Test file not found: ${testPath}`
    };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn('node', ['--test', testPath], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      const duration = Date.now() - startTime;
      resolve({
        name: testConfig.name,
        type: testConfig.type,
        status: exitCode === 0 ? 'PASS' : 'FAIL',
        exitCode,
        duration,
        output: stdout + stderr
      });
    });

    child.on('error', (err) => {
      resolve({
        name: testConfig.name,
        type: testConfig.type,
        status: 'ERROR',
        exitCode: -1,
        duration: Date.now() - startTime,
        output: err.message
      });
    });
  });
}

// Parse test output to extract pass/fail counts
function parseTestResults(output) {
  const lines = output.split('\n');
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const line of lines) {
    // Look for patterns like "✔ test name" or test pass indicators
    if (line.includes('✓') || line.includes('ok') || line.includes('PASS') || line.includes('# pass')) {
      // Try to extract count
      const match = line.match(/(\d+)\s*(tests?|passed|ok)/i);
      if (match) {
        passed = parseInt(match[1], 10);
      }
    }
    if (line.includes('✗') || line.includes('FAIL') || line.includes('# fail')) {
      const match = line.match(/(\d+)\s*(failed|FAIL)/i);
      if (match) {
        failed = parseInt(match[1], 10);
      }
    }
  }

  return { passed, failed, skipped };
}

// Main execution
async function main() {
  logHeader('mesh-memory Palace MVP Test Suite');
  console.log('');
  console.log('Testing P1-P5 components:');
  console.log('  • L0 Identity (agent-passport.json)');
  console.log('  • L1 Critical Facts (SQLite)');
  console.log('  • L2 Deep Memory (FTS5 search)');
  console.log('  • Tunnel Protocol (fact transport)');
  console.log('  • A2A Adapter (protocol bridge)');
  console.log('');
  console.log(colorize('yellow', 'Started: ') + new Date().toISOString());
  console.log('');

  const results = [];
  const startTime = Date.now();

  // Run each test suite
  for (const test of TEST_SUITES) {
    logSection(test.name);
    console.log(`  File: ${test.file}`);
    console.log(`  Type: ${test.type.toUpperCase()}`);
    
    const result = await runTest(test);
    results.push(result);

    const statusColor = result.status === 'PASS' ? 'green' : 
                        result.status === 'FAIL' ? 'red' : 'yellow';
    console.log(`  Status: ${colorize(statusColor, result.status)} (${result.duration}ms)`);
    
    if (result.output) {
      // Show relevant output lines
      const lines = result.output.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        console.log('  Output:');
        lines.slice(-10).forEach(line => {
          console.log(`    ${line}`);
        });
      }
    }
  }

  // Summary
  const totalTime = Date.now() - startTime;
  
  logHeader('Test Summary');

  // Group by type
  const byType = {
    unit: results.filter(r => r.type === 'unit'),
    integration: results.filter(r => r.type === 'integration'),
    e2e: results.filter(r => r.type === 'e2e')
  };

  console.log('');
  console.log(colorize('bold', 'By Test Type:'));
  console.log('');
  
  for (const [type, typeResults] of Object.entries(byType)) {
    const passed = typeResults.filter(r => r.status === 'PASS').length;
    const total = typeResults.length;
    const color = passed === total ? 'green' : passed > 0 ? 'yellow' : 'red';
    console.log(`  ${type.toUpperCase().padEnd(12)} ${colorize(color, `${passed}/${total} passed`)}`);
  }

  console.log('');
  console.log(colorize('bold', 'Detailed Results:'));
  console.log('');

  const passedTests = results.filter(r => r.status === 'PASS');
  const failedTests = results.filter(r => r.status !== 'PASS');

  // Passed tests
  if (passedTests.length > 0) {
    console.log(colorize('green', `✓ Passed (${passedTests.length}):`));
    passedTests.forEach(r => {
      console.log(`    ${colorize('green', '✓')} ${r.name} (${r.duration}ms)`);
    });
  }

  // Failed tests
  if (failedTests.length > 0) {
    console.log('');
    console.log(colorize('red', `✗ Failed/Error (${failedTests.length}):`));
    failedTests.forEach(r => {
      console.log(`    ${colorize('red', '✗')} ${r.name} - ${r.status}`);
      if (r.exitCode !== undefined && r.exitCode !== -1) {
        console.log(`      Exit code: ${r.exitCode}`);
      }
      if (r.output && r.output.length < 500) {
        const outputPreview = r.output.split('\n').slice(0, 5).join('\n      ');
        console.log(`      Output: ${outputPreview}`);
      }
    });
  }

  // Final summary
  console.log('');
  console.log(colorize('bold', '='.repeat(60)));
  
  const totalPassed = passedTests.length;
  const totalFailed = failedTests.length;
  const totalTests = results.length;

  if (totalFailed === 0) {
    console.log(colorize('green', '  ALL TESTS PASSED'));
    console.log(colorize('green', `  ${totalPassed}/${totalTests} test suites passed`));
    console.log(`  Total time: ${totalTime}ms`);
    console.log(colorize('bold', '='.repeat(60)));
    process.exit(0);
  } else {
    console.log(colorize('red', '  SOME TESTS FAILED'));
    console.log(colorize('red', `  ${totalFailed}/${totalTests} test suites failed`));
    console.log(`  Total time: ${totalTime}ms`);
    console.log(colorize('bold', '='.repeat(60)));
    process.exit(1);
  }
}

// Run and handle errors
main().catch(err => {
  console.error(colorize('red', 'Fatal error running tests:'));
  console.error(err);
  process.exit(1);
});
