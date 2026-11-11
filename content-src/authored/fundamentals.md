---
title: Fundamentals & Performance
subtitle: Scalability, availability, latency and the estimation habits every design conversation leans on.
seoTitle: System Design Interview Questions — Fundamentals & Performance
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 1 | Define | B | What is scalability?
Scalability is a system's ability to handle more load — users, requests, data — by adding resources, while keeping performance acceptable. A scalable system's cost and latency grow roughly in proportion to load rather than falling over at a threshold.

It has several dimensions: **load** (requests per second), **data** (storage growth), and **organisational** (more teams working on it). Scaling usually means removing bottlenecks: stateful servers, a single database, synchronous chains of calls.

**In the interview:** "Scalable means we can add capacity — mostly by adding machines — and throughput rises without latency degrading. I'll look for the component that saturates first."

**Go deeper:** [Scaling Reads](/learn/system-design/patterns/scaling-reads) · [Scaling Writes](/learn/system-design/patterns/scaling-writes)
:::

:::qa 2 | Compare | B | Vertical vs horizontal scaling: benefits and drawbacks of each.
**Vertical scaling** (scale up) means a bigger machine: more CPU, RAM, faster disks. It's simple — no code changes, no distribution problems — but has a hard ceiling, gets expensive at the top end, and the machine remains a single point of failure.

**Horizontal scaling** (scale out) means more machines behind a load balancer. It has practically no ceiling and improves availability, but requires stateless services or partitioned data, and brings distributed-systems problems: consistency, coordination, network failures.

**In the interview:** "Scale stateless services horizontally by default; scale databases vertically as long as you can, then add replicas and shard only when one primary can't keep up."
:::

:::qa 3 | Decide | I | How do you decide between vertical and horizontal scaling for a backend?
Ask three questions:

1. **Is the component stateless?** Stateless app servers scale horizontally trivially — just add instances.
2. **Where's the bottleneck and how far is the ceiling?** A database at 40% of the biggest instance has years of vertical headroom; at 90% of it, plan sharding.
3. **What does availability require?** A single big box is a single point of failure; even when vertical is enough, run at least two.

Vertical wins on simplicity and is often cheaper early on; horizontal wins on ceiling, fault tolerance and elasticity (auto-scaling).

**In the interview:** "App tier: horizontal from day one. Data tier: vertical plus read replicas first, sharding when write volume or dataset size demands it."
:::

:::qa 4 | Compare | B | Latency vs throughput.
**Latency** is how long one operation takes (e.g. p99 of 120ms). **Throughput** is how many operations complete per unit time (e.g. 50k requests/second).

They're related but distinct: batching raises throughput while increasing latency for each item; adding parallel workers raises throughput without changing per-request latency. Always talk about latency in **percentiles** — averages hide the slow tail users actually feel.

**In the interview:** "This read path needs p99 under 100ms; the write path needs throughput of 10k/s but can tolerate seconds of latency, so I'll batch writes."
:::

:::qa 5 | Compare | B | Availability vs reliability.
**Availability** is the fraction of time the system is up and responding (99.9% ≈ 8.8 hours of downtime a year). **Reliability** is whether it does the *right* thing consistently — correct results, no data loss — over time.

A system can be highly available but unreliable (always responds, sometimes with wrong or stale data), or reliable but not highly available (correct, but down for maintenance often). Good designs target both, but sometimes trade one: a payment system prefers refusing requests to processing them incorrectly.

**In the interview:** "For the feed I'll favour availability; for the ledger I'll favour correctness, even if that means rejecting requests during a partition."
:::

:::qa 6 | Define | B | What is high availability and how is it achieved?
High availability (HA) means the system keeps serving despite failures of individual components, typically measured in "nines" (99.99% ≈ 52 minutes of downtime a year).

It's achieved by removing single points of failure:

- **Redundancy** — multiple instances of every component, across availability zones.
- **Health checks** — load balancers stop sending traffic to unhealthy instances.
- **Automatic failover** — replicas promoted when a primary dies.
- **Multi-AZ / multi-region** deployment for larger blast radiuses.
- **Graceful degradation** — serve cached or partial results when a dependency is down.

**In the interview:** "Every tier runs at least two instances across zones behind health-checked load balancers; the database has a synchronous standby with automatic failover."
:::

:::qa 7 | Compare | I | Fault tolerance vs high availability.
**High availability** minimises downtime: when something fails, the system recovers quickly — a brief blip during failover is acceptable.

