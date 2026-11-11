---
title: Distributed Message Queue
seoTitle: Design a Distributed Message Queue Like RabbitMQ or Kafka
description: Design a distributed message queue — durable topics and partitions, producers and consumer groups, acknowledgements, ordering, retention and replication.
tags: Scaling Writes, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Amazon, Microsoft, Apple, Confluent | 2
---

## Understanding the Problem

:::definition 📨 What is a Distributed Message Queue?
A message queue lets producers send messages that consumers process later, decoupling the two. Systems like RabbitMQ and Kafka do this durably across many machines at very high throughput.
:::

### Functional Requirements

**Core Requirements**

1. Producers should be able to publish messages to a named topic.
2. Consumers should be able to subscribe and receive messages, with multiple consumers sharing the work.
3. Messages should be retained until consumed (or for a configured retention period).
4. Consumers should acknowledge messages; unacknowledged messages are redelivered.

**Below the line (out of scope):**

- Exactly-once transactions across topics.
- Complex routing rules and priorities.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Durable: an acknowledged publish is never lost, even if a broker dies.
2. High throughput: millions of messages per second.
3. Ordering preserved for messages with the same key.
4. Highly available and horizontally scalable.

**Below the line (out of scope):**

- Cross-region replication.

```sketch Message Queue Requirements
Functional
- publish to topic
- consume, shared across consumers
- retention
- ack + redelivery

Non-functional
- durable once acked
- millions msg/s
- per-key ordering
- available, scalable
```

## The Set Up

### Defining the Core Entities

1. **Topic**: a named stream of messages.
2. **Partition**: an ordered, append-only log that holds part of a topic.
3. **Message**: key, payload, offset within its partition.
4. **Consumer group**: consumers that share a topic's partitions, each tracking committed offsets.
5. **Broker**: a server hosting partitions.

### API or System Interface

```
publish(topic, key, payload) -> { partition, offset }
subscribe(topic, groupId) -> stream of messages
commit(topic, partition, offset)
```

## High-Level Design

### 1) Producers publish messages

A topic is split into partitions spread across brokers. The producer hashes the message key to pick a partition (`hash(key) % P`), so all messages for one key land in the same ordered log. The broker appends the message to the partition's log file on disk — sequential writes are fast.

```diagram Topics, partitions and consumer groups
node p 0,1 box "Producers"
node b1 1.5,0.3 box "Broker 1|partition 0, 2"
node b2 1.5,1.7 box "Broker 2|partition 1, 3"
node c1 3,0.3 box "Consumer A|(group X)"
node c2 3,1.7 box "Consumer B|(group X)"
edge p -> b1 "hash(key)"
edge p -> b2
edge b1 -> c1
edge b2 -> c2
```

### 2) Consumers receive and share the work

Within a consumer group, each partition is assigned to exactly one consumer, so the group processes the topic in parallel while each partition stays in order. Consumers **pull** batches from their partitions, which lets them control their own pace.

### 3) Messages are retained and acknowledged

Instead of deleting messages on consumption, the broker keeps the log for a retention period (e.g. 7 days). Each group commits its **offset** — "I've processed everything up to here". If a consumer crashes, its replacement resumes from the last committed offset, so unacknowledged messages are redelivered.

## Potential Deep Dives

### 1) How do we make sure acknowledged messages are never lost?

:::solution bad Write to one broker's memory
#### Approach

Ack as soon as the leader has the message in memory.

#### Challenges

A crash loses everything not yet flushed.
:::

:::solution good Write to disk on the leader
#### Approach

Ack after the leader appends to its log (and fsyncs periodically).

#### Challenges

Survives restarts, but losing the disk or machine still loses data.
:::

:::solution great Replicate partitions and ack after in-sync replicas
#### Approach

Each partition has a leader and followers on other brokers. Followers fetch from the leader; the set that is caught up is the **in-sync replica set (ISR)**. With `acks=all`, the producer is acknowledged only once every ISR member has the message. If the leader fails, a controller promotes an in-sync follower, so no acknowledged message is lost.

#### Challenges

Higher publish latency; set a minimum ISR size so you don't silently fall back to one copy.
:::

### 2) What delivery guarantees can we offer?

:::solution good At-least-once delivery
#### Approach

Consumers commit offsets after processing. A crash between processing and commit redelivers the message.

#### Challenges

Duplicates are possible, so consumers must be idempotent (dedupe by message ID).
:::

:::solution great Effectively-once with idempotent producers and transactions
#### Approach

Producers attach sequence numbers so brokers drop duplicate retries. For read-process-write pipelines, commit output messages and consumer offsets in one transaction.

#### Challenges

More coordination and latency; only worth it where duplicates are costly.
:::

### 3) How do we scale throughput?

Add partitions to spread load across more brokers and consumers (parallelism equals partition count). Batch and compress messages on the producer, and serve consumers straight from the OS page cache with zero-copy transfers. Watch for **hot partitions** caused by skewed keys.

### Final Design

```diagram Final Design
node p 0,1.2 box "Producers|- batching|- idempotent"
node ctrl 1.6,0 box "Controller|(leader election)"
node b1 1.6,1.2 box "Broker|leader P0"
node b2 1.6,2.4 box "Broker|follower P0"
node g1 3.2,0.6 box "Consumer Group X"
node g2 3.2,1.9 box "Consumer Group Y"
node off 4.6,1.2 circle "Committed|Offsets"
edge p -> b1 "acks=all"
edge b1 -> b2 "replicate"
edge ctrl <-> b1
edge ctrl <-> b2
edge b1 -> g1
edge b1 -> g2
edge g1 -> off
edge g2 -> off
```

```quiz
[
  {
    "question": "How does a message queue preserve ordering for a given key?",
    "options": ["Global locks", "All messages with the same key go to the same partition", "Sorting at the consumer", "Timestamps only"],
    "answer": 1,
    "explanation": "Each partition is an ordered log; keyed routing keeps related messages together."
  },
  {
    "question": "What does acks=all with an in-sync replica set guarantee?",
    "options": ["Exactly-once processing", "An acknowledged message survives the loss of the leader", "Lower latency", "Global ordering"],
    "answer": 1,
    "explanation": "Every in-sync replica has the message before the producer is told it's safe."
  },
  {
    "question": "What limits the parallelism of a consumer group?",
    "options": ["Number of brokers", "Number of partitions in the topic", "Message size", "Retention period"],
    "answer": 1,
    "explanation": "Each partition is consumed by at most one consumer in the group."
  },
  {
    "question": "With at-least-once delivery, what must consumers do?",
    "options": ["Process messages twice", "Be idempotent so duplicates are harmless", "Disable commits", "Use bigger batches"],
    "answer": 1,
    "explanation": "A crash before committing an offset causes redelivery."
  }
]
```
