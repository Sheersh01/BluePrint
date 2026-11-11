---
title: Asset Monitoring Platform
subtitle: A multi-tenant platform where organizations track live assets across many locations — current state, search, history, alerts and a map, even when sites go offline.
section: real-life
category: Real-Life Questions
tags: Scaling Writes, Real-time Updates
seoTitle: Design a Multi-Tenant Asset Monitoring Platform (Real Interview Question)
description: A real interview question — design a multi-tenant asset monitoring platform with current state, search, history, alerts and maps, for organizations of very different sizes and locations that lose connectivity.
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

:::info
**The question, as it was asked:** We have a platform used by organizations to monitor a large number of assets across different locations. These assets continuously generate information from different sources. Users should be able to view the current state of assets, search and filter assets, view historical information, receive alerts for important events, and see assets on a map. Different organizations may have very different numbers of assets and users. A delay of a few seconds in displaying updated information to users is acceptable — the system does not require instantaneous updates. Some locations may also temporarily lose connectivity with the central platform. Design the high-level architecture for this system. You can make reasonable assumptions, but clearly explain them.
:::

## Understanding the Problem

:::definition 📡 What is an asset monitoring platform?
Think fleet tracking, factory equipment monitoring or cold-chain sensors, sold as a SaaS product to many organizations. Each asset (a truck, a pump, a freezer) reports its location and readings; each organization's users watch their own assets on a dashboard and a map, dig into history, and get alerted when something goes wrong.
:::

This question is deliberately vague — the interviewer said *"make reasonable assumptions, but clearly explain them"*. That sentence is part of the grading. State your assumptions out loud before designing anything:

**Assumptions**

- An **asset** is a physical thing (vehicle, machine, sensor) that reports through a **site gateway** at its location, or directly over cellular. Its "different sources" are telemetry sensors, GPS, the gateway itself, and third-party systems (e.g. a maintenance tool) that push events by API.
- **Tenants:** ~500 organizations. Small ones have ~100 assets; the largest has ~1M. Total ~10M assets.
- **Update rate:** each asset reports every 10–60 seconds → average ~300k events/s, peaks ~1M events/s (e.g. after a large site reconnects).
- **Freshness:** dashboards may lag by up to ~5 seconds.
- **Users:** ~200k users in total, ~20k watching dashboards at the same time.
- **History:** raw readings kept for ~1 year, then downsampled rollups kept for several years.

### Functional Requirements

**Core Requirements**

1. Users should be able to view the current state of their organization's assets.
2. Users should be able to search and filter assets.
3. Users should be able to view historical information for an asset.
4. Users should receive alerts for important events.
5. Users should be able to see assets on a map.

**Below the line (out of scope):**

- Sending commands back to assets (remote control, firmware updates).
- Billing and tenant onboarding workflows.
- Building the analytics/reporting product on top of history.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. **Multi-tenant isolation:** an organization only ever sees its own data, and one huge tenant must not slow down everyone else (the "noisy neighbour" problem).
2. **High write throughput:** ingest ~300k events/s on average and absorb bursts of ~1M/s.
3. **Freshness within ~5 seconds** is enough — favour availability and throughput over strict consistency for dashboards.
4. **No data loss when a location goes offline:** buffered data arrives later, possibly out of order, and must still land correctly.
5. **Highly available reads:** dashboards, maps and alerts keep working even if part of the ingestion pipeline is degraded.

**Below the line (out of scope):**

- Sub-second, hard real-time control.
- Strong consistency between the map, the list and the search results at every instant.

```sketch Requirements on the whiteboard
Functional
- current state
- search + filter
- history
- alerts
- map

Non-functional
- tenants: 100 → 1M assets each (isolation!)
- ~300k events/s, bursts 1M/s
- ~5 s freshness is fine
- sites go offline → buffer, no loss
- reads always available
```

## The Set Up

### Defining the Core Entities

