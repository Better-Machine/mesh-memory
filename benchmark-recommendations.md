# Mesh-Memory Benchmark Recommendations
**Date:** 2026-04-26  
**Scope:** Performance testing strategy for mesh-memory  
**Purpose:** Define what to benchmark, how to measure, and success criteria

---

## 1. What to Benchmark

### 1.1 Core Performance Dimensions

| Dimension | Components | Key Metrics |
|-----------|------------|-------------|
| **Throughput** | Token issuance, A2A messages, TKG writes | Operations/second |
| **Latency** | P50, P95, P99 response times | Milliseconds |
| **Scalability** | Performance vs data volume | Degradation curve |
| **Memory** | Heap usage, leak detection | MB/hour growth |
| **Resource** | CPU, disk I/O, connections | Utilization % |
| **Reliability** | Error rates, recovery time | Success rate % |

---

## 2. Specific Benchmark Scenarios

### 2.1 Token Service Performance

**Benchmark:** Token Issuance Rate
```javascript
// benchmark/token-issuance.mjs
import { TokenService } from '../src/token-service.mjs';

async function benchmarkTokenIssuance() {
  const service = new TokenService();
  await service.initialize();
  
  const TARGET_TPS = 1000;  // Target: 1000 tokens/sec
  const DURATION_SECONDS = 60;
  
  const results = [];
  const startTime = Date.now();
  
  // Concurrent issuance test
  const promises = [];
  for (let i = 0; i < TARGET_TPS * DURATION_SECONDS; i++) {
    promises.push(
      service.issueToken(`peer-${i % 100}`, 24)
        .then(token => ({ success: true, latency: Date.now() - startTime }))
        .catch(err => ({ success: false, error: err.message }))
    );
  }
  
  const batchResults = await Promise.all(promises);
  
  // Calculate metrics
  const totalTime = Date.now() - startTime;
  const successful = batchResults.filter(r => r.success).length;
  const latencies = batchResults.filter(r => r.latency).map(r => r.latency);
  
  console.log({
    totalTokens: batchResults.length,
    successRate: successful / batchResults.length,
    actualTps: batchResults.length / (totalTime / 1000),
    p50Latency: percentile(latencies, 0.5),
    p95Latency: percentile(latencies, 0.95),
    p99Latency: percentile(latencies, 0.99)
  });
}
```

**Success Criteria:**
| Metric | Minimum | Target | Stretch |
|--------|---------|--------|---------|
| Throughput | 500 TPS | 1000 TPS | 2000 TPS |
| P95 Latency | < 50ms | < 20ms | < 10ms |
| Error Rate | < 1% | < 0.1% | < 0.01% |

---

### 2.2 Queue Persistence Benchmark

**Benchmark:** WAL Write Throughput
```javascript
// benchmark/wal-throughput.mjs
import { initializeQueuePersistence, persistEvent } from '../src/queue-persistence.mjs';

async function benchmarkWALThroughput() {
  await initializeQueuePersistence();
  
  const BATCH_SIZES = [1, 10, 100, 1000];
  const EVENTS_PER_BATCH = 10000;
  
  for (const batchSize of BATCH_SIZES) {
    const events = generateEvents(EVENTS_PER_BATCH);
    const startMem = process.memoryUsage().heapUsed;
    const startTime = process.hrtime.bigint();
    
    // Process in batches
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      await Promise.all(
        batch.map(e => persistEvent('test-peer', e))
      );
    }
    
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    const memoryDelta = process.memoryUsage().heapUsed - startMem;
    
    console.log(`\nBatch size: ${batchSize}`);
    console.log({
      eventsPerSecond: EVENTS_PER_BATCH / (duration / 1000),
      totalTimeMs: duration.toFixed(2),
      memoryDeltaMB: (memoryDelta / 1024 / 1024).toFixed(2),
      eventsPerSecondPerBatch: (EVENTS_PER_BATCH / batchSize) / (duration / 1000)
    });
  }
}
```

**Success Criteria:**
| Batch Size | Minimum TPS | Target TPS |
|------------|-------------|------------|
| 1 | 100 | 500 |
| 10 | 500 | 2000 |
| 100 | 2000 | 5000 |
| 1000 | 5000 | 10000 |

