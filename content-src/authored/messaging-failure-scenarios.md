---
title: Queue & Messaging Failure Scenarios
subtitle: Duplicates, lost messages, ordering, poison messages and lag — what goes wrong with Kafka, SQS and friends, and the fix for each.
section: tips
category: Tips & Tricks
seoTitle: Message Queue Failure Scenarios and Fixes
description: Duplicate delivery, lost messages, ordering, poison messages, consumer lag and the dual-write problem — the standard fixes for queues and streams in system design interviews.
author: Editorial Team
published: Nov 11, 2026
---

Queues make systems resilient — until the interviewer asks "what if the consumer crashes after doing the work but before acknowledging?" Have these scenarios ready. The flow throughout:

```
Producer → Queue / Topic → Consumer → DB / side effect
```

## The Failure Scenarios

### Scenario 1 — The consumer processes a message, then crashes before acknowledging

```
Consumer: charge card ✓
Consumer: ack ✗ (crash)
Queue:    redeliver → charge card again
```

**Problem:** Almost every broker is **at-least-once**. Redelivery is normal, not a bug.

**Solution:** Make consumers **idempotent**. Store a processed `message_id` (or business key like `order_id`) with a `UNIQUE` constraint in the same transaction as the work; skip if already present.

**Golden rule:** "exactly-once" in practice means *at-least-once delivery + idempotent processing*.

### Scenario 2 — The producer times out and sends the message again

```
Producer → Broker  (stored ✓, ack lost)
Producer → Broker  (retry → duplicate)
```

**Solution:** Idempotent producers (Kafka's `enable.idempotence`), a stable message ID set by the producer, and idempotent consumers as the backstop.

### Scenario 3 — The database write succeeds but publishing the event fails (dual write)

```
Service ── DB ✓
        └─ Queue ✗
```

The order exists, but nothing downstream ever hears about it.

**Solution:** **Transactional outbox** — write the event into an `outbox` table in the same DB transaction, and have a relay publish it. Or use **change data capture** (Debezium) to stream committed changes. Never "write DB, then publish" and hope.

### Scenario 4 — The consumer acknowledges first, then crashes

```
Consumer: ack ✓
Consumer: process ✗ (crash)
```

**Problem:** The message is gone and the work never happened — at-*most*-once.

**Solution:** Acknowledge **after** the work is durably done. Accept duplicates (Scenario 1) instead of losses.

### Scenario 5 — Events for the same entity arrive out of order

```
OrderPaid    → consumer B (fast)
OrderCreated → consumer A (slow)
```

**Solution:**

1. **Partition by entity key** (`order_id`) — Kafka keeps order within a partition, so all events for one order go to one consumer in sequence.
2. **Version / sequence numbers** on events; ignore anything older than what you've applied.
3. Design state machines that tolerate out-of-order events.

### Scenario 6 — One bad message keeps failing (poison message)

```
msg 42 → consumer → exception → retry → exception → retry …
         (queue blocked behind it)
```

**Solution:** Limited retries with backoff, then move it to a **dead-letter queue (DLQ)**. Alert on DLQ size and replay after fixing the bug.

### Scenario 7 — Consumers can't keep up (lag)

```
Producer: 50k msg/s
Consumers: 20k msg/s  → backlog grows forever
```

**Solution:**

1. **Scale consumers** — up to the number of partitions (Kafka) or freely (SQS).
2. **Batch** database writes in the consumer.
3. **Alert on consumer lag**, and plan partitions for peak, not average.
4. If the backlog doesn't matter, **shed or sample** low-value events.

### Scenario 8 — A downstream dependency is down while consuming

**Problem:** Every message fails; retries hammer the dependency.

**Solution:** Pause consumption or use a **circuit breaker**; retry with exponential backoff (delayed queues/retry topics). Messages wait safely in the queue — that's the point of having one.

### Scenario 9 — A message is too large

**Problem:** Brokers cap message size (around 1 MB by default in Kafka; 256 KB in SQS).

**Solution:** **Claim check** — put the payload in object storage and send a pointer (`s3://…/video-123`) in the message.

### Scenario 10 — The broker itself fails

**Solution:** Replicate topics (Kafka replication factor 3, `acks=all`, `min.insync.replicas=2`) so an acknowledged message survives a broker loss. Managed queues (SQS, Pub/Sub) handle this for you.

## Delivery Guarantees at a Glance

| Guarantee | How it happens | Risk | Use for |
|---|---|---|---|
| At-most-once | Ack before processing | Lost messages | Metrics where loss is fine |
| At-least-once | Ack after processing | Duplicates | **Default for almost everything** |
| Effectively exactly-once | At-least-once + idempotent consumer (or Kafka transactions within Kafka) | Complexity | Payments, orders, counters that must be exact |

## Quick Reference

| If the problem is… | Think of… |
|---|---|
| 🔁 Same message processed twice | Idempotent consumer, UNIQUE message_id |
| 📤 DB saved but event not published | Transactional outbox / CDC |
| 🕳️ Message lost after a crash | Ack after processing |
| 🔀 Events out of order | Partition by entity key, version numbers |
| ☠️ One message always fails | Retries + dead-letter queue |
| 🐢 Backlog keeps growing | More consumers/partitions, batching, lag alerts |
| 🚨 Downstream is down | Backoff, circuit breaker, let the queue buffer |
| 🐘 Payload too big | Claim check (object storage pointer) |

## Where to Go Next

- How Kafka actually works: [Kafka](/learn/system-design/deep-dives/kafka).
- Long workflows built on queues: [Multi-step Processes](/learn/system-design/patterns/multi-step-processes).
- The same ideas applied to money: [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios).