**Fault tolerance** goes further: the system continues operating *without interruption or data loss* when a component fails, usually through full redundancy running in parallel (e.g. synchronous replication, redundant hardware, consensus with a quorum).

Fault tolerance costs more — duplicated work, extra latency for synchronous replication — so it's reserved for components where any interruption is unacceptable.

**In the interview:** "HA is 'we recover in seconds'; fault tolerance is 'users never notice'. I'd make the payment ledger fault tolerant and the rest highly available."
:::

:::qa 8 | Define | B | What is redundancy and why does it matter for reliability?
Redundancy is having more than one of something — servers, disks, network paths, data copies, even whole regions — so a single failure doesn't take the system down or lose data.

Types: **active redundancy** (all copies serve traffic), **passive/standby** (a copy waits to take over), and **data redundancy** (replication, RAID, backups). Redundancy only helps if failures are *independent*: three replicas in the same rack share a power supply.

**In the interview:** "I'll keep three replicas of the data in different availability zones so a zone outage doesn't lose writes."
:::

:::qa 9 | How | I | What are failover strategies and how do they contribute to availability?
Failover is switching work from a failed component to a healthy one.

- **Cold standby** — a backup is provisioned only on failure. Cheap; minutes to hours of downtime.
- **Warm standby** — a running but idle replica kept up to date; promoted in seconds to minutes.
- **Hot standby / active-active** — replicas already serving traffic; failover is just routing away.

Key mechanics: health checks to detect failure, a way to decide the new leader without split-brain (consensus or a fencing mechanism), and redirecting clients (DNS, load balancer, virtual IP).

**In the interview:** "Database: synchronous hot standby with automatic promotion; app tier: active-active behind a load balancer, so failover is instant."
:::

:::qa 10 | Compare | I | Active-active vs active-passive architectures.
**Active-passive**: one node (or region) serves traffic; the other is a standby that takes over on failure. Simple consistency (one writer), but standby capacity sits idle and failover takes time.

**Active-active**: all nodes/regions serve traffic simultaneously. Better resource use, lower latency for distributed users and near-instant failover — but writes in multiple places need conflict handling or data partitioning (each user "homed" to one region).

**In the interview:** "Stateless services are active-active everywhere. For the database I'd start active-passive across regions; active-active only if we partition users by region or accept conflict resolution."
:::

:::qa 11 | Define | I | What is backpressure?
Backpressure is a way for a slow consumer to signal producers to slow down instead of being overwhelmed. Without it, queues and memory grow until something crashes or latency explodes.

Mechanisms include bounded queues that block or reject when full, TCP flow control, reactive streams' demand signalling, pull-based consumers (consumers fetch at their own pace, as in Kafka), and returning `429`/`503` to callers so they back off.

**In the interview:** "Workers pull from the queue at their own pace, and the ingestion API returns 429 when the queue depth exceeds a threshold, so overload degrades gracefully instead of cascading."
:::

:::qa 12 | How | I | How do you do back-of-the-envelope estimation?
Start from users and work down to resources, rounding aggressively:

1. **Traffic**: daily active users × actions per user ÷ 86,400 ≈ requests per second; multiply by 2-10× for peak.
2. **Storage**: items per day × size × retention.
3. **Bandwidth**: requests per second × payload size.
4. **Read/write ratio** — tells you whether to optimise for caching or write throughput.

Useful anchors: 1 day ≈ 10⁵ seconds; a server handles ~10k simple requests/s; memory access ~100ns, SSD ~100µs, cross-region round trip ~100ms.

**In the interview:** Only estimate what changes a decision — "500M rows × 500 bytes ≈ 250GB, so one database is fine" is valuable; computing bandwidth to three decimals isn't.

**Go deeper:** [Bitly](/learn/system-design/problem-breakdowns/bitly)
:::

:::qa 13 | Compare | B | Stream processing vs batch processing.
**Batch processing** runs over a bounded dataset on a schedule (nightly reports, ETL, model training). It's simple, efficient for large volumes, and easy to re-run — but results are hours old.

**Stream processing** handles unbounded events continuously as they arrive (fraud checks, live dashboards, alerting), with results in seconds. It's harder: state management, late events, exactly-once semantics.

Many systems use both: streaming for fresh approximate results, batch to recompute exact results later.

**In the interview:** "Real-time counts come from the stream; a nightly batch job recomputes from raw data to correct anything the stream got wrong."

**Go deeper:** [Flink](/learn/system-design/deep-dives/flink) · [Ad Click Aggregator](/learn/system-design/problem-breakdowns/ad-click-aggregator)
:::