---

### 2.3 A2A Reliability Benchmark

**Benchmark:** Message Delivery Reliability
```javascript
// benchmark/a2a-reliability.mjs
import { initializeA2AIntegration, send, getDeliveryStatus } from '../src/a2a-integration.mjs';

async function benchmarkA2AReliability() {
  await initializeA2AIntegration({
    sendProvider: mockSendProvider // 5% failure rate
  });
  
  const TOTAL_MESSAGES = 10000;
  const CONCURRENT_CONNECTIONS = 100;
  
  const results = {
    sent: 0,
    delivered: 0,
    failed: 0,
    deadLetter: 0,
    latencies: []
  };
  
  // Simulate burst traffic
  const startTime = Date.now();
  const promises = [];
  
  for (let i = 0; i < TOTAL_MESSAGES; i++) {
    const msgStart = Date.now();
    promises.push(
      send('test-peer', { id: i, data: 'test' }, { guarantee: true })
        .then(async result => {
          results.sent++;
          if (result.deliveryId) {
            // Poll for delivery status
            await waitForDelivery(result.deliveryId, 30000);
            results.delivered++;
          }
          results.latencies.push(Date.now() - msgStart);
        })
        .catch(err => {
          results.failed++;
        })
    );
    
    // Rate limit to avoid overwhelming
    if (promises.length >= CONCURRENT_CONNECTIONS) {
      await Promise.all(promises.splice(0, CONCURRENT_CONNECTIONS));
    }
  }
  
  await Promise.all(promises);
  
  console.log({
    totalTime: Date.now() - startTime,
    successRate: results.delivered / results.sent,
    avgLatency: average(results.latencies),
    p99Latency: percentile(results.latencies, 0.99),
    deadLetterRate: results.deadLetter / TOTAL_MESSAGES
  });
}
```

**Success Criteria:**
| Metric | Minimum | Target |
|--------|---------|--------|
| Delivery Rate | 99% | 99.9% |
| Avg Retry Count | < 2 | < 1.5 |
| Dead Letter Rate | < 1% | < 0.1% |
| P99 Delivery Time | < 30s | < 10s |

---

### 2.4 TKG Query Performance

**Benchmark:** Graph Traversal Scaling
```javascript
// benchmark/tkg-scaling.mjs
import { initializeTKG, assertFact } from '../src/temporal-knowledge-graph.mjs';
import { findPath, getRelatedEntities } from '../src/tkg-queries.mjs';

async function benchmarkTKGScaling() {
  await initializeTKG();
  
  const SIZES = [100, 1000, 10000, 100000];
  
  for (const size of SIZES) {
    console.log(`\n=== Dataset size: ${size} facts ===`);
    
    // Generate test graph
    await generateTestGraph(size);
    
    // Benchmark path finding
    const pathStart = process.hrtime.bigint();
    const path = await findPath('room-test', 'entity-1', `entity-${size}`, 5);
    const pathTime = Number(process.hrtime.bigint() - pathStart) / 1_000_000;
    
    // Benchmark subgraph extraction
    const subgraphStart = process.hrtime.bigint();
    const subgraph = await getRelatedEntities('room-test', 'entity-1', 3);
    const subgraphTime = Number(process.hrtime.bigint() - subgraphStart) / 1_000_000;
    
    console.log({
      facts: size,
      pathFindingMs: pathTime.toFixed(2),
      subgraphExtractionMs: subgraphTime.toFixed(2),
      entitiesInSubgraph: subgraph.entityCount,
      pathFound: !!path
    });
    
    // Memory check
    const memUsage = process.memoryUsage();
    console.log({
      heapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
      rssMB: (memUsage.rss / 1024 / 1024).toFixed(2)
    });
    
    // Cleanup
    await cleanupTestGraph();
  }
}
```

**Success Criteria:**
| Facts | Path Finding | Subgraph (depth=3) |
|-------|--------------|-------------------|
| 1K | < 100ms | < 50ms |
| 10K | < 500ms | < 200ms |
| 100K | < 2s | < 1s |
| 1M | < 10s | < 5s |

---

