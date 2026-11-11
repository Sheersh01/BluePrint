---
title: Scaling Reads
subtitle: Serving far more reads than writes — indexing, read replicas, caching at every layer, CDNs, and denormalisation.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Most products read far more than they write. A short URL is created once and clicked thousands of times; a tweet is written once and read millions of times. When reads dominate, the job is to make each read cheaper and to stop most of them from reaching your primary database at all.

## The Problem

A single relational database can comfortably serve thousands of indexed reads per second. Read-heavy systems need hundreds of thousands or millions. Throwing bigger hardware at the primary helps briefly, but the database also has to handle writes, and every read competes for the same CPU, memory and disk.

## The Solution

Work through the layers from cheapest to most involved.

:::solution good Optimise the database first
#### Approach

Add the right **indexes** for your query patterns so lookups are O(log n) instead of full scans. **Denormalise** hot read paths — store a precomputed `avg_rating` or `follower_count` rather than computing aggregates on every read. Pick a storage model that fits the access pattern (key-value for lookups by ID).

#### Challenges

Indexes slow writes and use storage; denormalised fields must be kept in sync. But this is the cheapest win and interviewers expect it first.
:::

:::solution good Read replicas
#### Approach

Replicate the primary to several read-only replicas and send reads to them. Throughput scales roughly with the number of replicas.

#### Challenges

Replication is asynchronous, so replicas lag. A user who just wrote may not see their own change — route "read your own writes" to the primary or use session stickiness for a short window.
:::

:::solution great Caching
#### Approach

Put an in-memory cache (Redis or Memcached) in front of the database using **cache-aside**: read from cache, on miss read from the DB and populate the cache with a TTL. Memory reads take microseconds and a single node handles 100k+ ops/sec.

#### Challenges

Invalidation: on writes, delete or update the cached entry. Watch for **stampedes** when a hot key expires (use request coalescing or early refresh) and **hot keys** that overload one cache node (replicate them or add a short-lived local cache).
:::

:::solution great CDNs and edge caching
#### Approach

For content that's the same for many users — images, video, static pages, public API responses — serve it from a CDN close to the user. Most requests never reach your servers.

#### Challenges

Purging stale content takes time across many edge locations; use versioned URLs for assets and short TTLs for dynamic responses.
:::

```diagram Layers of read scaling
node client 0,1 box "Client"
node cdn 1.2,1 circle "CDN"
node app 2.4,1 box "App Servers|+ local cache"
node cache 3.7,0.3 circle "Redis|cache"
node primary 3.7,1.7 circle "Primary DB"
node replica 5,1.7 circle "Read|Replicas"
edge client <-> cdn
edge cdn <-> app "miss"
edge app <-> cache "1. check cache"
edge app <-> replica "2. on miss"
edge primary -> replica "async|replication"
```

## When to Use in Interviews

- [Bitly](/learn/system-design/problem-breakdowns/bitly) — 1000:1 read-to-write ratio; cache the short-code mapping.
- [Ticketmaster](/learn/system-design/problem-breakdowns/ticketmaster) — event pages hammered at on-sale time.
- [Yelp](/learn/system-design/problem-breakdowns/yelp) — search and business pages with precomputed ratings.
- [News Aggregator](/learn/system-design/problem-breakdowns/news-aggregator) — the same feed for everyone, ideal for CDN caching.
- [Instagram](/learn/system-design/problem-breakdowns/instagram) — precomputed feeds and cached posts.

## Common Deep Dives

### How do you keep the cache consistent with the database?

Write to the database first, then invalidate the cache key (delete rather than update, to avoid races writing stale values). TTLs bound how long any inconsistency can last. For stricter needs, use change data capture to drive invalidations.

### What happens when a popular key expires?

Thousands of requests miss at once and stampede the database. Mitigate with request coalescing (one request refills, others wait), probabilistic early refresh before expiry, or never expiring hot keys and refreshing them in the background.

### When is caching the wrong answer?

When data changes constantly and must be fresh (account balances during a transfer), or when the hit rate would be low because every request is unique. Then focus on indexing and replicas instead.

## Conclusion

Start with indexes and denormalisation, add read replicas for throughput, cache aggressively in memory, and push shared content to the edge. Always be ready to explain how you handle staleness and invalidation.

```quiz
[
  {
    "question": "What is the first thing to optimise for a read-heavy database?",
    "options": ["Add a CDN", "Proper indexes and denormalised hot fields", "Shard immediately", "Switch to NoSQL"],
    "answer": 1,
    "explanation": "Indexes and precomputed fields are the cheapest, highest-impact improvements."
  },
  {
    "question": "What is the main trade-off of read replicas?",
    "options": ["They can't serve reads", "Replication lag means replicas may return stale data", "They double write latency", "They require a CDN"],
    "answer": 1,
    "explanation": "Asynchronous replication can hide a user's own recent writes unless reads are routed carefully."
  },
  {
    "question": "In cache-aside, what should happen on a write?",
    "options": ["Nothing", "Write the DB, then invalidate the cache entry", "Write only to the cache", "Flush the whole cache"],
    "answer": 1,
    "explanation": "Invalidating after the DB write keeps the next read from returning stale data."
  },
  {
    "question": "What is a cache stampede?",
    "options": ["Too many cache nodes", "Many requests missing at once when a hot key expires and overwhelming the database", "A cache running out of memory", "A CDN outage"],
    "answer": 1,
    "explanation": "Request coalescing or early refresh prevents the herd of simultaneous misses."
  }
]
```
