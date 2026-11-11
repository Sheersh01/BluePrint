---
title: Non-Functional Requirements
subtitle: The seven qualities interviewers probe, what each one means in practice, and the levers that improve it.
section: tips
category: Tips & Tricks
seoTitle: Non-Functional Requirements Cheat Sheet for System Design Interviews
description: Latency, scalability, availability, consistency, reliability, durability and security — the techniques behind each, their trade-offs, and how to state them in an interview.
author: Editorial Team
published: Nov 11, 2026
---

Functional requirements say *what* the system does. Non-functional requirements say *how well* — and they're what make one design better than another. Nearly every deep dive in an interview is really one of these seven:

1. Latency / Performance
2. Scalability
3. Availability
4. Consistency
5. Reliability / Fault tolerance
6. Durability
7. Security

## Solving Latency by Layer Targeting

```
Network
  → CDN / Edge / Multi-region / Compression

Database
  → Index / Redis / Read replicas / Partitioning / Sharding

Application
  → Precomputation / Parallelism / Async processing

Microservices
  → Reduce hops / Batch / Parallel calls

Infrastructure
  → Load balancing / Horizontal scaling / Connection pooling
```

## Scalability

| Technique | What you do | Mainly helps | Example | Main drawback |
|---|---|---|---|---|
| **Vertical Scaling** | Make one machine stronger | CPU/RAM/DB capacity | 8 CPU → 32 CPU | Hardware limit, expensive |
| **Horizontal Scaling** | Add more machines | Request/traffic capacity | 2 servers → 20 servers | Distributed-system complexity |
| **Replication** | Keep copies of data | **Read scalability + availability** | 1 primary + 5 replicas | Replication lag, consistency |
| **Partitioning** | Split data into smaller pieces | DB manageability/performance | Orders by month | Query complexity |
| **Sharding** | Partition data across different DB servers | **Write + storage scalability** | Users A–M → DB1, N–Z → DB2 | Cross-shard queries/transactions |
| **Caching** | Keep frequently accessed data in fast storage | Read scalability + latency | Redis | Cache invalidation/stale data |
| **Load Balancing** | Distribute requests across servers | Traffic scalability | LB → 10 API servers | Extra infrastructure |

## Availability vs Consistency

| Data / Feature | Consistency | Availability | Why |
|---|---|---|---|
| Bank balance | 🔴 Very high | High but secondary | Wrong balance = financial loss |
| Payment status | 🔴 Very high | High | Don't show incorrect payment state |
| Money transfer | 🔴 Very high | Secondary | Can't create/lose money |
| Product stock | 🔴 High | High | Overselling is bad |
| Seat booking | 🔴 High | High | Two people shouldn't get same seat |
| User authentication | 🔴 High | High | Security correctness |
| Shopping cart | 🟡 Medium | 🟢 High | Slight staleness often acceptable |
| Social feed | 🟡 Eventual | 🟢 High | Stale feed is acceptable |
| Likes | 🟡 Eventual | 🟢 High | Exact count isn't critical |
| Analytics | 🟡 Eventual | 🟢 High | Data can arrive later |
| Recommendations | 🟢 Eventual | 🟢 High | Slightly old recommendations are fine |
| Search index | 🟡 Eventual | 🟢 High | New item can appear after a delay |

:::tip
Most systems aren't "CP" or "AP" as a whole — pick per feature. A ticketing site can be strongly consistent for seat holds and eventually consistent for the event search page. Saying that out loud is a strong signal.
:::

## Availability in Numbers

Availability is usually quoted in "nines". Know roughly what each one allows:

| Target | Downtime per year | Downtime per month | Typical for |
|---|---|---|---|
| 99% | ~3.65 days | ~7.2 hours | Internal tools, batch jobs |
| 99.9% | ~8.8 hours | ~43 minutes | Most consumer features |
| 99.99% | ~53 minutes | ~4.3 minutes | Payments, login, core APIs |
| 99.999% | ~5 minutes | ~26 seconds | Telecom, critical infrastructure |

**How you get there:** remove single points of failure (redundant instances behind a load balancer, database replicas with failover), spread across availability zones, and degrade gracefully — serve stale cache, queue writes, or turn off non-essential features rather than failing the whole request.

## Reliability / Fault Tolerance

Reliability is "keeps working correctly when parts fail". Assume every network call can fail, hang, or happen twice.

| Failure | Technique | What it buys you |
|---|---|---|
| A call fails transiently | Retry with exponential backoff + jitter | Rides out blips without a thundering herd |
| A call might run twice | Idempotency keys / idempotent consumers | Retries become safe |
| A dependency keeps failing | Circuit breaker | Stops cascading failures and wasted threads |
| A dependency is slow | Timeouts on every call | Threads and connections aren't held hostage |
| One bad dependency starves others | Bulkheads (separate pools per dependency) | A failure stays contained |
| A long workflow dies halfway | Durable state machine / workflow engine / saga | Resume or compensate instead of starting over |
| A traffic spike | Queue + rate limiting / load shedding | Absorb bursts, protect the core |

## Durability

Durability is "once we said it's saved, it stays saved".

| Risk | Technique |
|---|---|
| Process crashes before data hits disk | Write-ahead log, only acknowledge after fsync/commit |
| A disk or machine dies | Replication — acknowledge after a quorum (e.g. 2 of 3) has the write |
| A whole region goes down | Cross-region replication or backups |
| Someone deletes or corrupts data | Point-in-time backups, soft deletes, versioned object storage |
| Events lost between services | Durable log (Kafka) or transactional outbox, not fire-and-forget |

**Rule of thumb:** when the user sees "saved", the write should already be on more than one machine.

## Security

Usually a short mention, unless the problem is about it (auth, payments, healthcare). Hit the basics in one breath:

| Concern | What to say |
|---|---|
| Authentication | Users sign in through an identity provider; services get identity from a token (JWT/session), never from a `userId` in the request body |
| Authorization | Check ownership on every read and write ("can this user see this document?") |
| Data in transit | TLS everywhere, including service-to-service (mTLS in a mesh) |
| Data at rest | Encrypt storage; keep secrets in a secrets manager, not in code |
| Abuse | Rate limiting per user/IP, input validation, signed URLs for uploads/downloads |
| Sensitive data | Minimize what you store; tokenize card numbers; mask PII in logs |

## How to State Them in the Interview

- **Pick 3–5, not all seven.** Choose the ones that make *this* system hard. "Highly scalable and available" fits every system and says nothing.
- **Make them specific.** "Redirects in < 100 ms p99" beats "low latency". "Never double-book a seat" beats "consistent".
- **Name the trade-off.** "Availability over consistency for browsing events, but strong consistency for booking a seat" shows you know you can't have everything everywhere.
- **Put numbers on scale.** Daily users, reads vs writes, data size — it tells the interviewer which deep dives are coming.
- **Use them later.** Each deep dive should point back to one of these: "this is how we hit the 100 ms target".