### 2.5 ABAC Policy Evaluation

**Benchmark:** Policy Matching Performance
```javascript
// benchmark/abac-performance.mjs
import { initializeABAC, evaluate, createPolicy } from '../src/abac-policy-engine.mjs';

async function benchmarkABAC() {
  await initializeABAC();
  
  // Create test policies
  const POLICY_COUNTS = [10, 100, 1000];
  
  for (const count of POLICY_COUNTS) {
    await createTestPolicies(count);
    
    const ITERATIONS = 10000;
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < ITERATIONS; i++) {
      await evaluate(
        { role: 'negotiator', clearance_level: 5, agentId: `agent-${i % 100}` },
        'deal-room:dr_test',
        'propose',
        { roomId: 'dr_test', timestamp: new Date().toISOString() }
      );
    }
    
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    console.log({
      policyCount: count,
      totalTimeMs: duration.toFixed(2),
      evaluationsPerSecond: (ITERATIONS / (duration / 1000)).toFixed(0),
      msPerEvaluation: (duration / ITERATIONS).toFixed(4)
    });
    
    await cleanupPolicies();
  }
}
```

**Success Criteria:**
| Policies | Min Evals/sec | Target Evals/sec |
|----------|---------------|------------------|
| 10 | 10,000 | 50,000 |
| 100 | 5,000 | 20,000 |
| 1000 | 1,000 | 5,000 |

---

## 3. Memory Leak Detection

### 3.1 Long-Running Memory Test
```javascript
// benchmark/memory-leak-test.mjs
async function memoryLeakTest() {
  const DURATION_HOURS = 24;
  const SAMPLE_INTERVAL_MS = 60000; // Every minute
  
  const measurements = [];
  const startTime = Date.now();
  
  while (Date.now() - startTime < DURATION_HOURS * 60 * 60 * 1000) {
    const mem = process.memoryUsage();
    measurements.push({
      timestamp: new Date().toISOString(),
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external
    });
    
    // Generate some load
    await generateLoadForOneMinute();
    
    // Force GC if available (requires --expose-gc flag)
    if (global.gc) {
      global.gc();
      const postGC = process.memoryUsage();
      measurements[measurements.length - 1].heapAfterGC = postGC.heapUsed;
    }
    
    await sleep(SAMPLE_INTERVAL_MS);
  }
  
  // Analyze for leaks
  const analysis = analyzeMemoryTrend(measurements);
  console.log('Memory Leak Analysis:', analysis);
  
  // Success criteria: < 10% growth over 24 hours (after GC)
  if (analysis.growthRate > 0.10) {
    console.error('FAIL: Memory leak detected');
    process.exit(1);
  }
}
```

**Success Criteria:**
- Heap growth rate: < 10% over 24 hours
- No consistent upward trend after GC
- RSS stable within 50% of baseline

---

## 4. Load Testing Scenarios

### 4.1 Spike Test
```javascript
// Sudden traffic spike simulation
async function spikeTest() {
  const BASELINE_TPS = 100;
  const SPIKE_TPS = 10000;
  const SPIKE_DURATION = 60; // seconds
  
  // Baseline
  await runLoad(BASELINE_TPS, 300);
  
  // Spike
  const spikeResults = await runLoad(SPIKE_TPS, SPIKE_DURATION);
  
  // Recovery
  await runLoad(BASELINE_TPS, 300);
  
  // Check spike handling
  if (spikeResults.errorRate > 0.05) {
    console.error('FAIL: Spike caused too many errors');
  }
}
```

### 4.2 Soak Test
```javascript
// Extended running test
async function soakTest() {
  const TPS = 500;
  const DURATION_HOURS = 72;
  
  const results = await runLoad(TPS, DURATION_HOURS * 3600);
  
  // Check for degradation
  const hourlyThroughput = calculateHourlyThroughput(results);
  const degradation = (hourlyThroughput[0] - hourlyThroughput.at(-1)) / hourlyThroughput[0];
  
  if (degradation > 0.20) {
    console.error('FAIL: 20% performance degradation detected');
  }
}
```

---

## 5. Measurement Infrastructure

