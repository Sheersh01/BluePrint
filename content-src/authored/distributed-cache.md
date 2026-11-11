---
title: Distributed Cache
seoTitle: Design a Distributed Cache Like Redis or Memcached
description: Design a distributed in-memory cache — get/set/delete with TTL, LRU eviction, consistent hashing, replication and hot-key handling.
tags: Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Google, Microsoft | 18
---

## Understanding the Problem

:::definition 🗄️ What is a Distributed Cache?
A distributed cache is an in-memory key-value store spread across many machines. Applications put frequently read data in it to avoid slower databases — think Redis Cluster or Memcached.
:::

### Functional Requirements

**Core Requirements**

1. Clients should be able to `set`, `get`, and `delete` key-value pairs.
2. Clients should be able to set an expiration (TTL) on a key.
3. When memory is full, the cache should evict entries using an LRU policy.

**Below the line (out of scope):**

- Rich data structures (lists, sets, sorted sets).
- Transactions and scripting.
- Durable persistence to disk.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Operations should be extremely fast: < 10ms at p99, typically sub-millisecond on the server.
2. The cache should hold ~1TB of data and serve ~100M requests per second.
3. The system should be highly available and tolerate node failures; eventual consistency between replicas is acceptable.
4. It should scale horizontally by adding nodes.

**Below the line (out of scope):**

- Strong consistency.
- Authentication and multi-tenancy.

```sketch Distributed Cache Requirements
Functional
- get / set / delete
- TTL expiration
- LRU eviction

Non-functional
- < 10ms p99
- 1TB data, 100M req/s
- available, tolerate node failure
- scale horizontally
```

## The Set Up

### Planning the Approach

We'll first design a single cache node that does get, set, TTL and LRU correctly, then work out how to spread data across many nodes and survive failures.

### Defining the Core Entities

1. **Key**: a string identifying an entry.
2. **Value**: opaque bytes.
3. **Entry metadata**: expiration timestamp and recency information for LRU.

```sketch Cache Entities
Core Entities
- Key
- Value
- Expiry + LRU metadata
```

### API or System Interface

```
GET    /:key            -> value | 404
POST   /:key            { "value": "...", "ttl": 60 }
DELETE /:key
```

:::info
Real caches use a compact binary or text protocol over long-lived TCP connections (like RESP for Redis) rather than HTTP — per-request HTTP overhead would dominate sub-millisecond operations.
:::

## High-Level Design

### 1) Clients should be able to get, set and delete

A single node keeps everything in a **hash map** from key to entry, giving O(1) average lookups. A server process accepts connections and executes commands against the map.

### 2) Keys should expire after their TTL

Store an `expiresAt` timestamp with each entry. Use two complementary mechanisms:

1. **Lazy expiration**: on `get`, if the entry is expired, delete it and return a miss.
2. **Active expiration**: a background task periodically samples keys with TTLs and deletes expired ones, so memory isn't held by keys nobody reads.

### 3) The cache should evict least-recently-used entries

Pair the hash map with a **doubly linked list** ordered by recency. Every `get` or `set` moves the entry's node to the head; when memory exceeds the limit, evict from the tail. Both operations are O(1) because the map holds a pointer to each list node.

```diagram Single node: hash map + LRU list
node client 0,1 box "Client"
node node1 1.4,1 box "Cache Node|- hash map|- LRU list|- TTL sweeper"
note 2.2,0.4 "map: key -> listNode"
note 2.2,1.1 "head (most recent) <-> ... <-> tail (evict)"
edge client <-> node1 "get / set / delete"
```

## Potential Deep Dives

### 1) How do we spread data across many nodes?

1TB doesn't fit on one machine, and 100M requests per second needs many CPUs. We need to partition keys across nodes.

:::solution bad Modulo hashing
#### Approach

Route each key to node `hash(key) % N`.

#### Challenges

Adding or removing a single node changes N, which remaps almost every key. The cache is effectively flushed, and the database behind it gets a stampede of misses.
:::

