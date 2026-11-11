---
title: Caching & CDN
subtitle: Where caches go, how they stay fresh, the failure modes that hurt, and when not to cache at all.
seoTitle: System Design Interview Questions — Caching & CDN
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 35 | Define | B | What is caching and how does it work? Where do you place a cache?
A cache stores copies of frequently used data in a faster layer so future requests skip the slow source (database, remote API, disk). Reads check the cache first; on a hit, they return immediately; on a miss, they fetch from the source and populate the cache.

Caches exist at every layer:

- **Client** (browser cache, app memory).
- **CDN / edge** for static and shareable content.
- **Application** (in-process cache or a shared Redis/Memcached).
- **Database** (buffer pool, query cache).

**In the interview:** "CDN for media, Redis in front of the database for hot reads, and a short-lived in-process cache for the few hottest keys."

**Go deeper:** [Scaling Reads](/learn/system-design/patterns/scaling-reads) · [Redis](/learn/system-design/deep-dives/redis)
:::

:::qa 36 | How | I | What are the main caching strategies?
- **Cache-aside (lazy loading)**: the app reads the cache, and on a miss reads the DB and fills the cache. On writes, it updates the DB and invalidates the key. Most common; only caches what's used.
- **Read-through**: the cache itself loads from the DB on a miss. Same idea, logic lives in the cache layer.
- **Write-through**: writes go to the cache and DB synchronously. Cache is always fresh; writes are slower.
- **Write-behind (write-back)**: writes go to the cache and are flushed to the DB asynchronously. Very fast writes; risk of losing data if the cache fails before flushing.

**In the interview:** "Cache-aside with TTLs and delete-on-write; write-behind only for data we can afford to lose, like view counters."
:::

:::qa 37 | How | B | What are cache eviction policies?
When the cache is full, an eviction policy decides what to remove:

- **LRU (least recently used)**: evict what hasn't been accessed longest. Great general default.
- **LFU (least frequently used)**: evict what's accessed least often. Keeps long-term popular items, but slow to adapt to changing popularity.
- **FIFO**: evict the oldest inserted. Simple, often worse hit rates.
- **TTL-based expiry** works alongside these to drop stale data.

Real systems approximate: Redis samples keys for approximate LRU/LFU instead of maintaining exact ordering.

**In the interview:** "LRU with TTLs; an exact LRU uses a hash map plus a doubly linked list for O(1) operations."

**Go deeper:** [Distributed Cache](/learn/system-design/problem-breakdowns/distributed-cache)
:::

:::qa 38 | Define | B | What is a cache miss and how can it be minimised?
A cache miss is a request for data that isn't in the cache, forcing a slower fetch from the source. Types: **cold misses** (first access), **capacity misses** (evicted for space), and **invalidation misses** (removed because data changed).

Reduce misses by:

- Sizing the cache to the working set and choosing a good eviction policy.
- **Warming** the cache for predictable hot data (pre-loading before a launch).
- Using sensible TTLs — not so short that data constantly expires.
- Designing **cache keys** that maximise sharing (e.g. snapping locations to cells).
- Caching at a coarser level (whole response vs. many small pieces) where appropriate.

**In the interview:** "We'll monitor hit rate per key pattern and pre-warm the top 1% of keys before traffic spikes."
:::

:::qa 39 | How | I | What is a cache stampede vs a cache avalanche, and how do you prevent each?
A **stampede** (thundering herd) happens when one **hot key** expires and thousands of requests miss simultaneously, all hitting the database for the same data. Prevent it with **request coalescing** (one request refills, others wait), a short lock on refill, or **probabilistic early refresh** before expiry.

An **avalanche** happens when **many keys** expire at the same time (or the cache restarts empty), flooding the database. Prevent it with **TTL jitter** (randomise expiry), staggered warming, persistence or replicas so a cache restart isn't cold, and rate-limiting fallback reads to the database.

**In the interview:** "TTLs get ±10% jitter, and hot keys refill through a single-flight lock so only one request goes to the database."
:::

:::qa 40 | Compare | B | Client-side vs server-side caching.
**Client-side caching** stores data in the browser or app (HTTP cache, localStorage, in-memory). It removes network round trips entirely and cuts server load, but you control it only indirectly (via `Cache-Control`, `ETag`) and can't easily invalidate it.

**Server-side caching** (Redis, in-process, reverse proxy, CDN) is under your control, shared across users, and easy to invalidate — but still costs a network round trip.

Use both: long-lived client caching for immutable assets with versioned URLs, server-side caching for shared dynamic data.

