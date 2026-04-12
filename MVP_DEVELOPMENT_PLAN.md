# Mesh-Memory MVP Development Plan

**Status:** POC Operational → MVP Target  
**Date:** 2026-04-11  
**Team:** Liz (primary), Ray, Woodhouse (A2A support)  
**Infrastructure:** GX-10 Local Inference (`192.168.50.30:8080`)

---

## Executive Summary

The mesh-memory project is currently at POC stage with basic functionality operational across three nodes. However, several critical gaps prevent it from being production-grade. This plan outlines the rebuild required to achieve MVP status with production-grade durability, observability, and failure resilience.

**Key Gaps in POC:**
- No token expiry/rotation mechanism
- No queue persistence for failed A2A messages
- No storage rotation/pruning (infinite growth)
- No health checks or automated recovery
- No metrics or observability
- Dream-cycle hard dependency on external API
- Thread state machine gaps (timeout handling, orphaned contexts)

---

## Phase Breakdown

### Phase 1: Foundation Hardening (Days 1-3) ⭐ CRITICAL PATH

**Goal:** Eliminate data-loss scenarios and ensure basic failure resilience.

#### 1.1 Token Management System
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design token lifecycle (create, rotate, revoke, audit) | Liz | 4 | RFC-0001: Token Management Protocol |
| Implement token expiry with automatic rotation window | Liz | 6 | Tokens auto-rotate 24h before expiry, no disruption to active threads |
| Add token revocation endpoint (emergency + graceful) | Liz | 4 | `POST /tokens/:tokenId/revoke` returns 200, immediately invalidates token |
| Write token audit log (who, what, when) | Liz | 2 | Audit entries in `logs/token-audit.jsonl` |
| **Subtotal** | | **16h** | |

#### 1.2 Queue Persistence Layer
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design queue persistence schema | Liz | 3 | ADR-0001: Queue Persistence |
| Implement SQLite-based outbound queue | Liz | 8 | Failed messages queue, retry with exponential backoff, max 5 attempts |
| Add queue processor daemon | Liz | 6 | Processes queue every 30s, logs success/failure |
| Implement dead-letter queue (DLQ) for permanent failures | Liz | 4 | After 5 retries, message to DLQ with full context |
| Add queue metrics endpoint | Liz | 2 | `GET /metrics/queue` returns depth, oldest message, error rate |
| **Subtotal** | | **23h** | |

**Phase 1 Exit Criteria:**
- [ ] All tokens rotate without manual intervention
- [ ] 1000 message burst test with 20% failure rate recovers to 100% delivery
- [ ] Process restart with queued messages results in zero message loss

---

### Phase 2: Storage Management (Days 4-6) ⭐ CRITICAL PATH

**Goal:** Prevent unbounded disk growth, ensure predictable performance.

#### 2.1 Storage Rotation System
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design rotation policy (configurable retention) | Liz | 4 | RFC-0002: Storage Lifecycle Management |
| Implement `rotate-storage.mjs` with full functionality | Liz | 10 | Archive files > 90 days old, compress, maintain checksums |
| Add `prune` mode for aggressive cleanup | Liz | 4 | Delete files older than configured retention with audit log |
| Implement storage usage metrics | Liz | 3 | `GET /metrics/storage` returns used, available, archive status |
| Add low-disk-watermark protection | Liz | 3 | Service enters degraded mode (rejects new non-critical writes) at <10% disk |
| **Subtotal** | | **24h** | |

#### 2.2 Backup and Recovery
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design backup strategy | Liz | 3 | ADR-0002: Backup and Recovery Strategy |
| Implement automated daily backup to S3 | Liz | 6 | Completes in <5 minutes, encrypted, verifies integrity |
| Add backup restore command | Liz | 4 | Single command restore from backup, validates before swap |
| Write disaster recovery runbook | Liz | 2 | DR.md with step-by-step recovery procedures |
| **Subtotal** | **15h** | |

