# Palace Error Codes Documentation

## Overview

This document catalogs all error codes used in the mesh-memory Palace system. Errors are structured hierarchically with correlation IDs for request tracing.

## Error Classes

### PalaceError (Base)
All Palace errors extend `PalaceError` with:
- `code`: Machine-readable error identifier
- `correlationId`: Unique request identifier for tracing
- `timestamp`: ISO 8601 timestamp
- `severity`: debug | info | warn | error | fatal
- `context`: Additional contextual metadata
- `recoverable`: Whether the operation can be retried

### TunnelError
Errors related to mesh tunnel communication.

| Code | Description | Retryable |
|------|-------------|-----------|
| `TUNNEL_001` | General tunnel error | Yes |
| `TUNNEL_RETRYABLE` | Transient communication error | Yes |
| `TUNNEL_PERMANENT` | Permanent tunnel failure | No |
| `TUNNEL_AUTH` | Authentication failed (401/403) | No |
| `TUNNEL_TIMEOUT` | Request timeout | Yes |

### ValidationError
Input validation failures.

| Code | Description | Field |
|------|-------------|-------|
| `VALIDATION_001` | General validation error | N/A |
| `VALIDATION_FIELD` | Field validation failed | Field name |
| `VALIDATION_SCHEMA` | Schema validation failed | N/A |
| `VALIDATION_REQUIRED` | Required field missing | Field name |
| `VALIDATION_INVALID` | Invalid value provided | Field name |

### DatabaseError
SQLite/database operation errors.

| Code | Description | Operation |
|------|-------------|-----------|
| `DB_001` | General database error | N/A |
| `DB_CONNECTION` | Failed to connect to database | connect |
| `DB_QUERY` | Query execution failed | query name |

## Critical Facts Loader Errors

| Code | Description | Context |
|------|-------------|---------|
| `INIT_FAILED` | Database initialization failed | { dbDir } |
| `DB_NOT_INITIALIZED` | Database not initialized | Call init() first |
| `LOADER_CREATE_FAILED` | Failed to create loader | Cause: underlying error |
| `QUICKLOAD_FAILED` | QuickLoad wrapper error | N/A |
| `WAKEUP_INIT_FAILED` | Failed to initialize for wake-up | Cause: init error |

## Runtime Error Handling

### safeExecute / safeExecuteSync
All async operations return standardized result objects:

```javascript
// Success
{ success: true, data: <result>, correlationId: "..." }

// Failure  
{ success: false, error: { code, message, correlationId }, correlationId: "..." }
```

### Graceful Degradation
The system follows these principles:
1. **Never crash on malformed input** - return error objects
2. **Log all errors with context** - correlation IDs for tracing
3. **Retry transient failures** - with exponential backoff
4. **Queue failed publishes** - for later retry
5. **Fallback to degraded modes** - e.g., LIKE search when FTS unavailable

### Unhandled Promise Rejection Prevention
- All promises wrapped in `safeExecute`
- Event handlers use try/catch with error logging
- Express error handlers return structured error responses

## Logging Levels

| Level | Use Case |
|-------|----------|
| DEBUG | Verbose operation details, query traces |
| INFO | Successful operations, state changes |
| WARN | Recoverable errors, deprecated usage |
| ERROR | Operation failures, unexpected conditions |
| FATAL | System-critical failures (not used yet) |

## Validation Coverage

### critical-facts-loader.mjs
- ✅ `dbPath` - path validation
- ✅ `passportPath` - path validation  
- ✅ `fact.id` - required, string
- ✅ `fact.tier` - enum: ['critical', 'deep']
- ✅ `fact.category` - enum: 6 categories
- ✅ `fact.content.title` - required
- ✅ `fact.content.body` - required
- ✅ `fact.provenance.source` - required
- ✅ `fact.provenance.timestamp` - ISO 8601
- ✅ Query `limit` - positive number
- ✅ `id` parameter - non-empty string

### tunnel-publisher.mjs
- ✅ `fact.id` - required
- ✅ `fact.tier` - valid enum
- ✅ `fact.content` - required structure
- ✅ `fact.provenance` - required fields
- ✅ Timestamp - not future, not >24h old
- ✅ Content - no interpretation keywords
- ✅ `peers` - array of valid URL objects

### a2a-palace-adapter.mjs
- ✅ `peers` - array with valid URLs
- ✅ `fact` - complete structure validation
- ✅ File paths - existence checks

## Error Response Format

All API endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VALIDATION_SCHEMA",
    "message": "Fact validation failed",
    "correlationId": "palace_abc123_xyz",
    "recoverable": true
  }
}
```

## Correlation ID Format

```
palace_<timestamp>_<random>
```

Example: `palace_l2k3j4_8f3a2b9c1`

Used throughout request lifecycle for:
- Logging
- Tracing errors across service boundaries
- Debugging distributed operations
