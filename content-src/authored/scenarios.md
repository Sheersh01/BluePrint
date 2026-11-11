---
title: Situational Scenarios
subtitle: Failures, traffic spikes, slow databases and migrations — the "what would you do if…" questions.
seoTitle: System Design Interview Questions — Situational Scenarios
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

## Failure handling and resilience

:::qa 87 | Scenario | I | How would you send a message to a web server that has network issues and is not always connected?
Don't push directly and hope — make delivery **durable and retryable**:

- Write the message to a **durable queue or outbox table** first, so it survives the sender restarting.
- A delivery worker sends it when the receiver is reachable, retrying with **exponential backoff and jitter**.
- The receiver **acknowledges** after processing; unacknowledged messages are redelivered, so the receiver must be **idempotent** (dedupe by message ID).
- Alternatively, invert it: the intermittently connected server **pulls** pending messages when it comes online (store-and-forward), which suits devices behind NAT.
- Move messages to a **dead-letter queue** after too many failures and alert.

**In the interview:** "Persist first, deliver with retries and acks, dedupe on the receiver — or let the receiver pull its inbox when it reconnects."
:::

:::qa 88 | Scenario | A | Money is deducted from one account but not credited to the recipient due to a network issue. How do you handle it?
Design so this state is **temporary and self-healing**:

- Record the transfer as a **state machine** (`INITIATED → DEBITED → CREDITED → COMPLETED`) in a durable store before moving money.
- Use **idempotency keys** on every debit/credit call, so retries after a timeout never double-apply.
- A worker resumes stuck transfers: if `DEBITED` but not `CREDITED`, it retries the credit; if the credit permanently fails, it runs a **compensating** refund to the sender (saga).
- Within one database, do debit and credit in a **single ACID transaction** with a double-entry ledger, which avoids the problem entirely.
- Daily **reconciliation** against bank statements catches anything left inconsistent.

**In the interview:** "A timeout isn't a failure — the transfer workflow retries the credit idempotently, compensates if it truly can't complete, and reconciliation is the final safety net."

**Go deeper:** [Payment System](/learn/system-design/problem-breakdowns/payment-system) · [Multi-step Processes](/learn/system-design/patterns/multi-step-processes)
:::

:::qa 89 | Scenario | A | Your microservices are experiencing cascading failures. How do you fix and prevent it?
**Stop the bleeding**: shed load (rate-limit or reject non-critical traffic), disable non-essential features with feature flags, and scale or restart the failing service.

**Prevent recurrence**:

- **Timeouts** on every call — a slow dependency must not hold threads forever.
- **Retries with exponential backoff, jitter and a retry budget**, so retries don't amplify the outage.
- **Circuit breakers** to fail fast when a dependency is unhealthy.
- **Bulkheads**: separate thread/connection pools per dependency so one can't exhaust everything.
- **Fallbacks**: cached or degraded responses instead of errors.
- **Load shedding and backpressure** at the edges.
- **Monitoring and alerting** on latency, saturation and error rates, plus chaos testing.

**In the interview:** "Timeouts plus circuit breakers plus bulkheads contain the blast radius; retry budgets stop retries from turning a slowdown into an outage."
:::

:::qa 90 | Scenario | I | One microservice is very slow because of external API calls. How do you optimise it?
- **Cache** external responses when data allows (with TTLs that match how often it changes).
- **Parallelise** independent calls instead of making them sequentially; use async I/O.
- **Move work off the request path**: return immediately and fetch/process asynchronously, notifying when done.
- **Prefetch or precompute** data you know will be needed.
- **Timeouts, circuit breakers and fallbacks** so a slow vendor degrades gracefully instead of hanging your service.
- **Bulkhead** the external client's connection pool.
- **Batch** requests where the API supports it, and reuse connections (keep-alive).

**In the interview:** "Cache what we can, parallelise what we can't, put a tight timeout and fallback on the rest, and move non-essential calls to a background job."
:::