:::solution great Consistent hashing with virtual nodes
#### Approach

Place nodes on a hash ring; each key belongs to the first node clockwise from its hash. Adding or removing a node only moves the keys in its arc (~1/N of the data). Giving each physical node many **virtual nodes** on the ring evens out load and lets bigger machines take more tokens.

#### Challenges

Clients (or a proxy) must know the current ring. Membership changes are propagated via a coordination service (e.g. ZooKeeper/etcd) or gossip, and clients refresh their view.
:::

### 2) How do we survive node failures?

:::solution good Treat the cache as disposable
#### Approach

If a node dies, its keys are simply gone; consistent hashing sends those keys to the next node, which misses and refills from the database.

#### Challenges

A large node failing causes a burst of misses and database load. Acceptable for small clusters, risky at our scale.
:::

:::solution great Primary-replica per shard with automatic failover
#### Approach

Each shard has a primary and one or more replicas. Writes go to the primary and replicate **asynchronously** (we chose availability over consistency). Health checks detect a failed primary and promote a replica; clients update their routing.

#### Challenges

Async replication can lose the last few writes on failover — fine for a cache. Split-brain must be prevented with a quorum-based failure detector.
:::

### 3) How do we handle hot keys?

A single viral key can send millions of requests per second to one shard.

:::solution good Replicate hot keys
#### Approach

Detect hot keys (sampling request counts) and store copies under suffixed keys like `key#1..key#k` on different shards; readers pick one at random. Writes update all copies.

#### Challenges

Writes become k times more expensive and copies can briefly diverge.
:::

:::solution great Client-side near cache for hot keys
#### Approach

Clients keep a tiny local in-process cache with a short TTL (e.g. 1-5 seconds) for keys flagged as hot. Most reads never leave the application server.

#### Challenges

Values can be stale for up to the local TTL. Combine with server-side hot-key replication for the most extreme cases.
:::

### Final Design

```diagram Final Design
node app 0,1.2 box "App Servers|- client lib|- hash ring|- near cache"
node cfg 1.5,0 circle "Config|(etcd)"
node s1 1.8,1 box "Shard A|primary"
node s1r 3,1 box "Shard A|replica"
node s2 1.8,2.2 box "Shard B|primary"
node s2r 3,2.2 box "Shard B|replica"
edge app <-> cfg "ring membership"
edge app <-> s1
edge app <-> s2
edge s1 -> s1r "async repl"
edge s2 -> s2r "async repl"
```

```quiz
[
  {
    "question": "Which pair of data structures gives O(1) get and O(1) LRU eviction?",
    "options": ["Hash map + doubly linked list", "Binary search tree + array", "Heap + queue", "Trie + stack"],
    "answer": 0,
    "explanation": "The map finds the entry instantly; the linked list lets you move it to the head or evict the tail in constant time.",
    "section": "3-the-cache-should-evict-least-recently-used-entries"
  },
  {
    "question": "Why does modulo hashing work poorly when nodes are added or removed?",
    "options": ["It is slow to compute", "Changing N remaps almost every key", "It can't handle strings", "It needs a database"],
    "answer": 1,
    "explanation": "hash % N depends on N, so a membership change moves most keys and effectively flushes the cache.",
    "section": "1-how-do-we-spread-data-across-many-nodes"
  },
  {
    "question": "What do virtual nodes add to consistent hashing?",
    "options": ["Encryption", "More even load distribution across physical nodes", "Strong consistency", "Persistence"],
    "answer": 1,
    "explanation": "Many tokens per machine smooth out the arcs each node owns."
  },
  {
    "question": "Why is lazy expiration alone not enough for TTLs?",
    "options": ["It deletes keys too early", "Expired keys that are never read would keep using memory", "It breaks LRU", "It requires disk"],
    "answer": 1,
    "explanation": "A background sweeper reclaims memory from expired keys nobody reads.",
    "section": "2-keys-should-expire-after-their-ttl"
  }
]
```
