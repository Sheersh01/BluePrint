---
title: Messaging & Streaming
subtitle: Queues, pub/sub, brokers, why Kafka is fast, and windowing in real-time processing.
seoTitle: System Design Interview Questions — Messaging & Real-Time Processing
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 60 | Define | B | What is a message queue, when should you use it, and how does it help system design?
A message queue holds messages from producers until consumers process them, decoupling the two in time and scale.

Use one to:

- **Absorb spikes** — producers keep writing while consumers work through the backlog.
- **Decouple services** — the producer doesn't need the consumer to be up.
- **Run work asynchronously** — send emails, process uploads, update search.
- **Retry reliably** — failed messages are redelivered or sent to a dead-letter queue.

Choices: **SQS** (fully managed, simple queues), **RabbitMQ** (flexible routing, per-message acks), **Kafka** (durable, replayable log with very high throughput and ordering per partition).

**In the interview:** "Uploads enqueue a transcode job; workers scale on queue depth, and failures go to a DLQ."

**Go deeper:** [Message Queue](/learn/system-design/problem-breakdowns/message-queue) · [Kafka](/learn/system-design/deep-dives/kafka)
:::

:::qa 61 | Compare | I | Queue vs publish-subscribe.
In a **queue** (point-to-point), each message is consumed by **one** consumer. Multiple consumers compete for messages, sharing the work — ideal for job processing.

In **publish-subscribe**, each message is delivered to **every** subscriber (or subscriber group). Producers don't know who's listening — ideal for broadcasting events ("order placed") to several independent services.

Kafka combines both: each **consumer group** receives every message (pub/sub between groups), while consumers within a group split partitions (queue semantics within a group).

**In the interview:** "OrderPlaced is published once; billing, email and analytics each subscribe with their own consumer group."
:::

:::qa 62 | Define | I | What is the role of a message broker in event-driven architecture?
A message broker is the intermediary that receives events from producers and delivers them to consumers. In an event-driven architecture, services communicate by emitting and reacting to events rather than calling each other directly.

The broker provides: **decoupling** (producers and consumers don't know about each other), **durability** (events survive consumer downtime), **routing** (topics, exchanges, filters), **delivery guarantees** (acks, retries, ordering), and **buffering** (back-pressure during spikes).

**In the interview:** "Services publish domain events to Kafka; new features subscribe without changing existing services."
:::

:::qa 63 | How | I | Why is Kafka so fast?
- **Sequential disk writes**: each partition is an append-only log; sequential I/O is extremely fast even on spinning disks.
- **OS page cache**: Kafka relies on the operating system's cache instead of its own, so recent data is served from memory.
- **Zero-copy transfer**: data moves from page cache to the network socket without copying through user space (`sendfile`).
- **Batching and compression**: producers and brokers handle messages in batches, amortising overhead.
- **Partitioning**: topics are split across brokers, so throughput scales horizontally.
- **Pull-based consumers** that read sequentially at their own pace.

**In the interview:** "Kafka turns messaging into sequential log appends and reads, batched and served from page cache — that's why one cluster handles millions of messages per second."

**Go deeper:** [Kafka](/learn/system-design/deep-dives/kafka)
:::

:::qa 64 | Define | A | What is windowing in real-time data processing?
Streams are unbounded, so aggregations (counts, sums, averages) are computed over **windows** of time:

- **Tumbling**: fixed, non-overlapping (clicks per minute).
- **Sliding/hopping**: overlapping windows (last 10 minutes, updated every minute).
- **Session**: grouped by activity with gaps of inactivity.

Windows can be based on **processing time** (when events arrive) or **event time** (when they happened). Event time is correct but requires handling late and out-of-order events with **watermarks** and allowed lateness.

**In the interview:** "One-minute tumbling windows in event time, with a 30-second watermark for late clicks; a batch job corrects anything later."

**Go deeper:** [Flink](/learn/system-design/deep-dives/flink)
:::