:::qa 91 | Scenario | I | How do you handle WebSocket reconnection in a real-time dashboard?
- **Detect drops** quickly with heartbeats (ping/pong) on both sides.
- **Reconnect with exponential backoff and jitter** so thousands of clients don't reconnect at the same instant after a server restart.
- **Resume from where you left off**: send the last received sequence number or timestamp on reconnect, and the server replays missed updates (or the client re-fetches a snapshot).
- **Buffer outgoing messages** client-side while disconnected.
- **Graceful UI**: show "reconnecting…" and keep the last data visible, marked as stale.
- **Fall back to polling** (or SSE) if WebSockets keep failing, e.g. behind restrictive proxies.

**In the interview:** "Heartbeats detect the drop, jittered backoff reconnects, and a resume token lets the server replay what the client missed."

**Go deeper:** [Real-time Updates](/learn/system-design/patterns/real-time-updates)
:::

:::qa 92 | Scenario | I | Your service is under a DDoS attack. How do you respond?
- **Absorb at the edge**: put traffic behind a CDN/DDoS protection service with anycast, which spreads volumetric attacks across a global network.
- **Filter**: WAF rules, IP reputation lists, and geo-blocking regions you don't serve.
- **Rate limit** per IP, per token and per endpoint; protect expensive endpoints (search, login) more aggressively.
- **Challenge** suspicious clients with CAPTCHAs or JavaScript challenges.
- **Scale and shed**: autoscale stateless tiers, serve cached content, and degrade non-essential features.
- Coordinate with your provider, and afterwards review logs to refine rules.

**In the interview:** "The defence is layered: anycast CDN absorbs volume, WAF and rate limits filter application-layer floods, and the origin only accepts traffic from the CDN."
:::

:::qa 93 | Scenario | A | How would you design a system that needs 99.99% availability?
99.99% allows ~52 minutes of downtime a year, so failures must be handled automatically:

- **No single points of failure**: redundancy at every tier across availability zones.
- **Multi-region** active-active (or fast active-passive) with automated failover and data replicated across regions.
- **Health checks and automatic recovery** everywhere; no manual steps on the critical path.
- **Graceful degradation**: core functions keep working when optional dependencies fail.
- **Safe deploys**: canaries, progressive rollout, instant rollback — most outages are self-inflicted changes.
- **Capacity headroom** to survive losing a zone or region.
- **Chaos engineering** and game days to prove failover works.
- Remember dependencies multiply: five services at 99.99% each give ~99.95% overall.

**In the interview:** "Availability is mostly about change management and automated failover — I'd invest in multi-AZ redundancy, canary deploys and regular failover drills."
:::

## Traffic and load

:::qa 94 | Scenario | I | A big Friday sale is coming for your e-commerce app. What preparations do you make?
- **Forecast and load test** at 2-3× expected peak, including dependencies (payments, search, inventory).
- **Pre-scale** instances and databases ahead of time — autoscaling reacts too slowly to a sudden opening spike.
- **Warm caches and the CDN** for sale pages and product data.
- **Protect the critical path**: checkout gets priority; disable or degrade non-essential features (recommendations, reviews) with **feature flags**.
- **Queue and rate-limit**: a virtual waiting room for hot items, retries with exponential backoff on clients.
- **Code freeze** before the event, with rollback plans and on-call staffed.
- Have **database fallbacks** (read replicas, connection limits) and dashboards for real-time monitoring.

**In the interview:** "Pre-scale, pre-warm, protect checkout with flags and a waiting room, and freeze code — the sale is not the day to deploy."

**Go deeper:** [Flash Sale](/learn/system-design/problem-breakdowns/flash-sale)
:::

:::qa 95 | Scenario | I | How do you handle a sudden 10x traffic spike?
- **Auto-scale** stateless tiers (with headroom, since scaling takes minutes).
- **Serve from cache and CDN** wherever possible; raise TTLs temporarily.
- **Shed load gracefully**: rate-limit, return 429/503 for non-critical requests, and prioritise core flows.
- **Queue non-urgent work** (emails, analytics, image processing) to process later.
- **Circuit breakers and timeouts** so overloaded dependencies fail fast instead of cascading.
- **Degrade features** with feature flags (turn off expensive personalisation).
- Afterwards, analyse the bottleneck that saturated first and fix it.

**In the interview:** "Absorb with caches and autoscaling, protect the core with load shedding, and defer everything that doesn't need to happen right now."
:::