**In the interview:** "Static assets are fingerprinted and cached forever on clients; API responses are cached server-side where we can invalidate them."
:::

:::qa 41 | Compare | I | Local (in-process) cache vs distributed cache.
A **local cache** lives in each application process's memory. Lookups take nanoseconds with no network hop, but each instance has its own copy — more memory overall, lower hit rates, and invalidation across instances is hard.

A **distributed cache** (Redis, Memcached) is a shared service. Every instance sees the same data, capacity scales independently, and invalidation is one operation — at the cost of a network round trip (~0.5-1ms) and another system to run.

They're often layered: a tiny local cache with a short TTL for the hottest keys in front of a distributed cache.

**In the interview:** "Hot config and feature flags are cached in-process for 30s; user data lives in Redis."
:::

:::qa 42 | Decide | I | How do you cache data effectively with Redis and Memcached? When to pick which?
**Memcached** is a simple, multi-threaded, in-memory key-value cache — excellent for plain string/blob caching at very high throughput, with no persistence or rich types.

**Redis** offers data structures (hashes, sorted sets, lists, sets, HyperLogLog, streams), atomic operations, Lua scripting, pub/sub, persistence and replication. It covers caching *and* use cases like leaderboards, rate limiting, locks and queues.

Effective use: choose clear key naming, set TTLs on everything, keep values small, avoid huge keys, and plan for eviction (`allkeys-lru`).

**In the interview:** "Redis by default — we'll likely need sorted sets or atomic counters later. Memcached only if we purely need simple, massive object caching."

**Go deeper:** [Redis](/learn/system-design/deep-dives/redis)
:::

:::qa 43 | Decide | I | In which scenarios is caching NOT a good solution?
- **Data changes constantly** and must be fresh (account balances mid-transfer, stock levels during a flash sale) — the cache is either stale or invalidated so often it's useless.
- **Low hit rate**: every request is unique (long-tail queries, per-user one-off data).
- **Strong consistency required** and invalidation complexity outweighs the gain.
- **Write-heavy workloads** where reads are rare.
- **Cheap source**: the database already answers fast enough; caching just adds complexity and failure modes.
- **Sensitive data** where cached copies increase exposure.

**In the interview:** "I'd skip caching for the booking path — it must be consistent — and cache the event pages instead, where reads dominate."
:::

:::qa 44 | Scenario | I | How do you ensure cache consistency when data changes frequently?
Combine techniques based on how stale data can be:

- **Short TTLs** bound staleness automatically.
- **Invalidate on write**: update the database, then delete the cache key (delete rather than update to avoid races writing stale values).
- **Event-driven invalidation**: change data capture streams DB changes to a worker that invalidates or refreshes keys.
- **Versioning**: include a version in the key (`user:42:v17`) or use ETags, so new versions never collide with stale ones.
- **Write-through** for data that must always be fresh in cache.

**In the interview:** "Delete-on-write plus CDC-driven invalidation, with a 60-second TTL as a safety net if an invalidation is missed."
:::

:::qa 45 | Define | B | What is a CDN and when should you use one?
A content delivery network is a globally distributed network of edge servers that cache content close to users. It cuts latency (shorter distance), offloads origin servers, absorbs traffic spikes and adds a layer of DDoS protection.

Use a CDN for static assets (JS, CSS, images, fonts), video and large downloads, and cacheable API responses shared by many users. It helps least for highly personalised, uncacheable responses — though even those benefit from TLS termination and optimised routing at the edge.

**In the interview:** "All media and static assets go through a CDN with versioned URLs; the origin only sees cache misses."

**Go deeper:** [CDN](/learn/system-design/problem-breakdowns/cdn)
:::

:::qa 46 | How | I | How does a CDN handle static vs dynamic content?
**Static content** (images, scripts, video segments) is cached at the edge according to `Cache-Control` headers, often for a long time with versioned URLs, so nearly every request is a cache hit.

**Dynamic content** is handled differently:

- **Short TTL caching** for responses shared by many users (e.g. a product page cached for 30 seconds).
- **Cache-key tuning**: vary only on what matters (e.g. language), not on cookies.
- **Edge-side includes / composition**: cache the shell, fetch personalised fragments separately.
- **Dynamic acceleration**: even uncacheable requests benefit from TLS termination near the user and optimised, persistent connections back to the origin.
- **Edge compute** for logic like redirects or A/B assignment.

**In the interview:** "The page shell is cached at the edge; personalised parts load from the API, which still benefits from edge TLS termination."
:::
