/**
 * Jest Configuration for mesh-memory testing
 * Supports both unit and integration test execution
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Use ESM support
  extensionsToTreatAsEsm: ['.mjs', '.js'],
  
  // Transform configuration for ESM
  transform: {},
  
  // Module file extensions
  moduleFileExtensions: ['mjs', 'js', 'json'],
  
  // Test match patterns
  testMatch: [
    '<rootDir>/unit/**/*.test.mjs',
    '<rootDir>/integration/**/*.test.mjs',
    '<rootDir>/e2e/**/*.test.mjs',
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    '../*.mjs',
    '!../*.config.mjs',
    '!../node_modules/**',
    '!../testing/**',
  ],
  
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  
  coverageDirectory: '<rootDir>/coverage',
  
  // Module name mapping
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../$1',
    '^@mocks/(.*)$': '<rootDir>/mocks/$1',
    '^@helpers/(.*)$': '<rootDir>/helpers/$1',
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
  
  // Test timeout
  testTimeout: 30000,
  
  // Verbose output for CI
  verbose: true,
  
  // Fail on console errors/warnings in CI
  errorOnDeprecated: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks between tests
  restoreMocks: true,
  
  // Workers for parallel execution
  maxWorkers: process.env.CI ? 2 : '50%',
};