1. **Organization (tenant):** id, plan/tier, quotas.
2. **Location (site):** id, tenant, address, coordinates, connectivity status, last seen.
3. **Asset:** id, tenant, location, type, static attributes (name, model, tags).
4. **Reading (event):** tenant, asset, source, metric values, **event time**, sequence number.
5. **Asset state:** the latest known values, position and status of an asset, plus when they were last updated.
6. **Alert rule:** tenant, condition (e.g. temperature > 8 °C for 10 minutes), scope, notification targets.
7. **Alert:** rule, asset, time, status (open, acknowledged, resolved).

### API or System Interface

Ingestion (gateways, devices, partner systems) and the user-facing API are separate. The tenant always comes from the credential, never from the request body.

```
# ingestion
POST /v1/ingest/batch            { gatewayId, readings: [{ assetId, source, values, eventTime, seq }] }
MQTT tenants/{t}/assets/{a}/telemetry      (devices that speak MQTT)

# users
GET  /v1/assets?status=&type=&tag=&q=&cursor=      -> { assets: AssetState[], nextCursor }
GET  /v1/assets/{id}                               -> AssetState
GET  /v1/assets/{id}/history?metric=&from=&to=&resolution=1m
GET  /v1/map?bbox=&zoom=&filters=                  -> clusters or assets in view
GET  /v1/updates?since=<cursor>                    -> changes since cursor (or SSE stream)
POST /v1/alert-rules             { condition, window, scope, notify }
GET  /v1/alerts?status=open
```

## High-Level Design

### 1) Users should be able to view the current state of assets

Readings arrive at a **site gateway** (or straight from cellular devices) and are sent in batches to a stateless **Ingest API**. It authenticates the gateway, stamps the **tenant id**, validates the payload and writes it to **Kafka**, partitioned by `tenantId + assetId` so each asset's events stay in order. The ingest API returns success only after Kafka has the batch — from then on nothing is lost.

**Stream workers** consume the topic, **normalize** each source's format into one canonical reading, and update the asset's **latest state** in a fast key-value store (Redis or DynamoDB/Cassandra), keyed by `tenantId:assetId`. Writes are **last-write-wins by event time**: a reading only replaces the state if its event time is newer than what's stored, which matters once offline sites start replaying old data.

```diagram Ingestion and current state
node site 0,1 box "Site Gateway|local buffer"
node ingest 1.4,1 box "Ingest API|auth + tenant"
node kafka 2.8,1 box "Kafka|by tenant+asset"
node workers 4.2,1 box "Stream Workers|normalize"
node state 5.6,1 circle "Latest State|tenant:asset"
edge site -> ingest "batches"
edge ingest -> kafka
edge kafka -> workers
edge workers -> state "newer event time wins"
```

The **Query API** reads asset state for the list and detail views. Every query is scoped by the tenant from the user's token.

### 2) Users should be able to search and filter assets

Filtering by status, type, tags or free text across a million assets doesn't belong in the key-value store. The stream workers also publish **asset change events**, and an indexer updates a **search index** (OpenSearch/Elasticsearch) with each asset's static attributes plus a few current fields (status, last seen, position).

Because a few seconds of lag is acceptable, the indexer **coalesces** updates: it keeps only the latest change per asset and flushes in bulk every 1–2 seconds. That turns 300k raw events/s into far fewer index writes — most assets don't change status every reading.

### 3) Users should be able to view historical information

Workers also write every reading, in batches, to a **time-series store** (TimescaleDB, ClickHouse, or Cassandra with time-bucketed partitions), partitioned by tenant, asset and time. Rollup jobs pre-compute 1-minute and 1-hour aggregates so a 30-day chart reads a few hundred points, not millions. After the retention window, raw data moves to cheap object storage (Parquet on S3), still queryable for audits.

### 4) Users should receive alerts for important events

A **stream processor** (Flink) consumes the same Kafka topic and evaluates each tenant's **alert rules** with windowed state per asset ("temperature above 8 °C for 10 minutes", "no reading for 15 minutes"). Matches go to an **alert service** that de-duplicates, stores the alert and fans out notifications (email, SMS, push, webhook) through a notification queue.

