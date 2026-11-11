---
title: Order Event Processing
seoTitle: Design a System to Process and Organise Order Events from an Online Store
description: Design a pipeline that ingests order events from an online store — ordering per order, deduplication, building an up-to-date order view, handling late and out-of-order events, and feeding downstream consumers.
tags: Scaling Writes, Multi-step Processes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🧾 What is Order Event Processing?
An online store's services emit events as each order progresses: `order_placed`, `payment_captured`, `item_picked`, `shipped`, `delivered`, `refunded`. These come from different systems, arrive at different times, sometimes twice, sometimes out of order. The goal is a pipeline that collects them, organises them per order into a correct current state and history, and feeds downstream consumers like customer notifications, analytics and finance.
:::

### Functional Requirements

**Core Requirements**

1. Ingest order events from many producer services.
2. Maintain the current state of each order and its full event history.
3. Let customers and support agents query an order's status and timeline.
4. Deliver events to downstream consumers (notifications, analytics, finance) reliably.
5. Detect stuck orders (e.g. paid but not shipped after 3 days).

**Below the line (out of scope):**

- The checkout flow itself (see E-commerce Checkout).
- Warehouse operations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No event lost; duplicates must not corrupt state.
2. Per-order correctness despite out-of-order arrival.
3. Order status visible within a few seconds of an event.
4. Scale to ~1M orders per day with ~10 events each, and peaks of 10× on sale days.
5. Replayable: we can rebuild views from the event log.

**Below the line (out of scope):**

- Global ordering across all orders (only per-order ordering matters).

```sketch Order Events Requirements
Functional
- ingest from many producers
- current state + history per order
- status queries
- feed downstream consumers
- detect stuck orders

Non-functional
- no loss, duplicates harmless
- correct despite out-of-order
- visible in seconds
- 10x sale-day peaks
- replayable
```

## The Set Up

### Defining the Core Entities

1. **Order event**: event ID, order ID, type, producer, occurred-at timestamp, sequence (if the producer has one), payload.
2. **Order view**: current status, line-item states, totals, last updated.
3. **Order timeline**: ordered list of events for an order.

### API or System Interface

```
(producers) publish to topic "order-events", key = orderId
GET /orders/:id -> { status, items[], timeline[] }
GET /orders?customerId=&status=&cursor=
(consumers) subscribe to "order-events" or "order-status-changed"
```

## High-Level Design

### 1) Ingesting events

Producers publish events to **Kafka**, using the **order ID as the partition key** so all events for one order go to the same partition and stay in the order they were produced. Producers use the **outbox pattern** — writing the event to their own database in the same transaction as the state change — so an event is never lost or emitted for a change that rolled back.

### 2) Building the order view

An **Order Projector** consumes the topic and applies each event to the order's state using a **state machine** (`placed → paid → fulfilling → shipped → delivered`, with `cancelled` and `refunded` branches). It stores the current view and appends the event to the timeline.

```diagram Pipeline
node prod 0,1 box "Producer Services|outbox"
node kafka 1.6,1 box "Kafka|key = orderId"
node proj 3.2,1 box "Order Projector|state machine"
node view 4.8,1 circle "Order Views|+ timeline"
node down 3.2,2.3 box "Downstream Consumers"
edge prod -> kafka
edge kafka -> proj
edge proj -> view
edge kafka -> down
```

### 3) Queries

Customer and support queries read the order view by order ID, or a secondary index by customer. Views live in a document or wide-column store keyed by order ID.

### 4) Downstream consumers and stuck orders

Each downstream system has its own **consumer group**, so a slow analytics job doesn't delay notifications. A **watchdog** periodically queries for orders whose status hasn't advanced within expected time windows and raises alerts or tickets.

## Potential Deep Dives

### 1) How do we handle duplicates and out-of-order events?

:::solution bad Apply events as they arrive
#### Approach

Update the order's status to whatever the latest event says.

#### Challenges

A redelivered `paid` event after `shipped` moves the order backwards; a duplicate refund event counts a refund twice.
:::

:::solution good Deduplicate by event ID
#### Approach

Store processed event IDs per order and skip repeats.

#### Challenges

Duplicates are fixed, but events from different producers can still arrive out of order (`shipped` before `paid` because the payment service lagged).
:::

:::solution great Idempotent state machine with ordering rules
#### Approach

Deduplicate by event ID, and apply events through a **state machine that only moves forward**: a `paid` event arriving after `shipped` is recorded in the timeline but doesn't regress status. Events carry a producer **sequence number or version**, so stale updates from the same producer are ignored. Events that arrive "too early" (an item shipped for an order we haven't seen) are **parked** and retried when the earlier event arrives. The timeline is sorted by `occurredAt`, not arrival time.

#### Challenges

Forward-only rules need careful design for legitimate reversals like returns, which are modelled as new states rather than going back.
:::

### 2) How do we scale for sale-day peaks?

Kafka absorbs bursts; the projector scales by adding consumers up to the number of partitions, so provision partitions for the peak (e.g. 64-128). Because each order is handled by exactly one partition consumer, there are no cross-consumer conflicts. Views are written with batching and conditional writes (version checks) to make reprocessing safe.

:::tip
Mention replay: because Kafka retains the events (or they're archived to object storage), a bug in the projector can be fixed and views rebuilt from scratch by replaying.
:::

### 3) How do we guarantee no events are lost?

The outbox pattern stops producers losing events; Kafka with replication factor 3 and `acks=all` stops the broker losing them; consumers commit offsets **after** writing views, so a crash causes reprocessing (harmless thanks to idempotency) rather than loss. Poison events that keep failing go to a **dead-letter topic** with alerts, instead of blocking the partition.

### Final Design

```diagram Final Design
node prod 0,1 box "Producers|outbox + relay"
node kafka 1.5,1 box "Kafka|order-events"
node proj 3,1 box "Order Projector"
node park 3,-0.3 box "Parked Events"
node views 4.5,1 circle "Order Views"
node api 6,1 box "Order Query API"
node dlq 3,2.3 box "Dead-letter Topic"
node notif 1.5,2.3 box "Downstream|Consumers"
node watch 4.5,-0.3 box "Stuck-order Watchdog"
edge prod -> kafka
edge kafka -> proj
edge proj <-> park
edge proj -> views
edge views -> api
edge proj -> dlq
edge kafka -> notif
edge watch <-> views
```

```quiz
[
  {
    "question": "Why partition order events by order ID?",
    "options": ["For security", "So all events for one order stay in order on one partition", "To balance storage", "Kafka requires it"],
    "answer": 1,
    "explanation": "Per-key ordering is guaranteed within a partition."
  },
  {
    "question": "What does the outbox pattern guarantee?",
    "options": ["Faster events", "An event is published if and only if the state change committed", "Encryption", "Exactly-once delivery to consumers"],
    "answer": 1,
    "explanation": "Writing the event in the same transaction avoids lost or phantom events."
  },
  {
    "question": "How should a duplicate 'paid' event after 'shipped' be handled?",
    "options": ["Set status back to paid", "Deduplicate it and never move the state machine backwards", "Delete the order", "Crash the consumer"],
    "answer": 1,
    "explanation": "Forward-only transitions make late or repeated events harmless."
  },
  {
    "question": "When should consumers commit their offsets?",
    "options": ["Before processing", "After writing the view, accepting reprocessing on crash", "Never", "Once a day"],
    "answer": 1,
    "explanation": "Combined with idempotency, this avoids losing events."
  }
]
```