### 5.1 Metrics Collection
```javascript
// metrics-collector.mjs
class MetricsCollector {
  constructor() {
    this.histograms = new Map();
    this.counters = new Map();
    this.gauges = new Map();
  }
  
  histogram(name, value) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    this.histograms.get(name).push(value);
  }
  
  counter(name, delta = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + delta);
  }
  
  gauge(name, value) {
    this.gauges.set(name, value);
  }
  
  report() {
    const report = {};
    
    for (const [name, values] of this.histograms) {
      report[name] = {
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        p99: percentile(values, 0.99)
      };
    }
    
    report.counters = Object.fromEntries(this.counters);
    report.gauges = Object.fromEntries(this.gauges);
    
    return report;
  }
}
```

### 5.2 Benchmark Reporter
```javascript
// benchmark/reporter.mjs
export class BenchmarkReporter {
  constructor() {
    this.results = [];
  }
  
  record(result) {
    this.results.push({
      ...result,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      arch: process.arch,
      platform: process.platform
    });
  }
  
  generateMarkdownReport() {
    // Generate markdown table for README
  }
  
  compareToBaseline(baselineFile) {
    // Compare against previous runs
  }
  
  saveToFile(filename) {
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
  }
}
```

---

## 6. CI/CD Integration

### 6.1 GitHub Actions Workflow
```yaml
# .github/workflows/benchmark.yml
name: Performance Benchmarks

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0' # Weekly

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run benchmarks
        run: |
          npm run benchmark:token-service
          npm run benchmark:queue-persistence
          npm run benchmark:a2a-reliability
          npm run benchmark:tkg-queries
          npm run benchmark:abac-policy
      
      - name: Compare with baseline
        run: node benchmark/compare-with-baseline.mjs
      
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: benchmark-results
          path: benchmark/results/
      
      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const results = require('./benchmark/results/summary.json');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Benchmark Results\n${JSON.stringify(results, null, 2)}`
            });
```

---

## 7. Success Criteria Summary

### 7.1 Minimum Viable Performance
| Component | Throughput | P95 Latency | Error Rate |
|-----------|------------|-------------|------------|
| Token Service | 500/sec | 50ms | < 1% |
| Queue Persistence | 1000/sec | 100ms | < 0.1% |
| A2A Messaging | 100/sec | 100ms | < 1% |
| TKG Writes | 500/sec | 50ms | < 0.1% |
| ABAC Evaluation | 5000/sec | 10ms | < 0.01% |

### 7.2 Production Target Performance
| Component | Throughput | P95 Latency | Error Rate |
|-----------|------------|-------------|------------|
| Token Service | 2000/sec | 20ms | < 0.1% |
| Queue Persistence | 5000/sec | 50ms | < 0.01% |
| A2A Messaging | 500/sec | 50ms | < 0.1% |
| TKG Writes | 2000/sec | 20ms | < 0.01% |
| ABAC Evaluation | 20000/sec | 5ms | < 0.001% |

### 7.3 Resource Constraints
- **Memory:** < 512MB heap at steady state
- **CPU:** < 50% at target throughput
- **Disk:** < 100 IOPS at target throughput
- **Connections:** < 10 SQLite connections per module

---

## 8. Running Benchmarks

### Quick Test
```bash
npm run benchmark:quick
```

### Full Suite
```bash
npm run benchmark:full
```

### Specific Component
```bash
npm run benchmark:token-service
npm run benchmark:queue-persistence
npm run benchmark:a2a-reliability
npm run benchmark:tkg-queries
npm run benchmark:abac-policy
npm run benchmark:memory-leak
```

### With Profiling
```bash
# CPU profiling
node --cpu-prof benchmark/token-issuance.mjs

# Heap profiling
node --heapsnapshot-near-heap-limit=3 benchmark/memory-leak-test.mjs
```

---

## 9. Next Steps

1. **Create benchmark runner script** (`npm run benchmark`)
2. **Set up baseline measurements** (current performance)
3. **Implement CI integration** (GitHub Actions)
4. **Create performance dashboard** (Grafana/DataDog)
5. **Set up alerts** (performance regression detection)

---

*Benchmarks should be run before each release and on all PRs that touch performance-critical code.*