### 5) Users should be able to see assets on a map

Each asset document in the search index has a `geo_point`. The map sends its **viewport** (bounding box) and **zoom** to `GET /v1/map`:

- **Zoomed in:** return the individual assets inside the box.
- **Zoomed out:** return **clusters** (counts per geohash cell) computed with a geo aggregation, instead of sending 1M pins to the browser.

The browser refreshes the view every few seconds (see deep dive 3).

## Potential Deep Dives

### 1) How do we handle organizations with 100 assets and organizations with 1M assets on the same platform?

This is the part of the prompt most candidates skip: *"Different organizations may have very different numbers of assets and users."* That's a multi-tenancy question.

:::solution bad A separate database (or deployment) per organization
#### Approach

Every tenant gets its own database cluster or full deployment, so isolation is perfect.

#### Challenges

500 tenants means 500 clusters to run, upgrade and monitor; most small tenants waste nearly all their capacity; and onboarding a new customer becomes an infrastructure project.
:::

:::solution good Fully shared infrastructure with tenant_id everywhere
#### Approach

All tenants share the same Kafka topics, stores and indexes. Every key, row and document carries `tenantId`, and the API enforces it on every query.

#### Challenges

Cheap and simple, but the 1M-asset tenant dominates partitions and index shards: its bursts and heavy queries slow down everyone (noisy neighbour), and one tenant's data volume can create hot partitions.
:::

:::solution great Tiered tenancy: pool the small, isolate the large, cap everyone
#### Approach

- **Pool** small and medium tenants on shared infrastructure, with `tenantId` as the first part of every key so data is co-located per tenant.
- **Isolate** large tenants: dedicated Kafka partitions, their own search index (or index shards routed by tenant), and if needed a dedicated time-series cluster. A **tenant directory** maps each tenant to its "cell", so moving a tenant that outgrows the pool is a routing change plus a data migration — not a code change.
- **Per-tenant quotas** at ingest (events/s) and at the API (requests/s, concurrent queries), so a burst from one tenant is throttled or queued instead of degrading others.
- **Spread big tenants' writes:** partition by `tenantId + assetId`, never by `tenantId` alone.

#### Challenges

More moving parts — a tenant directory, migrations between tiers, and per-tenant monitoring. Worth it: it's the standard pattern for B2B SaaS at this scale.
:::

### 2) What happens when a location loses connectivity?

*"Some locations may also temporarily lose connectivity"* — the second hint. Three separate problems hide in it: not losing data, putting late data in the right place, and not raising false alarms.

:::solution bad Devices send directly to the cloud and drop data on failure
#### Approach

Each asset posts readings to the platform; if the request fails, the reading is discarded.

#### Challenges

Every outage creates a permanent gap in history, and the dashboard can't tell "asset broken" from "site offline".
:::

:::solution good Retry with a local buffer
#### Approach

The site gateway stores readings on local disk while offline and retries until the platform acknowledges them.

#### Challenges

On reconnect the gateway replays hours of data, which can overwrite newer state, create duplicates on retry, flood the pipeline and delay live data from every other site, and trigger a storm of stale alerts.
:::

:::solution great Store-and-forward with event time, idempotency and a backfill lane
#### Approach

- **Store and forward at the edge:** the gateway keeps a durable local queue (days of capacity), and every reading carries the **event time** and a per-source **sequence number**.
- **Idempotent ingest:** the pipeline de-duplicates on `(source, seq)` and history writes are upserts, so retries are harmless.
- **Event time, not arrival time:** current state applies "newer event time wins"; history inserts old readings into the right time bucket; Flink uses **event-time windows with allowed lateness**, so rollups and alert windows are computed correctly.
- **Separate backfill lane:** when a gateway reconnects it sends its live data first and its backlog through a lower-priority **backfill topic** with rate limits, so one site's catch-up never delays everyone's live dashboards.
- **Make connectivity visible:** track a heartbeat per site. When a site goes silent, mark the *site* as "connectivity lost" with a last-seen time, show assets as "stale" rather than "down", and **suppress asset-level "no data" alerts** for that site, raising one site-level alert instead.
- **Clock sanity:** gateways sync with NTP; store both event time and receive time, and reject or flag timestamps far in the future.

