---
title: Metrics Monitoring
seoTitle: Design a Metrics Monitoring System Like Datadog
description: Design a metrics monitoring and alerting system — collecting time-series metrics from thousands of hosts, storing them efficiently, querying dashboards and firing alerts.
tags: Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Datadog, Google, Amazon | 13
---

## Understanding the Problem

:::definition 📊 What is a Metrics Monitoring System?
A metrics monitoring system (like Datadog or Prometheus) collects numeric measurements — CPU usage, request latency, error counts — from servers and applications, shows them on dashboards, and alerts engineers when something looks wrong.
:::

### Functional Requirements

**Core Requirements**

1. Services should be able to emit metrics (name, tags, value, timestamp).
2. Users should be able to query metrics over time ranges for dashboards, with aggregation (avg, max, p99) and grouping by tags.
3. Users should be able to define alert rules (e.g. "error rate > 5% for 5 minutes") and be notified when they fire.

**Below the line (out of scope):**

- Logs and distributed tracing.
- Anomaly detection with ML.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Ingest ~10M data points per second from ~100k hosts.
2. Dashboards over the last few hours should load in < 1s.
3. Alerts should fire within ~1 minute of a condition becoming true.
4. Ingestion should be highly available; losing a tiny fraction of points during failures is acceptable, but the pipeline must not fall over.
5. Retain data for a year, at lower resolution for older data.

**Below the line (out of scope):**

- Strong consistency between dashboards.

```sketch Metrics Monitoring Requirements
Functional
- emit metrics (name, tags, value, ts)
- query & aggregate for dashboards
- alert rules + notifications

Non-functional
- 10M points/sec ingest
- dashboards < 1s
- alerts within ~1 min
- highly available ingest
- 1 year retention (downsampled)
```

## The Set Up

### Planning the Approach

This is a **write-heavy time-series** problem. The decisions that matter are how we absorb the ingest rate, how we store points compactly so queries are fast, and how we evaluate alerts continuously without hammering storage.

### Defining the Core Entities

1. **Metric series**: a metric name plus a unique set of tags (e.g. `http.latency{service=api, region=us-east}`).
2. **Data point**: (series, timestamp, value).
3. **Alert rule**: a query, a threshold, a duration, and notification targets.
4. **Alert**: an instance of a rule firing or resolving.

```sketch Metrics Entities
Core Entities
- Metric series (name + tags)
- Data point
- Alert rule
- Alert
```

### API or System Interface

```
POST /metrics
[{ "name": "http.latency", "tags": { "service": "api" }, "value": 123, "ts": 1730700000 }]

GET /query?q=avg:http.latency{service=api} by {region}&from&to&step=60 -> Series[]

POST /alerts
{ "query": "avg:errors.rate{service=api}", "op": ">", "threshold": 0.05, "for": "5m", "notify": ["pagerduty:team-api"] }
```

## High-Level Design

### 1) Services should be able to emit metrics

An **agent** on each host collects local metrics and application metrics, aggregates them over 10 seconds, and sends batches to an **Ingestion Service**. Batching on the host turns millions of tiny writes into far fewer requests.

```diagram Ingest metrics
node hosts 0,1 box "Hosts|+ agent (batch 10s)"
node lb 1.3,1 box "Load Balancer"
node ing 2.5,1 box "Ingestion Service"
node kafka 3.8,1 circle "Kafka"
node writer 3.8,2.2 box "Storage Writers"
node tsdb 5.1,2.2 circle "Time-series DB"
edge hosts -> lb "batched points"
edge lb -> ing
edge ing -> kafka
edge kafka -> writer
edge writer -> tsdb
```

### 2) Users should be able to query metrics for dashboards

A **Query Service** parses queries, fetches the relevant series for the time range from the time-series database, and aggregates them — grouping by tags and rolling up into steps (e.g. one point per minute).

### 3) Users should be able to define alerts

Alert rules are stored in a relational database. An **Alert Evaluator** runs each rule's query on a schedule (e.g. every 30 seconds), tracks how long the condition has held, and sends notifications through a notification service when a rule fires or resolves.

## Potential Deep Dives

### 1) How do we absorb 10M points per second reliably?

:::solution bad Write directly from the API into the database
#### Approach

The Ingestion Service writes each batch synchronously to storage.

#### Challenges

Any storage slowdown backs up ingestion and agents start dropping data. Spikes (a deploy restarting every host) can overwhelm the database.
:::

:::solution great Buffer through a partitioned log
#### Approach

