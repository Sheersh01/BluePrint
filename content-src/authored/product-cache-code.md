---
title: Product Cache
subtitle: A dictionary cache in front of the database, plus a price-update function. Prices go wrong, memory grows forever, and a popular product can take the database down.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix a Naive Cache-Aside Implementation
description: A code-review interview question — a naive Python cache with stale data, unbounded memory, write-ordering bugs and cache stampedes, and how to fix it with Redis, TTLs and delete-on-write.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
Per-process caches, eviction and TTLs, write ordering (DB first, then invalidate), caching "not found", cache stampedes, shared mutable objects.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| Each server has its own cache | Broadcast updates to every server | **Shared cache (Redis) or short TTL local cache** |
| Cache grows forever | Restart servers regularly | **TTL + bounded size (LRU)** |
| Cache updated before the DB write | Wrap in try/except | **Write DB first, then delete the cache key** |
| A missing product is cached forever | Never cache misses | **Cache "not found" with a short TTL** |
| Hot key expires → DB stampede | Bigger database | **Single-flight lock / refresh ahead / TTL jitter** |

**Mental model (decision tree)**

```
More than one server?
        ↓
  Shared cache, or accept per-server staleness with a short TTL

Data changes?
        ↓
  Write DB → delete key (never update the cache first)

Key can be missing?
        ↓
  Negative cache with a short TTL

Many requests for one key at once?
        ↓
  Single-flight / stale-while-revalidate
```

## 1. The Starting Point

```python
cache = {}

def get_product(product_id):
    if product_id in cache:
        return cache[product_id]

    product = db.query_one("SELECT * FROM products WHERE id = %s", product_id)
    cache[product_id] = product
    return product


def update_price(product_id, new_price):
    cache[product_id]["price"] = new_price
    db.execute("UPDATE products SET price = %s WHERE id = %s", new_price, product_id)
```

## 2. What Most Candidates Catch ✅

### 2.1 `update_price` Crashes on a Cache Miss

`cache[product_id]` raises `KeyError` if the product isn't cached on this server. A price update shouldn't depend on what happens to be in memory.

### 2.2 No Expiry

Nothing ever leaves the cache, so a change made by another process (an admin tool, a batch job) is never picked up.

## 3. What Most Candidates Miss ⚠️

### 3.1 Every Server Has Its Own Truth

```
Server 1: update_price(42, 90)  → its cache: 90
Server 2:                         its cache: 100   ← customers see two prices
Server 3:                         its cache: 100
```

**Fix**: A shared cache (Redis), or — if a per-server cache is needed for speed — a short TTL so divergence is bounded.

### 3.2 Unbounded Memory

One entry per product ever viewed, forever. With a large catalog, the process eventually runs out of memory.

**Fix**: A bounded LRU and/or TTL on every entry.

### 3.3 Cache Written Before the Database

```
cache: price = 90 ✅
DB write fails ❌
→ the cache now says 90; the database says 100
```

**Fix**: Write the database first. Then **delete** the cache key; the next read loads the fresh value.

### 3.4 `None` Is Cached Forever

If product 42 doesn't exist yet, `None` is cached. When it's created, this server never sees it.

**Fix**: Cache "not found" deliberately, with a short TTL (say 30 seconds).

### 3.5 Callers Mutate the Cache

`get_product` returns the cached object itself. Any caller that does `product["price"] *= 0.9` for a discount changes the cached price for everyone.

**Fix**: Store serialized values (as Redis does), or return a copy.

### 3.6 Stampede on a Hot Key

A popular product expires; 5,000 requests per second all miss at once and all query the database.

**Fix**: Single-flight (one request rebuilds, others wait or get stale data), refresh-ahead, and TTL jitter.

## 4. Why Delete Instead of Update?

:::info Interviewer asks
"After a price update, why delete the cache key instead of writing the new price into the cache?"
:::

Two writers updating the cache can finish in the opposite order to their database writes:

```
Writer A: DB = 90 ……………………………… cache = 90
Writer B:        DB = 80 → cache = 80
→ DB says 80, cache says 90 (stale until TTL)
```

Deleting is order-independent: whoever writes, the next reader loads the current database value.

:::tip Say this
"I write the database first and then delete the key. Updating the cache directly can leave it holding an older value when writes race; deleting means the next read always loads what's actually in the database. The TTL is a safety net if a delete is ever lost."
:::

## 5. The Delete Fails