#### Challenges

Late data can still change aggregates that users already saw; rollups for a period must be recomputed when a late batch lands, and very late data (beyond allowed lateness) is corrected by a periodic batch job.
:::

```diagram Offline site, then reconnect
node site 0,1 box "Site Gateway|disk queue|event time + seq"
node ingest 1.5,1 box "Ingest API|dedupe (source, seq)"
node live 3,0.3 box "live topic"
node backfill 3,1.7 box "backfill topic|rate-limited"
node workers 4.5,1 box "Workers|event-time aware"
edge site -> ingest "live first, then backlog"
edge ingest -> live
edge ingest -> backfill
edge live -> workers
edge backfill -> workers
```

### 3) How do we show updates to users within a few seconds?

*"A delay of a few seconds is acceptable"* — the third hint. It means you **don't** need a push connection for every change.

:::solution bad Each browser polls the full asset list every second
#### Approach

The dashboard re-fetches every asset in view once a second.

#### Challenges

20k open dashboards × thousands of assets each, every second, is millions of reads per second for data that mostly hasn't changed.
:::

:::solution good Delta polling every few seconds
#### Approach

The client calls `GET /v1/updates?since=<cursor>` every 3–5 seconds and receives only the assets that changed since its cursor. Changes are kept in a short per-tenant change log (e.g. a Redis stream) that the workers append to.

#### Challenges

Simple, cache-friendly and fits the freshness requirement. Clients with large views still fetch many changes, and idle polling costs something — fine at this scale.
:::

:::solution great Server-sent events with batched, view-scoped updates
#### Approach

Clients open an SSE (or WebSocket) connection and subscribe to their **current view** (tenant + filters or map viewport). A fan-out tier subscribes to the tenant's change stream, filters by each connection's view, and **batches** changes into one push every 1–2 seconds. If the connection drops, the client reconnects with its last cursor and falls back to delta polling.

#### Challenges

Long-lived connections need sticky routing and connection-aware scaling. Since a few seconds is acceptable, starting with delta polling and adding SSE only for heavy dashboards is a perfectly good answer — say why.
:::

### 4) How do we draw a map with a million assets?

Never send all assets to the browser. The map query always includes a bounding box and zoom level:

- **Low zoom:** geohash-grid aggregation returns cluster counts (and maybe worst status per cell) — a few hundred cells.
- **High zoom:** return individual assets in the box, capped and paginated.
- **Hot tenants:** pre-compute cluster counts per zoom level every few seconds for the largest tenants, so the busiest map requests are cache reads.

Positions in the index are updated by the same coalescing indexer as search, so the map is at most a couple of seconds behind.

### 5) How do we handle data from very different sources?

"Different sources" means different formats, units and rates. Put a **normalization layer** in the stream workers, driven by a **schema registry** per source type: map each payload to the canonical reading (`assetId, metric, value, unit, eventTime`), convert units, and send anything that fails validation to a **dead-letter topic** for inspection instead of blocking the stream. Partner systems that push by API use the same ingest path with their own credentials and quotas.

### Final Design

```diagram Final Design
node site 0,1 box "Site Gateways|store + forward"
node ingest 1.4,1 box "Ingest API|auth · quotas"
node kafka 2.8,1 box "Kafka|live + backfill"
node workers 4.2,1 box "Stream Workers|normalize · dedupe"
node state 5.6,-0.1 circle "Latest State"
node search 5.6,1 circle "Search Index|(geo_point)"
node tsdb 5.6,2.1 circle "Time-series DB|+ rollups"
node flink 2.8,2.4 box "Flink|alert rules"
node alerts 1.4,2.4 box "Alert Service|notifications"
node api 7,1 box "Query API|tenant-scoped"
node users 8.4,1 box "Dashboards|list · map"
edge site -> ingest
edge ingest -> kafka
edge kafka -> workers
edge workers -> state
edge workers -> search
edge workers -> tsdb
edge kafka -> flink
edge flink -> alerts
edge api -> state
edge api -> search
edge api -> tsdb
edge users <-> api "poll / SSE"
```

