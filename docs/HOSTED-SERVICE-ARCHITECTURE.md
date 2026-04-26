# Mesh-Memory Hosted Service Architecture
## Agent Deal Rooms — SaaS Infrastructure Design

**Version:** 1.0-draft  
**Date:** 2026-04-21  
**Status:** Planning Phase

---

## 1. Executive Summary

**Multi-tenant SaaS architecture for Agent Deal Rooms**

- **Four service tiers:** Developer (free/self-hosted), Team ($49/mo), Enterprise (custom), Sovereign (dedicated)
- **Availability target:** 99.99% uptime (52.6 min/year downtime budget)
- **Global deployment:** us-east-1, eu-west-1, ap-southeast-1 with data residency
- **Security:** AES-256 encryption at rest, TLS 1.3 in transit, mTLS for agents
- **Compliance:** SOC2 Type II, HIPAA, GDPR, FedRAMP (Sovereign tier)

**Key metrics:**
| Metric | Target |
|--------|--------|
| API latency (p99) | < 200ms |
| Deal room creation | < 2s |
| Audit query | < 5s |
| Concurrent rooms | 10K+ per region |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EDGE LAYER                                     │
│  CloudFront / Cloudflare — DDoS protection, TLS termination, geo-routing      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY                                       │
│  • Rate limiting (per tenant, per endpoint)                                 │
│  • AuthN: API keys, OIDC, mTLS                                              │
│  • AuthZ: ABAC policy engine                                                │
│  • Request routing, caching layer                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ Room Service │ │Context Svc   │ │ Audit Svc    │ │ Consensus Svc   │  │
│  │ (orchestrate)│ │ (escrow/kg)  │ │ (WORM logs)  │ │ (voting/close)  │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│  │ Policy Eng   │ │ Compliance   │ │ Identity     │                        │
│  │ (ABAC eval)  │ │ (retention)  │ │ (agents)     │                        │
│  └──────────────┘ └──────────────┘ └──────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────────┐    │
│  │ Aurora PG    │ │ S3 (WORM)    │ │ DynamoDB     │ │ Neptune (graph) │    │
│  │ (metadata)   │ │ (audit logs) │ │ (sessions)   │ │ (temporal KG)   │    │
│  └──────────────┘ └──────────────┘ └──────────────┘ └─────────────────┘    │
│  ┌──────────────┐ ┌──────────────┐                                          │
│  │ ElastiCache  │ │ KMS (keys)   │                                          │
│  │ (hot cache)  │ │ (per-tenant) │                                          │
│  └──────────────┘ └──────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Specifications

### 3.1 Edge Layer

**CloudFront Configuration:**
- **Origins:** ALB in each region
- **Behaviors:** Static assets cached, API paths forwarded
- **Security:** AWS WAF, Shield Standard
- **Cost:** ~$0.085/GB data transfer

**Failover:**
- Multi-region DNS with health checks
- Automatic failover to secondary region on degradation

### 3.2 API Gateway

**Technology:** AWS API Gateway (REST) + Application Load Balancer

**Rate Limiting:**
| Tier | Requests/min | Burst |
|------|--------------|-------|
| Developer | 100 | 150 |
| Team | 1,000 | 1,500 |
| Enterprise | 10,000 | 15,000 |
| Sovereign | Unlimited | Unlimited |

**Authentication flows:**
1. **API Key:** Fast path for automated agents
2. **OIDC:** OAuth 2.0 / OIDC for human users
3. **mTLS:** X.509 client certificates for agent identity

### 3.3 Application Services

**Room Service (Node.js/Fargate)**
- Room lifecycle management
- Participant orchestration
- Consent workflow engine
- **Scaling:** 2-50 tasks based on queue depth

**Context Service (Node.js/Fargate)**
- Temporal knowledge graph operations
- Fact validation and ingestion
- Query engine for context escrow
- **Scaling:** 2-100 tasks (compute-intensive)

**Audit Service (Lambda + S3)**
- WORM log writes
- Hash chain computation
- Audit trail queries
- **Scaling:** Serverless, event-driven

**Consensus Service (Node.js/Fargate)**
- Voting state machines
- Decision finalization
- Notification dispatch
- **Scaling:** 2-20 tasks

