---
title: Scaling Writes
subtitle: Handling massive write volume — sharding, partition key choice, batching, write buffers, and write-optimised storage.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Reads can be cached; writes can't. Every like, location update, metric point and click must eventually land somewhere durable. When write volume outgrows a single machine, you need to spread it out, smooth it out, and store it in structures built for fast writes.

## The Problem

A single database primary has a ceiling — tens of thousands of writes per second for a well-tuned relational database. Systems like Uber's location updates (millions per second), metrics ingestion, or ad click tracking blow past that. Writes also arrive in bursts, and a bad partitioning choice can funnel all of them to one hot node.

## The Solution

:::solution good Vertical scaling and write-optimised storage
#### Approach

Before distributing, use the right engine. LSM-tree stores (Cassandra, RocksDB, ScyllaDB) turn random writes into sequential appends and handle far higher write rates than B-tree databases. Time-series databases compress append-only data heavily. A bigger machine buys time.

#### Challenges

There's still a single-node ceiling, and LSM trees trade some read performance and compaction overhead for write speed.
:::

:::solution great Sharding (horizontal partitioning)
#### Approach

Split data across many nodes by a **partition key**, each node owning a subset. Writes for different keys go to different machines, so capacity scales with node count. Consistent hashing lets you add nodes while moving only a fraction of the data.

#### Challenges

Choosing the key is everything. It must spread load evenly *and* keep data that's queried together on the same shard. Cross-shard queries and transactions become expensive.
:::

:::solution great Buffer and batch writes
#### Approach

Put a durable log (Kafka) in front of storage. Producers append quickly; consumers write to the database in large batches at a steady rate. Batching also lets you **aggregate** before writing — 1,000 "+1 view" events become a single "+1000".

#### Challenges

Adds latency between the event and when it's queryable, and you must handle consumer failures without double counting (idempotent or transactional writes).
:::

:::solution great Reduce the writes themselves
#### Approach

Write less: sample or debounce high-frequency updates (only send a location when the driver moved meaningfully), aggregate on the client or edge, and store changes rather than full snapshots.

#### Challenges

Requires understanding which precision the product actually needs.
:::

```diagram Buffered, sharded write path
node clients 0,1 box "Clients|- batch / debounce"
node ing 1.3,1 box "Ingestion|Service"
node kafka 2.6,1 circle "Kafka|(partitioned)"
node agg 3.9,1 box "Aggregating|Consumers"
node s1 5.2,0.2 circle "Shard 1"
node s2 5.2,1.2 circle "Shard 2"
node s3 5.2,2.2 circle "Shard 3"
edge clients -> ing
edge ing -> kafka
edge kafka -> agg
edge agg -> s1
edge agg -> s2
edge agg -> s3
```

## When to Use in Interviews

- [Uber](/learn/system-design/problem-breakdowns/uber) — millions of driver location updates per second.
- [Ad Click Aggregator](/learn/system-design/problem-breakdowns/ad-click-aggregator) — high-volume click events aggregated in streams.
- [Metrics Monitoring](/learn/system-design/problem-breakdowns/metrics-monitoring) — time-series ingestion at 10M points/sec.
- [YouTube Top K](/learn/system-design/problem-breakdowns/youtube-top-k) — counting a firehose of views.
- [FB Post Search](/learn/system-design/problem-breakdowns/fb-post-search) — indexing posts and likes as they arrive.

## Common Deep Dives

### How do you choose a partition key?

Pick a high-cardinality key that matches the access pattern — `userId` for per-user data, `videoId` for per-video counters. Avoid keys like `date` or `country` that funnel lots of writes to a few partitions. Check both the write distribution and how reads will find the data.

### How do you handle a hot key?

Split it: append a random suffix (`video123#0..#9`) so writes spread over ten partitions, and sum the parts on read. Or aggregate in memory and flush periodically, so the hot key sees one write per interval instead of thousands.

### How do you avoid double counting when batching?

Make writes idempotent (dedupe by event ID), or commit consumer offsets and database writes atomically (transactional outbox, Kafka transactions), so a consumer restart doesn't reapply a batch.

## Conclusion

Use write-optimised storage, shard on a well-chosen key, buffer bursts through a durable log, batch and aggregate before writing, and question whether every write is necessary. Hot keys and partition choice are where interviewers will push.

```quiz
[
  {
    "question": "Why do LSM-tree databases handle writes well?",
    "options": ["They keep everything in cache", "They turn random writes into sequential appends", "They avoid disks", "They don't persist data"],
    "answer": 1,
    "explanation": "Writes go to memory and an append-only log, then are flushed and compacted in the background."
  },
  {
    "question": "What makes a good partition key for scaling writes?",
    "options": ["Low cardinality like country", "High cardinality that spreads load evenly and matches access patterns", "The current date", "A constant"],
    "answer": 1,
    "explanation": "Even spread prevents hot shards; matching access patterns keeps queries single-shard."
  },
  {
    "question": "How can you relieve a single hot key?",
    "options": ["Add an index", "Split it with suffixes or aggregate in memory before writing", "Increase TTL", "Use a CDN"],
    "answer": 1,
    "explanation": "Spreading or batching writes keeps one partition from being overwhelmed."
  },
  {
    "question": "What does putting Kafka in front of the database buy you?",
    "options": ["Strong consistency", "Absorbing bursts and enabling batched, steady writes", "Lower storage costs", "Faster reads"],
    "answer": 1,
    "explanation": "The log buffers spikes while consumers write at a sustainable rate."
  }
]
```