## Which Standard Problems This Maps To

Custom questions are usually two or three standard problems glued together. Recognizing the pieces is half the battle.

| Standard problem | What you borrow | What's different here |
|---|---|---|
| [IoT Platform](/learn/system-design/problem-breakdowns/iot-platform) | Device ingestion, Kafka buffering, device shadow (= latest state), flaky networks | Many *organizations*, and whole *sites* go offline, not single devices |
| [Metrics Monitoring](/learn/system-design/problem-breakdowns/metrics-monitoring) | Time-series storage, rollups, retention, streaming alert rules | Data is per asset and per tenant, not per service |
| [Notification System](/learn/system-design/problem-breakdowns/notification-system) | Fan-out of alerts over email/SMS/push with de-duplication | Alerts must be suppressed when a site is offline |
| [Uber](/learn/system-design/problem-breakdowns/uber) and [Nearby Friends](/learn/system-design/problem-breakdowns/nearby-friends) | Frequent location updates, geospatial indexing | Seconds of lag are fine; no matching or routing |
| [Yelp](/learn/system-design/problem-breakdowns/yelp) | Geo search, bounding-box queries, map clustering | Data changes constantly instead of rarely |
| [FB Post Search](/learn/system-design/problem-breakdowns/fb-post-search) | Search index fed by a stream of changes | Index updates are coalesced because few-second lag is allowed |
| [Scaling Writes](/learn/system-design/patterns/scaling-writes) and [Real-time Updates](/learn/system-design/patterns/real-time-updates) | Partitioning, batching; polling vs SSE vs WebSockets | — |

## What's Different From the Textbook Version

- **Multi-tenancy is the core problem**, not a footnote. Most standard problems have one big user base; here, isolation and fairness between customers drive the architecture.
- **Whole locations disconnect.** That moves buffering to a site gateway and makes event time, backfill and alert suppression first-class.
- **The relaxed freshness requirement is a gift.** It lets you batch, coalesce and poll — and the interviewer wants to see you use it rather than reaching for WebSockets everywhere.
- **"Make assumptions" is graded.** There are no numbers in the prompt on purpose.

## Follow-up Questions You May Get