The Ingestion Service validates batches and appends them to **Kafka**, partitioned by series ID so each series is written in order by one consumer. Storage writers consume at their own pace; if storage is slow, Kafka absorbs the backlog for hours. Agents also buffer locally and retry if ingestion is briefly unavailable.

#### Challenges

Data appears on dashboards slightly behind real time (seconds), which is fine. Partition count must be planned for growth.
:::

### 2) How do we store time-series data efficiently?

:::solution bad A row per data point in a relational database
#### Approach

`points(series_id, ts, value)` with an index.

#### Challenges

Billions of rows per day, massive indexes, and slow range scans — row-oriented storage wastes space on repetitive data.
:::

:::solution great A purpose-built time-series store with compression and downsampling
#### Approach

Group points into blocks per series per time window (e.g. 2 hours). Compress timestamps with **delta-of-delta** encoding and values with **XOR (Gorilla) encoding** — regular metrics compress to about 1-2 bytes per point. Keep raw 10s data for ~2 weeks, then **downsample** to 1-minute and 1-hour rollups (min, max, sum, count) for long-term retention. Use an inverted index from tags to series IDs so `{service=api}` finds matching series instantly.

#### Challenges

High-cardinality tags (like `userId`) explode the number of series and the index. Enforce cardinality limits per metric.
:::

:::warning
Cardinality is the number one way monitoring systems fall over in practice. A single metric tagged with a request ID can create millions of series overnight.
:::

### 3) How do we evaluate alerts quickly without hammering storage?

:::solution good Evaluate rules by querying the TSDB on a schedule
#### Approach

Every 30 seconds, run each rule's query against recent data.

#### Challenges

Tens of thousands of rules × frequent queries is a heavy, constant load on the database that dashboards also depend on.
:::

:::solution great Stream evaluation on recent data
#### Approach

Alert evaluators consume the same Kafka stream and maintain in-memory rolling windows for only the series referenced by alert rules. Conditions are evaluated as points arrive; state ("condition true since 12:03") is checkpointed so evaluators can restart without losing track. Rules are sharded across evaluators.

#### Challenges

More complex than polling, and complex queries spanning long windows may still need the TSDB. A hybrid of both is common.
:::

### Final Design

```diagram Final Design
node hosts 0,1.2 box "Hosts + Agents"
node ing 1.3,1.2 box "Ingestion Service"
node kafka 2.6,1.2 circle "Kafka"
node writer 3.9,0.4 box "Storage Writers|- compress blocks"
node tsdb 5.2,0.4 circle "TSDB|+ tag index"
node down 5.2,1.6 box "Downsampler|1m / 1h rollups"
node eval 3.9,2 box "Alert Evaluators|- in-memory windows"
node notif 5.2,2.8 box "Notifications"
node query 3.9,-0.6 box "Query Service"
node dash 2.6,-0.6 box "Dashboards"
edge hosts -> ing
edge ing -> kafka
edge kafka -> writer
edge writer -> tsdb
edge down <-> tsdb
edge kafka -> eval
edge eval -> notif
edge dash <-> query
edge query <-> tsdb
```

```quiz
[
  {
    "question": "Why put Kafka between ingestion and storage?",
    "options": ["To encrypt metrics", "It absorbs spikes and storage slowdowns so ingestion never backs up", "Kafka is a time-series database", "To reduce data size"],
    "answer": 1,
    "explanation": "The log buffers data durably while storage writers catch up.",
    "section": "1-how-do-we-absorb-10m-points-per-second-reliably"
  },
  {
    "question": "What is downsampling?",
    "options": ["Deleting all old data", "Replacing old high-resolution points with coarser rollups like 1-minute min/max/avg", "Sampling hosts randomly", "Compressing JSON"],
    "answer": 1,
    "explanation": "Rollups keep long-term trends at a fraction of the storage.",
    "section": "2-how-do-we-store-time-series-data-efficiently"
  },
  {
    "question": "Why are high-cardinality tags dangerous?",
    "options": ["They are slow to type", "Each unique tag combination creates a new series, exploding storage and index size", "They break dashboards' colours", "They disable alerts"],
    "answer": 1,
    "explanation": "Tags like userId or requestId can create millions of series."
  },
  {
    "question": "Which encoding makes timestamps at regular intervals extremely compact?",
    "options": ["Base64", "Delta-of-delta encoding", "UTF-8", "Gzip of each point"],
    "answer": 1,
    "explanation": "Regular intervals produce deltas-of-deltas of zero, which need almost no bits."
  }
]
```