**Policy Engine (Lambda)**
- ABAC evaluation
- Real-time policy checks
- **Scaling:** Serverless, < 50ms evaluation

**Compliance Service (Lambda + Step Functions)**
- Retention policy enforcement
- Data residency checks
- Automated compliance reporting

### 3.4 Data Layer

**Aurora PostgreSQL**
- **Purpose:** Room metadata, participant registry, audit index
- **Instance:** db.r6g.xlarge (4 vCPU, 32GB) per region
- **Storage:** 500GB SSD, auto-scaling
- **Backup:** 35-day retention, cross-region snapshot
- **Encryption:** AES-256, KMS tenant-scoped keys

**S3 (WORM Buckets)**
- **Purpose:** Immutable audit logs
- **Configuration:** Object Lock (Compliance mode), 7-year retention
- **Structure:** `s3://{tenant-id}/audit/{room-id}/{timestamp}.log`
- **Replication:** Cross-region for durability

**DynamoDB**
- **Purpose:** Ephemeral session state, token cache
- **Tables:** Sessions (TTL 24h), Tokens (TTL 1h), RateLimits
- **Capacity:** On-demand auto-scaling

**Amazon Neptune**
- **Purpose:** Temporal knowledge graph (context escrow)
- **Instance:** db.r5.large (2 vCPU, 16GB)
- **Engine:** Neptune (TinkerPop/Gremlin)
- **Scaling:** Read replicas per region

**ElastiCache (Redis)**
- **Purpose:** Hot cache for active rooms, policy evaluations
- **Instance:** cache.r6g.large
- **Eviction:** LRU, TTL-based for ephemeral data

---

## 4. Security Architecture

### 4.1 Encryption at Rest

| Data Type | Method | Key Management |
|-----------|--------|----------------|
| PostgreSQL | AES-256-GCM | AWS KMS (tenant-scoped CMK) |
| S3 WORM | AES-256 | S3-managed + KMS envelope |
| DynamoDB | AES-256 | AWS managed, table-level |
| Neptune | AES-256 | KMS with automatic rotation |

**Key Rotation:**
- Automatic: Every 365 days
- Manual: On-demand for security events
- Tenant-scoped: Each tenant has dedicated KMS key

### 4.2 Encryption in Transit

- **TLS 1.3** required for all external traffic
- **mTLS** for agent authentication (X.509 certificates)
- **Certificate pinning** for critical endpoints
- **HSTS** headers with 1-year max-age

### 4.3 Field-Level Encryption

PII/PHI fields encrypted before database write:
- User email addresses
- Agent identity metadata
- Document content (context escrow)

### 4.4 Secret Management

**AWS Secrets Manager:**
- Database credentials
- API keys (encrypted, rotated every 90 days)
- OIDC client secrets
- Integration tokens

**Rotation:**
- Automatic rotation for supported databases
- Manual rotation via CI/CD pipeline
- Emergency rotation: < 5 minutes propagation

---

## 5. Authentication & Authorization

### 5.1 API Key Flow

```
1. Tenant generates API key (hashed stored)
2. Request: Authorization: Bearer {api-key}
3. Gateway validates against Secrets Manager
4. ABAC policy evaluation
5. Request forwarded to service
```

**Key properties:**
- Prefix for identification: `mm_live_`, `mm_test_`
- Scoping: Read-only, Write, Admin
- Expiry: Default 90 days, configurable

### 5.2 OIDC Integration

**Supported providers:**
- Google Workspace
- Okta
- Azure AD
- Generic OIDC

**Flow:**
```
1. User redirected to IdP
2. IdP returns JWT
3. Gateway validates signature
4. User identity extracted
5. ABAC evaluation
```

### 5.3 mTLS for Agents

**Certificate requirements:**
- X.509 v3
- Subject: Agent identity (e.g., `CN=agent-id`)
- Issuer: Trusted CA (mesh-memory or customer)
- Expiry: Max 365 days

**Validation:**
```
1. TLS handshake with client cert
2. Certificate chain validation
3. Certificate revocation check (OCSP)
4. Agent identity extraction
5. ABAC evaluation
```

### 5.4 ABAC Policy Examples