## Data and performance troubleshooting

:::qa 96 | Scenario | I | Your application database is becoming a bottleneck. What steps do you take?
Work from cheapest to most invasive:

1. **Measure**: find the slow queries and resource that's saturated (CPU, IO, connections, locks).
2. **Fix queries and indexes** — most bottlenecks are missing indexes or N+1 queries.
3. **Connection pooling** (PgBouncer) if connection count is the problem.
4. **Cache** hot reads in Redis.
5. **Read replicas** for read-heavy load.
6. **Vertical scale** the primary.
7. **Move workloads**: analytics to a warehouse, search to Elasticsearch, logs to a separate store.
8. **Partition or shard** only when writes or data size exceed a single primary.

**In the interview:** "Profile first — I'd expect indexes and caching to buy most of the headroom before we consider sharding."
:::

:::qa 97 | Scenario | I | How do you design a database schema for millions of users without performance issues?
- **Model around access patterns**: know the top queries and index for them (composite indexes in query order).
- **Normalise first** for correctness, then **denormalise** selectively for hot reads (store counts, precomputed aggregates).
- Use appropriate **types and keys** (bigint/UUIDv7 IDs, timestamps with time zones), and avoid unbounded rows or columns.
- **Partition** large, time-based tables (e.g. by month) and plan a **shard key** for growth.
- **Cache** hot data and push heavy analytics to a separate store.
- **Archive** old data to cheaper storage so hot tables stay small.

**In the interview:** "Millions of users is comfortable for Postgres with the right indexes; I'd design the shard key now so we can split later without rewriting the schema."
:::

:::qa 98 | Scenario | I | Your webapp loads fast on WiFi but crawls on 4G. What is killing performance?
Mobile networks have **high latency and limited bandwidth**, so the usual culprits are:

- **Large JavaScript bundles**: code-split, tree-shake, and ship less JS.
- **Too many requests / round trips**: bundle critical resources, use HTTP/2, preconnect, and avoid request waterfalls.
- **Unoptimised images**: responsive sizes, modern formats (WebP/AVIF), lazy loading.
- **Render-blocking scripts and CSS**: defer non-critical scripts, inline critical CSS.
- **Poor caching**: long-lived cache headers with fingerprinted assets, a CDN close to users.
- **Chatty APIs**: aggregate data per screen, compress responses.

Measure with real-device throttling and field data (Core Web Vitals) rather than desktop WiFi.

**In the interview:** "On 4G, round trips and bytes dominate — I'd cut bundle size, fix request waterfalls and optimise images, then verify with throttled profiling."
:::

## Migration and architecture decisions

:::qa 99 | Scenario | A | How would you migrate a monolith to microservices without downtime?
Use the **strangler fig** pattern — replace the monolith piece by piece:

1. Put a **routing layer** (API gateway/proxy) in front of the monolith.
2. Identify **bounded contexts** with clear ownership; start with a low-risk, high-value one.
3. Build the new service, with an **anti-corruption layer** translating between old and new models.
4. **Migrate data** carefully: dual writes or CDC from the monolith's database until the new service owns its data.
5. **Shift traffic gradually** (by percentage or user cohort) behind feature flags, comparing results.
6. Remove the old code path once stable, and repeat.

**In the interview:** "Strangler fig behind a gateway, one bounded context at a time, with CDC keeping data in sync until each service fully owns it."
:::

:::qa 100 | Decide | I | When do you split a monolithic frontend into micro frontends?
Split when **organisational** problems dominate:

- Many teams work in one frontend codebase and **block each other's releases**.
- Areas of the product have **independent release cycles** and clear ownership (checkout vs. account vs. search).
- Parts need **different tech stacks** or are being migrated incrementally from a legacy framework.

Don't split for a small team: micro frontends add duplicated dependencies (bundle size), inconsistent UX, shared-state and routing complexity, and harder testing. A well-structured modular monorepo with clear ownership often solves the same problem.

**In the interview:** "Micro frontends are a team-scaling tool — I'd only adopt them when independent deployment is the bottleneck, with a shared design system to keep UX consistent."
:::
