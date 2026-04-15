/**
 * Vitest Configuration for mesh-memory testing
 * Alternative to Jest with native ESM support
 */

import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Include glob patterns
    include: [
      'unit/**/*.test.mjs',
      'integration/**/*.test.mjs',
      'e2e/**/*.test.mjs',
    ],
    
    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
    ],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['../*.mjs'],
      exclude: [
        'node_modules/',
        'testing/',
        '**/*.config.mjs',
        '**/*.test.mjs',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    
    // Test timeout (ms)
    testTimeout: 30000,
    
    // Hook timeout
    hookTimeout: 30000,
    
    // Clear mocks between tests
    clearMocks: true,
    
    // Restore mocks between tests
    restoreMocks: true,
    
    // Globals
    globals: true,
    
    // Retry on failure
    retry: process.env.CI ? 2 : 0,
    
    // Workers
    minWorkers: 1,
    maxWorkers: process.env.CI ? 2 : undefined,
    
    // Isolate each test file
    isolate: true,
    
    // Reporter
    reporter: process.env.CI ? ['verbose', 'junit'] : ['verbose'],
    
    // Output file for JUnit reporter
    outputFile: process.env.CI ? './junit.xml' : undefined,
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, '..'),
      '@mocks': resolve(__dirname, 'mocks'),
      '@helpers': resolve(__dirname, 'helpers'),
    },
  },
});