**Policy 1: Room Access**
```yaml
policy:
  name: room-access
  effect: allow
  actions: [read, write]
  resource: room:{room-id}
  conditions:
    - subject.role IN [participant, owner]
    - time.now BETWEEN room.start_time AND room.end_time
    - room.status == ACTIVE
```

**Policy 2: Audit Export**
```yaml
policy:
  name: audit-export
  effect: allow
  actions: [export]
  resource: audit:{room-id}
  conditions:
    - subject.role == owner
    - OR (subject.role == participant AND room.status == CLOSED)
```

---

## 6. Scalability & Performance

### 6.1 Horizontal Scaling

**Auto-scaling triggers:**
| Service | Metric | Scale Up | Scale Down |
|---------|--------|----------|------------|
| Room Service | CPU > 70% | +2 tasks | -1 task |
| Context Service | Queue depth > 100 | +4 tasks | -2 tasks |
| Consensus | Active rooms > 500 | +2 tasks | -1 task |
| Lambda | Invocation rate | Automatic | Automatic |

**Limits:**
- Fargate: 500 tasks per service (soft limit)
- Lambda: 10,000 concurrent executions
- Neptune: 15 read replicas

### 6.2 Database Sharding

**Sharding strategy:** Tenant ID hash
- Shard key: First 4 chars of tenant ID
- 256 shards → ~3.9K tenants per shard
- Cross-shard queries: Rare (audit reports only)

### 6.3 Caching Strategy

**ElastiCache layers:**
| Cache | TTL | Hit Rate Target |
|-------|-----|-----------------|
| Room metadata | 5 min | 85% |
| Policy evaluations | 1 min | 90% |
| Agent identity | 10 min | 95% |
| Context hot paths | 2 min | 70% |

### 6.4 Throughput per Tier

| Tier | Concurrent Rooms | API Calls/day | Storage |
|------|------------------|---------------|---------|
| Developer | 5 | 10K | 1 GB |
| Team | 25 | 100K | 10 GB |
| Enterprise | Unlimited | 1M+ | 100 GB+ |
| Sovereign | Unlimited | Unlimited | Dedicated |

---

## 7. Disaster Recovery & High Availability

### 7.1 Multi-AZ Deployment

**Per region:**
- 3 Availability Zones
- Aurora: 1 writer, 2 readers (cross-AZ)
- Fargate: Tasks distributed across AZs
- S3: Automatically multi-AZ

### 7.2 Backup Strategy

**Recovery Point Objective (RPO):**
- Aurora: 5 minutes (continuous backup)
- S3: Real-time (cross-region replication)
- DynamoDB: Real-time (PITR)

**Recovery Time Objective (RTO):**
- Single AZ failure: 0 (automatic failover)
- Region failure: 15 minutes (manual failover)
- Complete disaster: 4 hours (cross-region restore)

### 7.3 Failover Procedures

**Database failover:**
1. Aurora automatic promotion of read replica
2. Application retry with exponential backoff
3. DNS update (if needed)
4. Alert on-call engineer

**Regional failover:**
1. DNS switch to secondary region
2. S3 cross-region replication sync
3. DynamoDB global tables sync
4. Neptune manual promotion

### 7.4 Data Replication

**Cross-region replication:**
- S3: Asynchronous, RPO < 15 min
- Aurora: Aurora Global Database (RPO < 1 sec)
- DynamoDB: Global tables (RPO < 1 sec)

---

## 8. Compliance Architecture

### 8.1 SOC2 Type II

**Controls implemented:**
- Access controls (ABAC, MFA)
- Audit logging (all API calls)
- Change management (IaC, CI/CD)
- Incident response (runbooks, 24/7 on-call)
- Encryption (at rest, in transit)

### 8.2 HIPAA

**Requirements:**
- BAA with AWS
- Encryption (AES-256)
- Access logging
- Audit trails (WORM)
- Minimum necessary access

**Implementation:**
- Separate KMS keys per healthcare tenant
- Additional audit logging
- Annual risk assessment
- Staff training

### 8.3 GDPR

**Data residency:**
- EU data stays in eu-west-1
- Configurable per tenant
- No automatic cross-border transfer

**Right to deletion:**
- API endpoint: DELETE /tenant/{id}/data
- Soft delete → hard delete after retention
- Audit trail retained (anonymized)