**Phase 2 Exit Criteria:**
- [ ] Storage stays below 80% for 7-day simulated high-volume run
- [ ] Restore from backup completes in <10 minutes
- [ ] No data loss after simulated disk-full event

---

### Phase 3: Local Resilience (Days 7-8)

**Goal:** Eliminate external dependencies for critical path operations.

#### 3.1 Dream-Cycle Local Fallback
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design local inference integration for dream-cycle | Liz | 4 | ADR-0003: Local Inference for Dream Cycle |
| Implement GX-10 fallback for dream-cycle | Liz | 8 | Falls back to local Nemotron-Super when Together AI fails |
| Add local-only mode (no external dependencies) | Liz | 4 | Starts and runs fully local with degraded quality warning |
| **Subtotal** | **16h** | |

#### 3.2 Critical Path External Dependency Audit
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Audit all external API calls in critical path | Liz | 4 | Document: external service, SLA impact, mitigation status |
| Add circuit breakers for external calls | Liz | 6 | Circuit opens after 3 failures, enters degraded mode |
| Implement degraded mode behaviors | Liz | 4 | Reduced functionality, queues, user notification |
| **Subtotal** | **14h** | |

**Phase 3 Exit Criteria:**
- [ ] Dream-cycle completes successfully with all external services disabled
- [ ] Circuit breaker test: 3 failures = open circuit, queued processing |

---

### Phase 4: Observability (Days 9-11)

**Goal:** Complete visibility into system health and failure modes.

#### 4.1 Health Check System
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design health check framework | Liz | 4 | ADR-0004: Health Check Framework |
| Implement dependency health checks | Liz | 6 | Checks: database, queue, disk, network peers, external APIs |
| Add comprehensive `/health` endpoint | Liz | 4 | Returns: status (healthy/degraded/critical), checks detail |
| Implement readiness/liveness distinction | Liz | 4 | `/health/ready`, `/health/live` for orchestration |
| **Subtotal** | **18h** | |

#### 4.2 Metrics and Alerting
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design metrics schema | Liz | 3 | RFC-0003: Metrics and Instrumentation |
| Implement Prometheus-compatible metrics endpoint | Liz | 8 | `/metrics` returns standard Prometheus exposition format |
| Add key SLIs: latency percentiles, error rates, throughput | Liz | 6 | P50, P95, P99 latency; error rate by endpoint |
| Implement threshold-based alerting | Liz | 6 | Alerts to webhook, configurable thresholds |
| **Subtotal** | **23h** | |

#### 4.3 Logging and Tracing
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Implement structured logging (JSON) | Liz | 4 | All log output is valid JSON with severity, context, trace ID |
| Add distributed tracing support | Liz | 6 | OpenTelemetry trace context propagation |
| Log rotation and archival | Liz | 4 | Automatic rotation, compression, retention policy |
| **Subtotal** | **14h** | |

**Phase 4 Exit Criteria:**
- [ ] All health checks pass in steady state, degrade appropriately under load
- [ ] Metrics show clear baseline, load, and recovery patterns
- [ ] Log aggregation system can reconstruct a multi-hop transaction

---

### Phase 5: Thread Lifecycle Robustness (Days 12-13)

**Goal:** Eliminate edge cases in multi-agent collaboration.

#### 5.1 Thread State Machine Hardening
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Audit thread state machine edge cases | Liz | 4 | Document: orphaned threads, partial consensus, network partition during vote |
| Implement orphaned thread detection | Liz | 6 | Detects and alerts on threads > 24h idle |
| Add partial-consensus timeout handling | Liz | 4 | Thread fails gracefully after 2h no-consensus |
| Implement thread-participant failure detection | Liz | 6 | Detects when participant agent goes offline during active thread |
| **Subtotal** | **20h** | |