:::info Interviewer asks
"The database update succeeded but deleting the cache key failed. Now what?"
:::

- **The TTL** bounds how long the stale value can live — keep it short for prices.
- **Retry the delete** asynchronously: write an invalidation event to an outbox in the same transaction as the price change, and let a worker delete the key (retrying until it succeeds).
- At larger scale, drive invalidation from **change data capture** (database change stream → cache invalidator), so every change invalidates the cache without application code remembering to.

## 6. Hot Key Stampede

:::info Interviewer asks
"A product goes viral and its cache entry expires. What happens to the database?"
:::

Every request misses simultaneously and runs the same query. Fixes, from simplest:

| Technique | How |
|---|---|
| TTL jitter | Random ±10% on TTLs so keys don't expire together |
| Single-flight lock | `SET lock:product:42 NX EX 5` — only the lock holder queries the DB |
| Serve stale while revalidating | Return the old value while one worker refreshes it |
| Refresh ahead | Rebuild popular keys shortly before they expire |

See [Caching Failure Scenarios](/learn/system-design/tips/caching-failure-scenarios) for the full list.

## 7. Master Interview Answer

:::tip Say this
"The cache is a plain dict per process, so servers disagree, it grows without bound, and nothing ever expires. The update writes the cache before the database, which leaves the cache wrong if the DB write fails, and it crashes on a miss. It also caches 'not found' forever and hands callers the cached object to mutate. I'd use Redis with a TTL on every key, write the database first and then delete the key, cache misses with a short TTL, store serialized values, and protect hot keys with a single-flight lock and TTL jitter."
:::

## 8. The Fixed Code

```python
import json
import random
import time
import redis

r = redis.Redis()
TTL_S = 300
MISSING_TTL_S = 30
MISSING = "__missing__"

def _ttl(base):
    return int(base * random.uniform(0.9, 1.1))            # jitter

def get_product(product_id):
    key = f"product:{product_id}"
    cached = r.get(key)
    if cached is not None:
        return None if cached == MISSING.encode() else json.loads(cached)

    # Single-flight: one request rebuilds, the others briefly wait and re-read
    if not r.set(f"lock:{key}", "1", nx=True, ex=5):
        time.sleep(0.05)
        cached = r.get(key)
        if cached is not None:
            return None if cached == MISSING.encode() else json.loads(cached)

    row = db.query_one(
        "SELECT id, name, price, currency FROM products WHERE id = %s", product_id)
    if row is None:
        r.set(key, MISSING, ex=MISSING_TTL_S)                 # negative cache
        r.delete(f"lock:{key}")
        return None

    product = dict(row)
    r.set(key, json.dumps(product, default=str), ex=_ttl(TTL_S))
    r.delete(f"lock:{key}")
    return product                                         # a fresh copy, not shared


def update_price(product_id, new_price):
    with db.transaction():
        db.execute("UPDATE products SET price = %s WHERE id = %s",
                   new_price, product_id)
        db.execute("INSERT INTO outbox (type, payload) VALUES ('INVALIDATE', %s)",
                   json.dumps({"key": f"product:{product_id}"}))
    r.delete(f"product:{product_id}")   # fast path; outbox worker retries
```

**What changed:** shared Redis cache with TTL and jitter; explicit columns instead of `SELECT *`; negative caching; single-flight lock against stampedes; serialized values so callers can't mutate shared state; DB first, then delete, with an outbox as a retry path.

## 9. The Full Learning Escalation

```
KeyError on a miss
    ↓
TTL / eviction
    ↓
Per-server vs shared cache
    ↓
Write ordering (DB → delete)
    ↓
Negative caching
    ↓
Stampede protection
    ↓
Reliable invalidation (outbox / CDC)
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design the caching layer itself — a distributed cache used by hundreds of services."
:::

That's [Distributed Cache](/learn/system-design/problem-breakdowns/distributed-cache) — consistent hashing, replication, eviction and hot keys. See also the [Scaling Reads](/learn/system-design/patterns/scaling-reads) pattern and [Redis](/learn/system-design/deep-dives/redis).

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Servers disagree | Shared cache or short TTL |
| Memory grows | TTL + LRU bound |
| Cache written before DB | DB first, then delete key |
| Delete lost | TTL + outbox / CDC invalidation |
| Missing rows | Negative cache, short TTL |
| Callers mutate cached object | Serialize / copy |
| Hot key stampede | Single-flight, stale-while-revalidate, jitter |
