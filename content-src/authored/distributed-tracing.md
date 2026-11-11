---
title: Distributed Tracing
seoTitle: Design a Distributed Tracing System Like Jaeger or Zipkin
description: Design distributed tracing — propagating trace context across services, collecting spans, sampling strategies, storage, and assembling traces for debugging.
tags: Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Uber, Amazon | 0
---

## Understanding the Problem

:::definition 🧵 What is Distributed Tracing?
In a microservice system, one user request may touch dozens of services. Distributed tracing records each hop as a **span** and links them into a **trace**, so engineers can see exactly where time was spent and where errors occurred — like Jaeger, Zipkin or Datadog APM.
:::

### Functional Requirements

**Core Requirements**

1. Services should record spans (operation, start/end time, tags, errors) for the work they do.
2. Spans from all services involved in one request should be linked into a single trace.
3. Engineers should be able to look up a trace by ID and view it as a timeline.
4. Engineers should be able to search traces by service, operation, duration and error status.

**Below the line (out of scope):**

- Metrics and log aggregation.
- Automatic root-cause analysis.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Negligible overhead on instrumented services (< 1% CPU, no added request latency).
2. Handle millions of spans per second across the fleet.
3. Traces queryable within ~1 minute of the request completing.
4. Losing some spans is acceptable; tracing must never break production traffic.

**Below the line (out of scope):**

- Long-term retention beyond a few weeks.

```sketch Tracing Requirements
Functional
- record spans
- link spans into traces
- view trace timeline
- search traces

Non-functional
- < 1% overhead
- millions of spans/s
- queryable within ~1 min
- lossy is ok, never break prod
```

## The Set Up

### Defining the Core Entities

1. **Trace**: all spans sharing a trace ID.
2. **Span**: spanId, parentSpanId, traceId, service, operation, start, duration, tags, status.
3. **Trace context**: traceId + parent spanId + sampling flag, propagated between services.

### API or System Interface

```
// In-process SDK
span = tracer.startSpan("charge-card", { parent: ctx })
span.setTag("amount", 4999); span.end()

// Propagation header (W3C Trace Context)
traceparent: 00-<traceId>-<parentSpanId>-01

// Query
GET /traces/:traceId
GET /traces?service=checkout&minDuration=500ms&error=true&from&to
```

## High-Level Design

### 1) Services record spans

A tracing SDK (e.g. OpenTelemetry) creates spans around incoming requests and outgoing calls, buffering finished spans in memory and exporting them asynchronously in batches to a local **agent**. Export never blocks the request; if buffers fill, spans are dropped.

### 2) Spans are linked into traces

When service A calls service B, it injects the trace context into request headers. B continues the trace with A's span as its parent. Every span carries the same trace ID, so the backend can reassemble the tree.

```diagram Trace propagation and collection
node a 0,0.3 box "Service A|span 1"
node b 1.4,0.3 box "Service B|span 2 (parent 1)"
node c 2.8,0.3 box "Service C|span 3 (parent 2)"
node agent 1.4,1.6 box "Local Agents"
node coll 2.8,1.6 box "Collectors"
node kafka 4.2,1.6 circle "Kafka"
edge a -> b "traceparent"
edge b -> c "traceparent"
edge a -> agent
edge b -> agent
edge c -> agent
edge agent -> coll
edge coll -> kafka
```

### 3) Look up a trace by ID

Collectors write spans to storage keyed by trace ID (e.g. Cassandra partitioned by traceId, or columnar object storage). Fetching a trace is one partition read; the UI builds the tree from parent IDs and renders a timeline.

### 4) Search traces

An index stores per-trace summaries (root service, operation, duration, error flag, timestamps) for filtering; matching trace IDs are then fetched from span storage.

## Potential Deep Dives

### 1) How do we keep overhead and volume manageable?

:::solution bad Trace every request fully
#### Approach

Record and store 100% of spans.

#### Challenges

Millions of spans per second costs a fortune to store, and most traces are boring successes.
:::

:::solution good Head-based sampling
#### Approach

Decide at the root (e.g. keep 1%) and propagate the decision in the trace context so all services agree.

#### Challenges

Cheap and consistent, but rare errors and slow outliers are mostly discarded before anyone knows they're interesting.
:::

:::solution great Tail-based sampling
#### Approach

Services send all spans to collectors; collectors buffer spans grouped by trace ID for a short window (~10-30s), then decide: keep every trace with errors or high latency, plus a small random sample of normal ones. Route spans for the same trace to the same collector (hash on traceId).

#### Challenges

Collectors need memory to buffer, and late-arriving spans may miss the decision window.
:::

### 2) How do we store and query spans efficiently?

Write spans to a store optimised for appends with TTL-based expiry (e.g. 7-14 days). Partition by trace ID for whole-trace reads. Maintain a separate summary index (service, operation, duration buckets, error, time) — often a columnar store — for search. Derive service dependency graphs and latency histograms with a streaming job over the span stream.

### Final Design

```diagram Final Design
node svcs 0,1.2 box "Services + SDK|- async export"
node agent 1.3,1.2 box "Agents"
node coll 2.6,1.2 box "Collectors|- tail sampling|(by traceId)"
node kafka 3.9,1.2 circle "Kafka"
node spans 5.2,0.4 circle "Span Store|(by traceId, TTL)"
node idx 5.2,2 circle "Trace Index|(summaries)"
node ui 6.4,1.2 box "Query API + UI"
edge svcs -> agent
edge agent -> coll
edge coll -> kafka
edge kafka -> spans
edge kafka -> idx
edge ui <-> spans
edge ui <-> idx
```

```quiz
[
  {
    "question": "How do spans from different services end up in the same trace?",
    "options": ["Matching timestamps", "Propagating trace context (traceId, parent spanId) in request headers", "Same host", "Random chance"],
    "answer": 1,
    "explanation": "Each downstream span inherits the trace ID and records its parent."
  },
  {
    "question": "What is the weakness of head-based sampling?",
    "options": ["It's expensive", "The keep/drop decision happens before you know whether the trace is interesting", "It breaks propagation", "It requires tail collectors"],
    "answer": 1,
    "explanation": "Rare errors and slow traces are mostly dropped."
  },
  {
    "question": "Why route all spans of a trace to the same collector for tail sampling?",
    "options": ["Security", "The collector needs the complete trace to decide whether to keep it", "Lower latency", "It's required by Kafka"],
    "answer": 1,
    "explanation": "Decisions require seeing every span of the trace."
  },
  {
    "question": "What should the SDK do if its export buffer fills up?",
    "options": ["Block the request", "Drop spans", "Crash the service", "Retry synchronously"],
    "answer": 1,
    "explanation": "Tracing must never degrade production traffic."
  }
]
```
