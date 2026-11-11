---
title: Key-Value Store
seoTitle: Design a Distributed Key-Value Store Like DynamoDB
description: Design a durable distributed key-value store — partitioning with consistent hashing, replication, tunable quorums, conflict resolution, and failure handling.
tags: Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Apple, Google, Canva, Avalara | 2
---

## Understanding the Problem

:::definition 🗝️ What is a Key-Value Store?
A distributed key-value store saves values under keys across many machines — `put(key, value)` and `get(key)` — and keeps working when machines fail. Amazon's Dynamo, Cassandra and Riak are classic examples.
:::

### Functional Requirements

**Core Requirements**

1. Clients should be able to `put(key, value)` and `get(key)`.
2. Clients should be able to `delete(key)`.
3. Data must persist durably across restarts.

**Below the line (out of scope):**

- Range queries and secondary indexes.
- Transactions across multiple keys.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Highly available — reads and writes keep working when nodes or a data center fail.
2. Low latency (single-digit milliseconds at p99) for values up to ~1MB.
3. Horizontally scalable to petabytes and millions of requests per second.
4. Tunable consistency: callers can choose stronger or faster per request.

**Below the line (out of scope):**

- Multi-tenant isolation.

```sketch Key-Value Store Requirements
Functional
- put / get / delete
- durable storage

Non-functional
- highly available
- ms latency
- petabytes, millions of ops/s
- tunable consistency
```

## The Set Up

### Defining the Core Entities

1. **Key / Value**: the data, plus a version (vector clock or timestamp).
2. **Node**: a storage server owning parts of the key space.
3. **Partition**: a range of the hash ring with its replicas.

### API or System Interface

```
PUT    /kv/:key   { "value": "...", "consistency": "QUORUM" }
GET    /kv/:key?consistency=ONE -> { "value", "version" }
DELETE /kv/:key
```

## High-Level Design

### 1) Clients should be able to put and get keys

Keys are hashed onto a **consistent hash ring**. Each key is stored on the first N nodes clockwise from its position (N = replication factor, typically 3). Any node can act as **coordinator**: it receives the request, forwards it to the key's replicas, and waits for enough acknowledgements.

```diagram Replicated writes on a hash ring
node client 0,1 box "Client"
node coord 1.4,1 box "Coordinator Node"
node a 2.9,0.2 circle "Replica A"
node b 2.9,1.2 circle "Replica B"
node c 2.9,2.2 circle "Replica C"
note 3.3,1.2 "W = 2 of N = 3|must ack the write"
edge client <-> coord "put(k, v)"
edge coord -> a
edge coord -> b
edge coord -> c
```

### 2) Data must be durable

Each node writes to an append-only **commit log** first, then into an in-memory table (memtable) that is periodically flushed to immutable sorted files (SSTables) — an LSM tree. Background compaction merges files and drops deleted (tombstoned) keys.

### 3) Clients should be able to delete keys

Deletes write a **tombstone** with a version rather than removing data immediately, so replicas that missed the delete don't resurrect the old value during repair.

## Potential Deep Dives

### 1) How do we choose between consistency and availability?

:::solution good Leader-based replication
#### Approach

One replica per partition is the leader and orders all writes; followers copy them.

#### Challenges

Strong consistency per key, but writes stall during leader failover.
:::

:::solution great Leaderless quorums (Dynamo-style)
#### Approach

Write to all N replicas and wait for W acks; read from R replicas and return the newest version. If **R + W > N**, every read overlaps at least one replica with the latest write. Callers tune per request: `W=1` for fast writes, `R=W=QUORUM` for stronger reads.

#### Challenges

Concurrent writes to the same key can conflict; we need versioning and conflict resolution (below).
:::

### 2) How do we resolve conflicting writes?

:::solution bad Wall-clock last-write-wins
#### Approach

Keep the value with the latest timestamp.

#### Challenges

Clock skew can silently drop a newer write.
:::

:::solution good Hybrid logical clocks with last-write-wins
#### Approach

Use hybrid logical timestamps so ordering respects causality within bounded skew. Simple and good enough for most data.

#### Challenges

Truly concurrent writes still lose one side.
:::

:::solution great Vector clocks with application merge
#### Approach

Each value carries a vector clock. If one version descends from another, keep the newer; if they're concurrent, return both "siblings" to the client to merge (e.g. union of shopping-cart items).

#### Challenges

Pushes merge logic to clients and clocks must be pruned.
:::

### 3) How do we handle node failures?

- **Hinted handoff**: if a replica is down, another node accepts the write with a "hint" and forwards it when the replica returns.
- **Read repair**: when a read sees stale replicas, the coordinator writes the newest version back to them.
- **Anti-entropy**: replicas periodically compare **Merkle trees** of their key ranges and sync only the branches that differ.
- **Gossip**: nodes exchange membership and health state so everyone learns about failures.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client|- token-aware routing"
node coord 1.4,1.2 box "Coordinator|- quorum R/W"
node n1 2.9,0.2 box "Node|commit log + LSM"
node n2 2.9,1.2 box "Node|commit log + LSM"
node n3 2.9,2.2 box "Node|commit log + LSM"
note 4,0.4 "gossip membership"
note 4,1.3 "Merkle-tree anti-entropy"
note 4,2.2 "hinted handoff"
edge client <-> coord
edge coord <-> n1
edge coord <-> n2
edge coord <-> n3
edge n1 <-> n2
edge n2 <-> n3
```

```quiz
[
  {
    "question": "With N=3 replicas, which setting guarantees reads see the latest acknowledged write?",
    "options": ["R=1, W=1", "R=2, W=2", "R=1, W=2", "R=3, W=0"],
    "answer": 1,
    "explanation": "R + W > N ensures read and write sets overlap."
  },
  {
    "question": "Why are deletes written as tombstones?",
    "options": ["To save space", "So replicas that missed the delete don't resurrect old data", "For encryption", "To speed up reads"],
    "answer": 1,
    "explanation": "Tombstones carry a version that wins over the stale value during repair."
  },
  {
    "question": "What is hinted handoff?",
    "options": ["Moving leaders", "Another node temporarily accepts writes for a down replica and forwards them later", "A compaction strategy", "A client SDK feature"],
    "answer": 1,
    "explanation": "It keeps writes available during short outages."
  },
  {
    "question": "What do Merkle trees enable between replicas?",
    "options": ["Encryption", "Efficiently finding and syncing only the key ranges that differ", "Leader election", "Compression"],
    "answer": 1,
    "explanation": "Comparing hashes top-down avoids transferring the whole dataset."
  }
]
```