#### 5.2 Thread Recovery
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design thread recovery protocol | Liz | 3 | RFC-0004: Thread Recovery Protocol |
| Implement thread state snapshot/restore | Liz | 6 | Can resume thread after coordinator failure |
| Add thread migration (move coordinator) | Liz | 4 | Hand off coordinator role to another agent |
| **Subtotal** | **13h** | |

**Phase 5 Exit Criteria:**
- [ ] Thread with two participants can survive coordinator restart
- [ ] Orphaned thread is detected, alerted, and safely closed within 30 minutes |

---

### Phase 6: Security Hardening (Days 14-15)

**Goal:** Production-grade security posture.

| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Security audit of all endpoints | Liz | 4 | ADR-0005: Security Review |
| Implement rate limiting | Liz | 4 | 100 req/min per IP, 1000 req/min per token |
| Add input validation hardening | Liz | 4 | JSON schema validation for all inputs, max sizes, type enforcement |
| Secrets rotation without downtime | Liz | 4 | Hot-reload of secrets from secure store |
| Security headers and TLS best practices | Liz | 3 | HSTS, secure cookies, TLS 1.3 only |
| **Subtotal** | **19h** | |

**Phase 6 Exit Criteria:**
- [ ] Security scan passes (npm audit, custom check) with 0 critical, 0 high |
- [ ] Load test with attack simulation: rate limiting effective, no crashes |

---

### Phase 7: Testing and Validation (Days 16-18)

**Goal:** Prove it works, prove it keeps working.

#### 7.1 Test Suite
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design test pyramid (unit, integration, e2e) | Liz | 4 | Testing Strategy Document |
| Implement core unit test suite | Liz | 10 | >80% coverage of critical path |
| Build integration test harness | Liz | 8 | Tests multi-node scenarios with Docker Compose |
| Property-based tests for state machines | Liz | 4 | Quickcheck-style tests catch edge cases |
| **Subtotal** | **26h** | |

#### 7.2 Load and Chaos Testing
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Design load test scenarios | Liz | 3 | RFC-0005: Load Testing |
| Build load generator | Liz | 6 | Simulates 10x normal load, measures degradation |
| Implement chaos engineering framework | Liz | 8 | Randomly kills nodes, simulates network partitions, disk faults |
| Add failure injection modes | Liz | 4 | Flags to trigger: token expiry, queue overflow, disk full |
| **Subtotal** | **21h** | |

#### 7.3 Multi-Agent Validation
| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Deploy all changes to test mesh (all 3 nodes) | Liz/Ray/Woodhouse | 4 | All nodes running latest version |
| Run full system validation | Liz/Ray/Woodhouse | 4 | validate-mesh.sh exits 0 on all nodes |
| Conduct failure scenario drill | Liz/Ray/Woodhouse | 4 | Simulate: coordinator failure, token expiry, queue overflow, recovery time measured |
| Performance baseline | Liz | 4 | Document: throughput, latency, resource consumption under normal load |
| **Subtotal** | **16h** | |

**Phase 7 Exit Criteria:**
- [ ] Test suite passes 100% |
- [ ] Load test: 10x sustained, no crash, graceful degradation |
- [ ] Chaos test: 5 failure types injected, all recover within SLA |
- [ ] Security scan: clean |
- [ ] Performance benchmark: document capacity limits |

---

### Phase 8: Documentation and Handovers (Days 19-20)

**Goal:** Complete, accurate, tested documentation.

| Task | Owner | Est. Hours | Exit Criteria |
|------|-------|------------|---------------|
| Architecture documentation (current state) | Liz | 6 | ARCHITECTURE-MVP.md |
| Operational runbooks | Liz | 6 | RUNBOOK.md: common tasks, troubleshooting, escalation |
| Onboarding guide for new nodes/agents | Liz | 4 | ONBOARDING.md |
| API documentation (OpenAPI spec) | Liz | 4 | openapi.yaml |
| README update | Liz | 2 | Quick start, accurate, tested |
| **Subtotal** | **22h** | |

