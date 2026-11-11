---
title: A/B Testing Platform
seoTitle: Design an A/B Testing Platform Like Optimizely
description: Design an experimentation platform — deterministic user bucketing, low-latency assignment, exposure logging, and computing statistically sound results.
tags: Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Affirm | 0
---

## Understanding the Problem

:::definition 🧪 What is an A/B Testing Platform?
An experimentation platform lets product teams show different variants of a feature to different users — say, a green vs. blue checkout button — and measure which performs better on metrics like conversion.
:::

### Functional Requirements

**Core Requirements**

1. Teams should be able to create an experiment with variants and traffic splits (e.g. 50/50).
2. Applications should be able to ask "which variant does this user see?" and get a consistent answer.
3. The platform should record which users were exposed to which variant.
4. Teams should see results: metric differences between variants with statistical significance.

**Below the line (out of scope):**

- Multi-armed bandits and auto-optimisation.
- Visual editors for creating variants.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Assignment adds negligible latency (< 5ms), ideally computed in-process.
2. Assignment is sticky: a user sees the same variant every time.
3. Exposure logging handles billions of events per day without slowing apps.
4. Results are statistically sound — no peeking bias, correct sample ratios.

**Below the line (out of scope):**

- Real-time (sub-minute) results.

```sketch A/B Testing Requirements
Functional
- create experiments + splits
- get variant for user
- log exposures
- results with significance

Non-functional
- assignment < 5ms
- sticky assignment
- billions of exposures/day
- sound statistics
```

## The Set Up

### Defining the Core Entities

1. **Experiment**: name, status, variants with traffic percentages, target audience, primary metrics.
2. **Assignment**: the variant a user gets for an experiment (computed, not stored).
3. **Exposure event**: user, experiment, variant, timestamp.
4. **Metric event**: user actions (purchase, click) used to compute outcomes.

### API or System Interface

```
POST /experiments { "name": "checkout-button", "variants": [{"name":"control","weight":50},{"name":"green","weight":50}] }

// SDK, in-process
getVariant(experimentKey, userId) -> "green"

POST /events/exposure (batched by the SDK)
GET  /experiments/:id/results -> per-variant metrics, confidence intervals
```

## High-Level Design

### 1) Teams create experiments

The **Experiment Service** stores experiment definitions and publishes a versioned **config snapshot** (all active experiments) to a CDN or config store.

### 2) Applications get a consistent variant

The SDK downloads the config snapshot and refreshes it every few seconds. Assignment is **deterministic hashing**: `bucket = hash(experimentId + userId) % 10000`, mapped onto the variant ranges. No network call and no stored assignment table are needed, and the same user always lands in the same bucket.

```diagram Assignment and logging
node app 0,1 box "Application|+ SDK"
node cfg 1.5,0 circle "Config Snapshot|(CDN)"
node exp 3,0 box "Experiment Service"
node col 1.5,2 box "Event Collector"
node kafka 3,2 circle "Kafka"
node wh 4.5,2 circle "Warehouse"
note 0.4,0.1 "hash(expId + userId)|% 10000 -> variant"
edge exp -> cfg "publish"
edge cfg -> app "poll config"
edge app -> col "exposures"
edge col -> kafka
edge kafka -> wh
```

### 3) Record exposures

When the application actually renders the variant, the SDK logs an exposure, batched asynchronously, so logging never blocks the request. Events flow through Kafka into a data warehouse.

### 4) Show results

A daily (or hourly) pipeline joins exposures with metric events per user, aggregates per variant, and computes effect sizes and confidence intervals.

## Potential Deep Dives

### 1) How do we assign variants quickly and consistently?

:::solution bad Random assignment stored per user
#### Approach

On first request, randomly pick a variant and store it in a database; read it on every request.

#### Challenges

A database lookup on every feature check, and a huge assignments table.
:::

:::solution great Deterministic hashing in the SDK
#### Approach

Hash `(experimentSalt, userId)` into buckets and map buckets to variants using the locally cached config. Changing the salt re-randomises a new experiment, so users aren't correlated across experiments. Ramping from 10% to 50% only adds buckets, so existing users keep their variant.

#### Challenges

Changing variant weights mid-experiment reassigns users — the platform should block it or start a new version.
:::

### 2) How do we get trustworthy results?

- Analyse only **exposed** users (those who actually saw a variant), not everyone assigned.
- Check for **sample ratio mismatch**: if a 50/50 test shows 52/48, assignment or logging is broken and results can't be trusted.
- Avoid peeking bias: fix the sample size in advance, or use sequential testing methods that allow continuous monitoring.
- Reduce variance with techniques like CUPED (using pre-experiment behaviour) to reach significance with fewer users.

:::warning
Running many overlapping experiments on the same surface can cause interactions. Use **layers**: experiments in the same layer are mutually exclusive, while different layers are independent.
:::

### 3) How do we handle billions of exposure events?

Deduplicate in the SDK (log an exposure once per user per experiment per session), batch and compress events, and write through Kafka to a columnar warehouse partitioned by date and experiment. Results are computed with pre-aggregation per user before joining, which keeps queries tractable.

### Final Design

```diagram Final Design
node ui 0,0 box "Experiment UI"
node exp 1.5,0 box "Experiment Service"
node cfg 3,0 circle "Config CDN"
node app 3,1.2 box "Apps + SDK|- local hashing|- exposure batching"
node col 1.5,2.4 box "Collectors"
node kafka 3,2.4 circle "Kafka"
node wh 4.5,2.4 circle "Warehouse"
node stats 4.5,1.2 box "Stats Pipeline|- SRM checks|- CUPED"
edge ui <-> exp
edge exp -> cfg
edge cfg -> app
edge app -> col
edge col -> kafka
edge kafka -> wh
edge wh -> stats
edge stats -> exp "results"
```

```quiz
[
  {
    "question": "How can variant assignment be sticky without storing it?",
    "options": ["Cookies only", "Deterministic hashing of experiment salt and user ID", "Random each time", "Database lookups"],
    "answer": 1,
    "explanation": "The same inputs always hash to the same bucket."
  },
  {
    "question": "What does a sample ratio mismatch indicate?",
    "options": ["The variant won", "Assignment or logging is broken, so results can't be trusted", "More traffic is needed", "Nothing"],
    "answer": 1,
    "explanation": "A 50/50 test should show roughly equal exposures."
  },
  {
    "question": "Why analyse only exposed users?",
    "options": ["To reduce cost", "Assigned users who never saw the variant dilute the measured effect", "Exposure is random", "Regulations"],
    "answer": 1,
    "explanation": "Including unexposed users biases results toward zero."
  },
  {
    "question": "Why shouldn't you repeatedly peek and stop when results look significant?",
    "options": ["It's slow", "It inflates false positives unless sequential methods are used", "It changes assignment", "Dashboards break"],
    "answer": 1,
    "explanation": "Multiple looks increase the chance of a spurious win."
  }
]
```