**Data portability:**
- Export to JSON, CSV
- Standard format for room data

### 8.4 FedRAMP (Sovereign Tier)

**Path:**
- Dedicated infrastructure
- AWS GovCloud option
- 3PAO audit
- 12-18 month process

---

## 9. Deployment Architecture

### 9.1 CI/CD Pipeline

**GitHub Actions → AWS CodePipeline:**
```
1. PR opened → Lint, test, security scan
2. PR merged → Build container image
3. Image pushed → ECR with vulnerability scan
4. Staging deployment → Automated integration tests
5. Production deployment → Blue/green with canary
```

### 9.2 Infrastructure as Code

**Terraform modules:**
- `modules/vpc` — Networking
- `modules/aurora` — Database
- `modules/fargate` — Container services
- `modules/s3-worm` — Immutable storage
- `modules/lambda` — Serverless functions

**State management:**
- S3 backend with DynamoDB locking
- Separate state per environment
- Audit log of all changes

### 9.3 Blue/Green Deployment

**Process:**
1. Deploy new version to "green" environment
2. Run smoke tests
3. Shift 5% traffic (canary)
4. Monitor for 10 minutes
5. Shift 100% traffic
6. Keep "blue" for 24h (rollback option)

### 9.4 Canary Releases

**Feature flags:** LaunchDarkly
- Gradual rollout: 1% → 5% → 25% → 100%
- Automatic rollback on error rate > 0.1%
- Targeted rollouts (by tenant tier)

---

## 10. Cost Model

### 10.1 Infrastructure Cost per Tier

**Developer (self-hosted):** $0 (customer pays hosting)

**Team ($49/mo):**
| Component | Monthly Cost |
|-----------|--------------|
| Fargate (avg 2 tasks) | $75 |
| Aurora (serverless) | $45 |
| S3 (10 GB) | $0.23 |
| ElastiCache | $35 |
| CloudFront | $10 |
| **Total** | **~$165** |
| **Margin** | **-70%** (loss leader) |

**Enterprise ($5K-50K/mo):**
| Component | Monthly Cost |
|-----------|--------------|
| Fargate (10-50 tasks) | $400-2000 |
| Aurora (db.r6g.2xlarge) | $800 |
| S3 (100 GB-1 TB) | $2-23 |
| Neptune | $350 |
| ElastiCache (cluster) | $200 |
| CloudFront | $100 |
| **Total** | **~$1,850-3,400** |
| **Margin** | **30-90%** |

**Sovereign (custom):**
- Dedicated infrastructure: $10K+/mo cost
- Pricing: $25K-100K/mo
- Margin: 60-75%

### 10.2 Unit Economics

**Cost per deal room (Team tier):**
- Active room (30 days): ~$6.60
- Break-even: At $49/mo, ~7 active rooms

**Cost per deal room (Enterprise tier):**
- Active room (30 days): ~$0.85
- Break-even: At $5K/mo, ~200 rooms

### 10.3 Scaling Cost Curves

| Rooms | Team Cost | Enterprise Cost |
|-------|-----------|-----------------|
| 10 | $165 | $1,850 |
| 100 | $420 | $2,100 |
| 1,000 | $2,100 | $4,500 |
| 10,000 | $15,000 | $25,000 |

---

## 11. Risk Assessment

### 11.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database corruption | Low | Critical | Multi-AZ, hourly backups, point-in-time recovery |
| Data breach | Low | Critical | Encryption, ABAC, audit logging, bug bounty |
| Regional outage | Medium | High | Multi-region deployment, automatic failover |
| Scaling bottleneck | Medium | Medium | Auto-scaling, sharding, caching layers |
| Dependency failure | Medium | Medium | Circuit breakers, graceful degradation |

### 11.2 Mitigation Strategies

**Security:**
- Penetration testing: Quarterly
- Bug bounty program
- Security training for all engineers
- SOC2 audit: Annual

**Reliability:**
- Chaos engineering: Monthly game days
- Load testing: Before every major release
- Disaster recovery drills: Quarterly

**Compliance:**
- Legal review for all features
- Privacy impact assessments
- Regular compliance audits

---

**End of Document**

*For questions: erik@bettermachine.ai*