**Final Exit Criteria:**
- [ ] Documentation tested by independent user (Erik) |
- [ ] Deployed to production without critical issue |
- [ ] 30-day burn-in: <0.1% message loss, <0.01% error rate |

---

## Timeline Summary

| Phase | Days | Hours | Focus |
|-------|------|-------|-------|
| 1. Foundation Hardening | 1-3 | 39h | Data durability, no loss scenarios |
| 2. Storage Management | 4-6 | 39h | Bounded growth, recoverability |
| 3. Local Resilience | 7-8 | 30h | No external dependencies on critical path |
| 4. Observability | 9-11 | 55h | Complete visibility, alerting |
| 5. Thread Robustness | 12-13 | 33h | Edge cases, failure modes |
| 6. Security Hardening | 14-15 | 19h | Production security posture |
| 7. Testing/Validation | 16-18 | 63h | Prove it works, keep it working |
| 8. Documentation | 19-20 | 22h | Complete, accurate, tested docs |
| **Total** | **20 days** | **~300 hours** | |

**Critical Path:** Phases 1, 2, 4, 7

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOUNDATION (Phases 1-2)                     │
│  Token Mgmt ──► Queue Persistence ──► Storage Management        │
└────────────────────────┬──────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CORE SERVICES (Phases 3-5)                    │
│  Local Resilience ◄────┐                                         │
│  Thread Robustness ◄───┼──┐                                     │
│  Observability ◄───────┘  │                                     │
└────────────────────────┬──┘                                     │
                         ▼                                        │
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY (Phase 6)                          │
└────────────────────────┬──────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VALIDATION (Phase 7)                        │
└────────────────────────┬──────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DOCUMENTATION (Phase 8)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GX-10 unavailable during development | Medium | High | Design with pluggable inference, fallback to Together AI |
| A2A protocol instability | Low | High | Abstract A2A calls behind interface, document assumptions |
| Time estimate overrun (20% buffer) | Medium | Medium | Weekly burndown, scope cut criteria defined |
| Multi-node coordination complexity | Medium | High | Daily sync via A2A, shared status dashboard |
| Token rotation causing downtime | Low | High | Test thoroughly in Phase 1, rollback plan ready |
| Storage full during rotation | Low | High | Low-watermark protection, emergency pruning mode |
| Thread state machine bugs in prod | Low | Critical | Extensive property testing, staged rollout |

---

## Agency Agent Allocation

### Roles and Responsibilities

| Agent | Primary Role | Responsibilities |
|-------|-------------|------------------|
| **Liz** | Tech Lead / Lead Developer | Architecture, implementation, code review, coordination |
| **Ray** | Integration Engineer | Multi-node testing, A2A protocol, deployment automation |
| **Woodhouse** | DevOps / Reliability Engineer | Monitoring, alerting, chaos engineering, documentation |

### Task Assignment by Phase

| Phase | Liz | Ray | Woodhouse |
|-------|-----|-----|-----------|
| 1. Foundation | 100% | - | - |
| 2. Storage | 80% | 20% | - |
| 3. Local Resilience | 100% | - | - |
| 4. Observability | 50% | - | 50% |
| 5. Thread Robustness | 70% | 30% | - |
| 6. Security | 60% | - | 40% |
| 7. Testing | 40% | 40% | 20% |
| 8. Documentation | 50% | - | 50% |

### Specialist Spawn Triggers

| Trigger Condition | Specialist Role | When to Spawn |
|-------------------|-----------------|---------------|
| Token crypto design needs review | Security Engineer | Phase 1.1 design complete |
| SQLite performance bottlenecks | Database Engineer | Phase 1.2 implementation |
| Thread state machine complexity | Distributed Systems Engineer | Phase 5.1 design |
| Load test failures | Performance Engineer | Phase 7.2 |
| Security scan findings | Security Auditor | Phase 6 completion |

---

## Validation Gates

### How We Prove Cross-Session Durability

