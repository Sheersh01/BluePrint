---
title: Google Analytics
seoTitle: Design a Web Analytics Pipeline Like Google Analytics
description: Design Google Analytics — collecting billions of page-view events, a streaming and batch pipeline, pre-aggregated rollups, and fast dashboard queries.
tags: Scaling Writes, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Microsoft, Facebook, Qualtrics, Google | 0
---

## Understanding the Problem

:::definition 📈 What is Google Analytics?
Google Analytics collects events from websites — page views, clicks, sessions — and shows site owners dashboards of traffic, top pages, referrers and user behaviour over time.
:::

### Functional Requirements

**Core Requirements**

1. Websites should be able to send events (page views, custom events) via a tracking script.
2. Site owners should see dashboards: visitors, page views and top pages over a time range.
3. Dashboards should support filtering by dimensions (country, device, referrer).
4. A real-time view should show active users in the last few minutes.

**Below the line (out of scope):**

- Funnel and cohort analysis.
- Ad attribution.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Ingest ~1M events per second at peak without losing data.
2. Dashboards load in < 2 seconds over months of data.
3. Real-time view is fresh within ~30 seconds; historical reports may lag by minutes to hours.
4. Ingestion endpoint must be highly available — the tracking script can't slow down sites.

**Below the line (out of scope):**

- GDPR deletion workflows.

```sketch Analytics Requirements
Functional
- collect events from sites
- dashboards over time ranges
- filter by dimensions
- real-time active users

Non-functional
- 1M events/s, no loss
- dashboards < 2s
- real-time ~30s fresh
- ingestion always available
```

## The Set Up

### Defining the Core Entities

1. **Event**: siteId, eventType, URL, timestamp, visitor ID, dimensions (country, device, referrer).
2. **Session**: a visitor's events grouped by inactivity gaps.
3. **Rollup**: pre-aggregated counts per site, time bucket and dimension.

### API or System Interface

```
POST /collect   (batched events from the tracking script, returns 204 immediately)

GET /sites/:siteId/report?metric=pageviews&from&to&groupBy=country&interval=day
GET /sites/:siteId/realtime -> { activeUsers, topPages }
```

## High-Level Design

### 1) Websites send events

The tracking script batches events and sends them to a lightweight **Collector** fleet behind a load balancer. Collectors validate, enrich (geo from IP, device from user agent), and append to **Kafka**, returning `204` immediately. They hold no state, so they scale horizontally and stay fast.

```diagram Ingestion pipeline
node site 0,1 box "Website|tracking script"
node col 1.3,1 box "Collectors|- validate|- enrich"
node kafka 2.6,1 circle "Kafka"
node stream 3.9,0.3 box "Stream Aggregator|(Flink)"
node lake 3.9,1.7 circle "Raw Events|(S3)"
node olap 5.2,0.3 circle "OLAP Store"
edge site -> col "POST /collect"
edge col -> kafka
edge kafka -> stream
edge kafka -> lake
edge stream -> olap "rollups"
```

### 2) Site owners view dashboards

Scanning raw events for every dashboard load would be far too slow. Instead, a stream processor builds **rollups** — counts per site, per minute/hour/day, per dimension — and writes them to a columnar OLAP store (ClickHouse, Druid, Pinot). Dashboards query rollups, which are orders of magnitude smaller than raw events.

### 3) Real-time active users

The stream processor also maintains a sliding 5-minute window of distinct visitors per site (approximate counting with HyperLogLog), stored in Redis and read by the real-time view.

## Potential Deep Dives

### 1) How do we make dashboard queries fast?

:::solution bad Query raw events
#### Approach

Store every event in a database and aggregate at query time.

#### Challenges

A busy site produces billions of events a month; every dashboard load becomes a huge scan.
:::

:::solution good Pre-aggregated rollups
#### Approach

Maintain counts at minute, hour and day granularity for common dimensions. Long ranges read daily rollups; recent ranges read finer ones.

#### Challenges

Only precomputed dimension combinations are fast; arbitrary filters may need a slower path.
:::

:::solution great Columnar OLAP store with rollups and raw fallback
#### Approach

Store rollups in a columnar OLAP database partitioned by site and time, which aggregates millions of rows per second. Keep raw events in a data lake for ad-hoc queries and for recomputing rollups if logic changes.

#### Challenges

More infrastructure, but it's the standard architecture for analytics at this scale.
:::

### 2) How do we count unique visitors efficiently?

Exact distinct counts require storing every visitor ID per bucket. **HyperLogLog** sketches estimate cardinality within ~1% error in a few kilobytes, and sketches for different hours can be **merged** to get daily or weekly uniques. Use them for dashboards; keep exact counts only where billing requires them.

### 3) How do we avoid losing or double-counting events?

Kafka provides durable buffering when downstream systems are slow. The stream processor checkpoints its state and offsets for exactly-once aggregation, and a daily **batch job** recomputes rollups from the raw data lake to correct anything the streaming path got wrong (late events, bugs).

### Final Design

```diagram Final Design
node site 0,1.2 box "Websites"
node col 1.3,1.2 box "Collectors"
node kafka 2.6,1.2 circle "Kafka"
node flink 3.9,0.3 box "Stream Aggregator|- rollups|- HLL uniques"
node redis 5.2,0.3 circle "Redis|real-time"
node olap 5.2,1.5 circle "OLAP Store|rollups"
node lake 3.9,2.4 circle "Data Lake"
node batch 5.2,2.7 box "Daily Recompute"
node api 6.4,1 box "Query API|+ Dashboards"
edge site -> col
edge col -> kafka
edge kafka -> flink
edge kafka -> lake
edge flink -> redis
edge flink -> olap
edge lake -> batch
edge batch -> olap
edge api <-> olap
edge api <-> redis
```

```quiz
[
  {
    "question": "Why do dashboards read rollups instead of raw events?",
    "options": ["Raw events are encrypted", "Rollups are orders of magnitude smaller, so queries are fast", "Rollups are more accurate", "Raw events can't be stored"],
    "answer": 1,
    "explanation": "Pre-aggregated counts turn huge scans into small lookups."
  },
  {
    "question": "What does HyperLogLog provide?",
    "options": ["Exact unique counts", "Approximate unique counts in tiny, mergeable sketches", "Encryption", "Sorting"],
    "answer": 1,
    "explanation": "HLL estimates cardinality within about 1% using kilobytes of memory."
  },
  {
    "question": "Why should collectors write to Kafka and return immediately?",
    "options": ["To render pages", "So ingestion stays fast and available even if downstream processing is slow", "Kafka is a dashboard", "To deduplicate"],
    "answer": 1,
    "explanation": "The log buffers events durably; processing happens asynchronously."
  },
  {
    "question": "What is the daily batch recompute for?",
    "options": ["Deleting data", "Correcting streaming results using the complete raw data", "Encrypting events", "Sending reports"],
    "answer": 1,
    "explanation": "It fixes late events and processing bugs from the stream path."
  }
]
```
