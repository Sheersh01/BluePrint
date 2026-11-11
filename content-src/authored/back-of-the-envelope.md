---
title: Back-of-the-Envelope Math
subtitle: The handful of numbers worth memorizing, and quick tricks to turn "100M users" into servers, storage and bandwidth.
section: tips
category: Tips & Tricks
seoTitle: Back-of-the-Envelope Estimation for System Design Interviews
description: Numbers to memorize, latency orders of magnitude, and shortcuts for estimating QPS, storage and bandwidth in a system design interview.
author: Editorial Team
published: Nov 11, 2026
---

Estimation isn't about getting the right number. It's about finding out **which part of the design will hurt** — is this read-heavy? Will the data fit on one machine? Do we need a cache? Do the math only when the answer changes a decision, round aggressively, and say your assumptions out loud.

## Numbers to Memorize

| Fact | Value | Use it for |
|---|---|---|
| Seconds in a day | 86,400 ≈ **10⁵** | Daily volume → per second |
| 1 million / day | ≈ **12 per second** | Quick QPS conversion |
| 1 billion / day | ≈ **12,000 per second** | |
| Peak vs average | **2–3×** average (spikier for events/sales) | Size for peak, not average |
| 1 KB × 1 million | 1 GB | Storage |
| 1 KB × 1 billion | 1 TB | Storage |
| 1 MB × 1 million | 1 TB | Media storage |
| Days in a year | ≈ 400 (for rough math) | Yearly growth |

**Unit ladder:** KB → MB → GB → TB → PB, each ×1000. Thousand → million → billion, each ×1000.

## Latency, by Order of Magnitude

You don't need exact figures — know which ones are 1,000× apart.

| Operation | Roughly |
|---|---|
| Read from memory (RAM) | ~100 ns |
| Read 1 MB sequentially from memory | ~10 µs |
| Random read from SSD | ~100 µs |
| Round trip within a datacenter | ~0.5 ms |
| Redis / Memcached GET (over the network) | ~1 ms |
| Simple indexed database query | ~1–10 ms |
| Read 1 MB sequentially from SSD | ~1 ms |
| Disk seek (spinning HDD) | ~10 ms |
| Round trip across a continent | ~50–100 ms |
| Round trip across the world | ~150–250 ms |

**Takeaways:** memory is ~1000× faster than SSD random reads; a network hop costs about as much as an SSD read; anything crossing an ocean costs hundreds of milliseconds, so put data near users (CDN, regions).

## Rough Capacity of One Box

These vary a lot with hardware and workload — use them to decide *how many*, not as guarantees.

| Component | Ballpark per node |
|---|---|
| Stateless API server | 1k–10k requests/s |
| Relational database (simple queries) | ~5k–20k queries/s; writes lower |
| Redis | ~100k+ ops/s |
| Kafka partition | ~10s of MB/s |
| Single database comfortably holds | ~1–10 TB before you think about sharding |
| Server memory for a cache node | ~64–256 GB |

## The Template

1. **Users → requests.** DAU × actions per user per day ÷ 10⁵ = average QPS. ×2–3 for peak.
2. **Read/write split.** Most consumer systems are 10:1 to 100:1 reads to writes. This decides whether caching and read replicas matter.
3. **Storage.** New items per day × size × retention. Add replication (×3) if it matters.
4. **Bandwidth.** QPS × response size. Large media? Then CDN.
5. **Memory for a cache.** The hot set is often ~20% of daily reads (80/20 rule).

## Worked Example: A Photo Sharing App

Assume 100M DAU, each views 50 photos and uploads 0.1 photos per day; photos average 500 KB.

```
Reads:   100M × 50  = 5B / day  ÷ 10⁵ ≈ 50,000 views/s   (peak ~150k/s)
Writes:  100M × 0.1 = 10M / day ÷ 10⁵ ≈ 100 uploads/s
Ratio:   ~500 : 1 read-heavy  → cache + CDN are essential

Storage: 10M × 500 KB = 5 TB / day  → ~2 PB / year  → object storage (S3), not a DB
Egress:  50,000/s × 500 KB = 25 GB/s → must serve from a CDN
Metadata: 10M rows/day × 1 KB = 10 GB/day → fits in a sharded or large SQL DB
```

Four lines of math just justified object storage, a CDN, a cache, and a metadata database. That's the point.

## Tricks

- **Round to powers of ten.** 86,400 → 100,000. 365 → 400. Nobody will mark you down.
- **Write the units.** "5B views/day" not "5B". Most mistakes are unit slips.
- **Do it when you need it.** It's fine to say "I'll estimate when we hit a decision that depends on it" and come back during the deep dive.
- **State the conclusion, not just the number.** "~25 GB/s of egress, so a CDN isn't optional."
- **Sanity-check against the world.** If your chat app needs more servers than Google, recheck.