| Test | Approach | Success Criteria |
|------|----------|------------------|
| Token Rotation | Automated test: rotate token during active thread | Thread continues without interruption, old token rejected, new token accepted |
| Queue Persistence | Kill process mid-transmission, restart | 100% message delivery after restart, no duplicates |
| Storage Rotation | Simulate 90-day retention boundary | Archive created, checksum valid, access still works |
| Crash Recovery | SIGKILL during write, restart | No corruption, writes resume from last known good state |
| Network Partition | Disconnect node for 5 min, reconnect | Queue drains, no message loss, threads recover |

### Load Tests

| Scenario | Target Load | Duration | Acceptance Criteria |
|----------|-------------|----------|---------------------|
| Steady State | 100 messages/min | 24h | <1s P95 latency, 0% error rate |
| Burst | 1000 messages/min | 10 min | <5s P95 latency, <0.1% error rate |
| Sustained High | 500 messages/min | 4h | <2s P95 latency, <0.01% error rate |
| Recovery | Load + failure injection | Until recovery | Recovery to steady state <60s |

### Failure Injection

| Failure | Injection Method | Expected Behavior |
|---------|------------------|-------------------|
| Token expiry mid-thread | Fast-forward clock, force expiry | Graceful rotation, no interruption |
| Queue overflow | Reduce max queue size, flood | Reject with clear error, no crash, metrics clear |
| Disk full | Mount small tmpfs, fill | Enter degraded mode, preserve critical data, alert |
| Node crash | SIGKILL random node | Other nodes detect, handle, queue for retry |
| Network partition | iptables DROP | Detect partition, queue, reconnect, drain queue |
| Database corruption | Corrupt SQLite file | Detect, restore from backup, alert |

---
## Appendix A: Test Infrastructure

```
GX-10 (192.168.50.30)
├── NVIDIA Nemotron-Super:120B  →  :8080/completion
├── NVIDIA Nemotron-Nano:4B     →  :8081/completion  
└── Nomic Embed Text            →  :8082/embedding

Test Mesh
├── liz-node     (192.168.50.23)  →  Primary development
├── ray-node     (192.168.50.22)  →  Integration testing
└── woodhouse-node (192.168.50.24) →  Reliability testing
```

---

## Appendix B: Deliverables Checklist

### Code Deliverables
- [ ] Token management system
- [ ] Queue persistence layer
- [ ] Storage rotation system
- [ ] Local inference fallback
- [ ] Health check framework
- [ ] Metrics and alerting
- [ ] Structured logging
- [ ] Thread state machine
- [ ] Security hardening
- [ ] Test suite (unit, integration, e2e)
- [ ] Load and chaos testing framework

### Document Deliverables
- [ ] RFC-0001: Token Management Protocol
- [ ] RFC-0002: Storage Lifecycle Management
- [ ] RFC-0003: Metrics and Instrumentation
- [ ] RFC-0004: Thread Recovery Protocol
- [ ] RFC-0005: Load Testing
- [ ] ADR-0001: Queue Persistence
- [ ] ADR-0002: Backup and Recovery Strategy
- [ ] ADR-0003: Local Inference for Dream Cycle
- [ ] ADR-0004: Health Check Framework
- [ ] ADR-0005: Security Review
- [ ] ARCHITECTURE-MVP.md
- [ ] RUNBOOK.md
- [ ] ONBOARDING.md
- [ ] openapi.yaml

### Compliance
- [ ] Security scan: clean
- [ ] Privacy scan: clean
- [ ] License audit: clean
- [ ] Documentation review: complete
- [ ] Test coverage report: >80%
- [ ] Performance benchmark: documented
- [ ] Cost estimate: monthly run rate

---

**Estimated Total Effort: 300 hours (~20 developer-days)**
**Critical Path: 280 hours**
**Risk Buffer: 20 hours (7%)**

---

*This plan was generated by the workflow-architect agency agent.*
*Review required before execution begins.*
