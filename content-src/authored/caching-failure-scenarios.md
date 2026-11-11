---
title: Caching Failure Scenarios
subtitle: Stale reads, stampedes, hot keys and a dead cache — what goes wrong once you add Redis, and the fix for each.
section: tips
category: Tips & Tricks
seoTitle: Caching Failure Scenarios and Fixes
description: Ten caching problems interviewers ask about — stale data, races, stampedes, hot keys, penetration, avalanches, cache outages — with the standard fixes.
author: Editorial Team
published: Nov 11, 2026
---

"Add a cache" is the most common answer to "how do we make reads fast?" The follow-up is always "and what can go wrong?" These are the scenarios to have ready. Unless noted, assume **cache-aside**: read the cache, on a miss read the database and fill the cache.

```
Client → Server → Cache ──hit──→ return
                    │
                   miss
                    ▼
                    DB → fill cache → return
```

## The Failure Scenarios

### Scenario 1 — Data changes but the cache still has the old value

```
Server: UPDATE price = 90   (DB ✓)
Cache:  price = 100          (stale)
```

**Problem:** Reads keep returning the old value until the entry expires.

**Solution:** On every write, update the database **then delete** the cache key. The next read refills it. Always set a TTL as a safety net.

**Why delete, not update?** Two concurrent writers updating the cache can leave it with the older value. Deleting can't be out of order in the same way.

### Scenario 2 — A read refills the cache with stale data during a write

```
Reader:  cache miss → reads DB (price = 100) ………………… writes cache (100) ✗
Writer:            → UPDATE price = 90 → DELETE cache
```

The slow reader puts the old value back *after* the writer deleted it.

**Solution:** Short TTLs bound the damage. For stricter needs: **delayed double delete** (delete again a few hundred ms after the write), or store a **version** with the value and only write to the cache if the version is newer.

### Scenario 3 — A popular key expires and everyone hits the database (stampede)

```
key "homepage" expires
   │
1,000 requests miss at once
   │
   ▼
1,000 identical DB queries  →  DB overload
```

**Solution:**

1. **Single-flight / request coalescing** — only one request rebuilds the key (via a short lock), the rest wait or get the stale value.
2. **Refresh ahead** — rebuild hot keys in the background *before* they expire.
3. **Serve stale while revalidating** — return the old value while one worker refreshes it.

### Scenario 4 — Many keys expire at the same moment (avalanche)

You warmed the cache at 9:00 with a 1-hour TTL. At 10:00 everything expires together.

**Solution:** Add **jitter** to TTLs (e.g. 60 min ± 10%) so expirations spread out.

### Scenario 5 — One key gets far more traffic than a single cache node can serve (hot key)

```
celebrity_profile → cache node 3 → 500k req/s → node 3 melts
```

**Solution:**

1. **Local in-process cache** for a few seconds on each app server in front of Redis.
2. **Replicate the hot key** across several keys/nodes (`profile:123#1…#N`) and pick one randomly.
3. **Read replicas** for the cache cluster.

### Scenario 6 — Requests for things that don't exist always miss (penetration)

```
GET /users/999999999   → cache miss → DB miss → return 404
(repeat 10,000×/s from a bot)
```

Every request goes straight to the database because nothing is ever cached.

**Solution:** **Cache the "not found"** (negative caching) with a short TTL, and/or put a **Bloom filter** of valid IDs in front. Plus rate-limit the caller.

### Scenario 7 — The cache cluster goes down

```
Server → Cache ✗
   │
   └─→ every request → DB → overload → outage
```

**Solution:** Your database must survive a cold cache, or you need to protect it:

1. **Circuit breaker + fallback** — degrade (serve partial data, static defaults) instead of sending 100% of traffic to the DB.
2. **Replicated cache** with automatic failover (Redis Sentinel / Cluster).
3. **Warm up** the cache before taking traffic after a restart.

### Scenario 8 — Write-through makes writes slow, write-back loses data

| Strategy | How it writes | Risk |
|---|---|---|
| Cache-aside | App writes DB, deletes cache | Brief staleness |
| Write-through | App writes cache, cache writes DB synchronously | Slower writes |
| Write-back (write-behind) | App writes cache, DB updated later | **Data loss** if the cache dies first |

**Rule:** never use write-back for data you can't afford to lose (money, orders). It's fine for counters and analytics.

### Scenario 9 — The cache fills up

**Problem:** Memory is full; something must go.

**Solution:** Pick an eviction policy on purpose — **LRU** is the usual default; **LFU** suits stable popularity. Size the cache for the hot set (often ~20% of daily reads), and monitor the hit rate.

### Scenario 10 — Values are huge

A 5 MB JSON blob per key means slow network transfers and memory pressure.

**Solution:** Cache smaller pieces (only the fields you need), compress, or cache IDs and fetch details separately. Big media belongs in a CDN, not Redis.

## Quick Reference

| If the problem is… | Think of… |
|---|---|
| 🕰️ Stale data after a write | Update DB, then delete the cache key + TTL |
| 🏃 Old value written back by a slow reader | Short TTL, delayed double delete, versioned values |
| 🐘 Hot key expires, DB gets hammered | Single-flight lock, refresh ahead, serve stale |
| ❄️ Many keys expire together | TTL jitter |
| 🔥 One key gets too much traffic | Local cache, key replication |
| 👻 Lookups for missing data | Negative caching, Bloom filter, rate limit |
| 💥 Cache cluster down | Circuit breaker, replication, warm-up |
| 💾 Can't lose writes | Cache-aside or write-through, never write-back |
| 📦 Memory full | Eviction policy (LRU/LFU), size for hot set |

## Where to Go Next

- The bigger picture on read scaling: [Scaling Reads](/learn/system-design/patterns/scaling-reads).
- How Redis works under the hood: [Redis](/learn/system-design/deep-dives/redis).
