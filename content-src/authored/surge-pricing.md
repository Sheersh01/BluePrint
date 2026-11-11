---
title: Surge Pricing
seoTitle: Design Uber's Surge Pricing System
description: Design surge pricing — computing real-time supply and demand per geographic cell from streaming location and request events, and serving price multipliers consistently.
tags: Scaling Writes, Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Uber, Lyft | 0
---

## Understanding the Problem

:::definition ⚡ What is Surge Pricing?
Surge pricing raises ride prices in an area when demand (ride requests) outstrips supply (available drivers), encouraging more drivers to head there and balancing the market.
:::

### Functional Requirements

**Core Requirements**

1. The system should compute a price multiplier (e.g. 1.0×–3.0×) for each geographic area.
2. Multipliers should update every minute or so based on current supply and demand.
3. Riders should see the multiplier when requesting a fare estimate, and it should be honoured for their ride.

**Below the line (out of scope):**

- Machine-learned demand forecasting.
- Driver incentive programs.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Process millions of driver location updates and ride requests per minute.
2. Multipliers fresh within ~1-2 minutes.
3. Fare estimates must read multipliers with low latency (< 50ms) and high availability.
4. A quoted surge must be honoured — the price shown is the price charged.

**Below the line (out of scope):**

- Regulatory price caps per city.

```sketch Surge Pricing Requirements
Functional
- multiplier per area
- refresh every ~minute
- shown + honoured for rides

Non-functional
- millions of events / min
- fresh within 1-2 min
- reads < 50ms, available
- quoted price is honoured
```

## The Set Up

### Defining the Core Entities

1. **Cell**: a geographic area (e.g. an H3 hexagon or geohash).
2. **Supply / demand snapshot**: available drivers and open requests per cell per window.
3. **Surge multiplier**: the current price factor for a cell, with an expiry.
4. **Fare quote**: an estimate that locks in a multiplier for a short time.

### API or System Interface

```
GET  /surge?lat&lng -> { cellId, multiplier, expiresAt }
POST /fare-estimates { "pickup", "dropoff" } -> { quoteId, price, multiplier, validUntil }
```

## High-Level Design

### 1) Compute supply and demand per area

The city is divided into hexagonal cells (H3). Driver location updates and ride requests are published to **Kafka**. A **stream processor** maps each event to its cell and maintains, per cell, counts of available drivers and open requests over a sliding window (e.g. the last 2 minutes).

```diagram Surge computation pipeline
node drivers 0,0.3 box "Driver Apps|location pings"
node riders 0,1.7 box "Rider Apps|requests"
node kafka 1.4,1 circle "Kafka"
node flink 2.8,1 box "Stream Processor|- map to H3 cell|- sliding windows"
node pricer 4.2,1 box "Surge Calculator|- demand/supply|- smoothing"
node redis 5.5,1 circle "Surge Store|(Redis)"
edge drivers -> kafka
edge riders -> kafka
edge kafka -> flink
edge flink -> pricer "supply, demand|per cell"
edge pricer -> redis
```

### 2) Turn supply and demand into a multiplier

Every minute the **Surge Calculator** computes a ratio such as `demand / max(supply, 1)` per cell and maps it to a multiplier via a pricing curve. It smooths changes (limits how fast multipliers rise or fall) and blends neighbouring cells so prices don't jump sharply across a street.

### 3) Show and honour the multiplier

The Fare Service reads the cell's multiplier from Redis (a single key lookup) when creating a quote, stores the quote with that multiplier and a short validity (e.g. 2 minutes), and the ride request references the quote ID — so the rider pays what they saw.

## Potential Deep Dives

### 1) How do we aggregate millions of events into cell counts?

:::solution bad Write every ping to a database and query counts
#### Approach

Insert locations into a table and `COUNT(*)` per cell every minute.

#### Challenges

Millions of writes per minute plus heavy aggregate queries — slow and expensive.
:::

:::solution great Stream processing with keyed windows
#### Approach

Partition the stream by cell ID so each cell's events go to one worker, which keeps windowed counts in memory (Flink keyed state with checkpoints). Deduplicate drivers within a window (a driver pinging 20 times counts once). Emit per-cell aggregates every few seconds.

#### Challenges

Dense downtown cells can be hot partitions; split them into finer resolution cells or sub-partition by driver hash.
:::

### 2) How do we keep prices stable and fair?

Raw ratios are noisy. Apply **exponential smoothing** over recent windows, cap the rate of change per minute, require a minimum number of requests before surging, and spatially smooth across neighbouring hexagons. These reduce flicker that confuses riders and limit manipulation (e.g. drivers going offline together to trigger surge).

### 3) How do we make reads fast and highly available?

Fare estimates happen constantly, so multipliers live in Redis keyed by cell, replicated, with an expiry. If the surge store is unavailable or a value has expired, fall back to **1.0×** — under-charging briefly is far better than failing fare estimates.

:::tip
Lock the multiplier into the quote. Recomputing surge at ride creation would charge riders a price they never saw.
:::

### Final Design

```diagram Final Design
node drivers 0,0.3 box "Driver Apps"
node riders 0,1.7 box "Rider Apps"
node kafka 1.4,1 circle "Kafka"
node flink 2.8,1 box "Stream Processor|keyed by cell"
node pricer 4.2,1 box "Surge Calculator|- smoothing, caps"
node redis 4.2,2.4 circle "Surge Store|(Redis, TTL)"
node fare 2.8,2.4 box "Fare Service|- lock multiplier"
node quotes 1.4,2.8 circle "Quotes DB"
edge drivers -> kafka
edge riders -> kafka
edge kafka -> flink
edge flink -> pricer
edge pricer -> redis
edge fare <-> redis
edge fare -> quotes
edge riders <-> fare "fare estimate"
```

```quiz
[
  {
    "question": "Why divide the city into hexagonal cells like H3?",
    "options": ["They look nice", "Uniform neighbour distances make spatial aggregation and smoothing simpler", "Squares are not allowed", "For encryption"],
    "answer": 1,
    "explanation": "Hexagons have equidistant neighbours, which suits local aggregation."
  },
  {
    "question": "How should a rider's price be guaranteed?",
    "options": ["Recompute surge at ride creation", "Lock the multiplier into a short-lived fare quote", "Charge the highest surge of the day", "Ask the driver"],
    "answer": 1,
    "explanation": "The ride references the quote, so the price shown is the price charged."
  },
  {
    "question": "What should fare estimates do if the surge store is unavailable?",
    "options": ["Fail the request", "Fall back to a 1.0x multiplier", "Use 3.0x", "Wait indefinitely"],
    "answer": 1,
    "explanation": "Availability of fare estimates matters more than briefly missing surge."
  },
  {
    "question": "Why smooth multipliers over time?",
    "options": ["To increase revenue", "Raw ratios are noisy; smoothing prevents flicker and manipulation", "To reduce storage", "It's required by Kafka"],
    "answer": 1,
    "explanation": "Stable prices are fairer and harder to game."
  }
]
```