| Follow-up question | Short answer | Read more |
|---|---|---|
| One tenant has 1M assets — how do you stop hot partitions? | Partition by `tenantId + assetId`, isolate large tenants in their own cell, add per-tenant quotas | [Q33: hot partitions](/learn/system-design/questions/databases#q-33) |
| How do you pick the shard / partition key? | By the dominant access pattern: `tenant + asset` for writes and asset history | [Q31: sharding strategies](/learn/system-design/questions/databases#q-31) |
| A site was offline for 6 hours. What happens when it reconnects? | Live data first, backlog via a rate-limited backfill lane, idempotent and event-time-aware writes | [Q87: server not always connected](/learn/system-design/questions/scenarios#q-87) |
| Can the same reading be stored twice? | Yes with at-least-once delivery — de-duplicate on `(source, seq)` and upsert | [Q24: delivery semantics](/learn/system-design/questions/distributed-systems#q-24) |
| How do alerts work on late or out-of-order data? | Event-time windows with watermarks and allowed lateness | [Q64: windowing](/learn/system-design/questions/messaging#q-64) |
| Stream or batch for rollups? | Stream for recent rollups and alerts; batch to recompute after very late data | [Q13: stream vs batch](/learn/system-design/questions/fundamentals#q-13) |
| Polling, SSE or WebSockets? | Few-second lag allowed → delta polling first; SSE for heavy dashboards | [Q91: WebSocket reconnection](/learn/system-design/questions/scenarios#q-91) |
| Why is the search index allowed to lag? | It's a derived view; the requirement allows seconds of staleness | [Q15: strong vs eventual consistency](/learn/system-design/questions/distributed-systems#q-15) |
| How do you stop one customer from overloading the API? | Per-tenant rate limits and concurrency caps at the gateway | [Q59: rate limiting](/learn/system-design/questions/networking#q-59) |
| How does free-text search over assets work? | An inverted index over asset attributes, updated from the change stream | [Q81: search indexing](/learn/system-design/questions/search-and-recommendations#q-81) |
| Device clocks are wrong — now what? | NTP on gateways; store event and receive time; reject far-future timestamps | — |
| How do you onboard a new customer with 1M assets? | Place them in a dedicated cell via the tenant directory, bulk-load asset metadata, ramp ingest quotas | — |
| How would you add commands back to assets later? | A desired-state record per asset (like an IoT device shadow) delivered when the gateway is online | [IoT Platform](/learn/system-design/problem-breakdowns/iot-platform) |

## Tips & Tricks for This Question

**Decode the hints.** Every unusual sentence in the prompt is a deep dive waiting to happen:

| Sentence in the prompt | What it's really asking |
|---|---|
| "very different numbers of assets and users" | Multi-tenancy, noisy neighbours, tiered isolation, quotas |
| "a delay of a few seconds is acceptable" | Batch, coalesce, poll — eventual consistency is fine |
| "temporarily lose connectivity" | Store-and-forward, event time, idempotency, backfill, alert suppression |
| "information from different sources" | Normalization layer, schema registry, dead-letter topic |
| "see assets on a map" | Geo index, viewport queries, clustering |
| "make reasonable assumptions, but clearly explain them" | Say your numbers and assumptions out loud first |

**Clarifying questions worth asking (pick two or three):**

- How many organizations and assets, and how often do assets report?
- Is the data mostly location, sensor readings, or both?
- How long must history be kept, and at what resolution?
- Do users ever need to send commands back to assets?

**Traps to avoid:**

- Designing a single-tenant system and adding "and we add tenant_id" at the end.
- WebSockets for everything when the prompt says seconds of lag is fine.
- Treating "no data from an asset" as "asset down" — it may just be the site's network.
- Querying the time-series store for the current-state dashboard; keep a separate latest-state store.
- Sending every asset to the browser for the map.

Ready to try it yourself? [Practice this question on the whiteboard](/practice/asset-monitoring-platform).

```quiz
[
  {
    "question": "Organizations range from 100 to 1M assets. What's the strongest multi-tenancy approach?",
    "options": ["A separate deployment per organization", "One shared cluster with tenant_id and nothing else", "Pool small tenants, isolate large ones in their own cells, and apply per-tenant quotas", "Limit every tenant to 10k assets"],
    "answer": 2,
    "explanation": "Tiered tenancy keeps small tenants cheap while protecting everyone from the largest tenants' load."
  },
  {
    "question": "A site reconnects after 6 hours offline. Which approach keeps dashboards correct and fast?",
    "options": ["Replay everything at full speed and overwrite state", "Live data first, backlog through a rate-limited backfill lane, event-time-aware idempotent writes", "Discard the old data", "Pause ingestion for all tenants until the backlog is done"],
    "answer": 1,
    "explanation": "Event time keeps state and history correct; the backfill lane protects live traffic from the catch-up."
  },
  {
    "question": "The prompt says a few seconds of delay is acceptable. What does that allow?",
    "options": ["Nothing — use WebSockets for every change", "Batching and coalescing writes, eventually consistent indexes, and delta polling", "Skipping history storage", "Dropping alerts"],
    "answer": 1,
    "explanation": "Relaxed freshness lets you trade immediacy for throughput and simplicity."
  },
  {
    "question": "An asset at a disconnected site stops reporting. What should the system do?",
    "options": ["Raise a 'device down' alert for every asset", "Mark the site as offline, show its assets as stale, and raise one site-level alert", "Delete the asset", "Ignore it silently"],
    "answer": 1,
    "explanation": "Distinguishing site connectivity loss from asset failure avoids an alert storm and misleading dashboards."
  }
]
```
