---
title: Databases & Storage
subtitle: SQL vs NoSQL, indexes, replication, sharding and the operational questions that follow.
seoTitle: System Design Interview Questions — Databases & Storage
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 26 | Compare | B | SQL vs NoSQL: structure, schema, scaling, consistency, use cases.
**SQL (relational)** databases store data in tables with a fixed schema, support joins and ACID transactions, and scale primarily vertically plus read replicas. Great for structured, relational data with integrity constraints: orders, payments, users.

**NoSQL** covers several models — key-value (Redis, DynamoDB), document (MongoDB), wide-column (Cassandra), graph (Neo4j). They usually have flexible schemas, scale horizontally by design, and often trade strong consistency or joins for throughput and availability. Great for massive scale, simple access patterns, and high write volumes.

**In the interview:** Compare on access patterns, not hype — "we need multi-row transactions, so Postgres; the activity log is append-heavy and keyed by user, so Cassandra."

**Go deeper:** [PostgreSQL](/learn/system-design/deep-dives/postgresql) · [Cassandra](/learn/system-design/deep-dives/cassandra) · [DynamoDB](/learn/system-design/deep-dives/dynamodb)
:::

:::qa 27 | Decide | I | When would you choose SQL vs NoSQL? How do you decide for a new project?
Start from the data and its access patterns:

- Need **transactions across rows/tables**, complex queries or joins, strong constraints? → SQL.
- Need **massive write throughput**, simple key-based access, horizontal scale from day one, flexible schemas? → NoSQL.
- Unsure? Default to **Postgres** — it scales further than most products ever need and supports JSON for flexible fields.

Many systems are hybrid: SQL for the system of record, plus Redis for caching, Elasticsearch for search, and a wide-column store for high-volume event data.

**In the interview:** "Default Postgres; I'd move a specific access pattern to NoSQL only when I can name the scale or shape it can't handle."
:::

:::qa 28 | Define | B | What is a database index and why does it matter? Trade-offs?
An index is an auxiliary data structure — usually a **B-tree**, sometimes a hash, GIN or GiST index — that lets the database find rows without scanning the whole table, turning O(n) lookups into O(log n).

Trade-offs:

- **Slower writes**: every insert/update must also update each index.
- **Storage**: indexes take space, sometimes as much as the table.
- **Choosing wisely**: composite indexes follow the leftmost-prefix rule; low-selectivity columns (booleans) rarely help on their own.

**In the interview:** Name the index for each hot query — "an index on `(user_id, created_at DESC)` serves 'this user's latest posts' directly."

**Go deeper:** [PostgreSQL](/learn/system-design/deep-dives/postgresql)
:::

:::qa 29 | Define | B | What is database replication? Types: master-slave, master-master, synchronous, asynchronous.
Replication keeps copies of data on multiple nodes for availability, durability and read scaling.

- **Primary-replica (master-slave)**: one node takes writes; replicas copy its log and serve reads. Simple; writes don't scale.
- **Multi-primary (master-master)**: several nodes accept writes. Better write availability, but concurrent writes conflict and need resolution.
- **Synchronous**: the primary waits for replicas to confirm before acknowledging. No data loss on failover; higher latency.
- **Asynchronous**: the primary acknowledges immediately. Faster, but replicas lag and a failover can lose recent writes.

**In the interview:** "One synchronous standby in another zone for zero-loss failover, plus async read replicas for read scaling."
:::

:::qa 30 | Define | B | What is database sharding and how does it help scalability?
Sharding splits a dataset horizontally across multiple database servers — each shard holds a subset of rows (e.g. users A–M on shard 1). Since each shard handles only part of the data and traffic, write throughput and storage scale with the number of shards.

Costs: queries spanning shards become expensive scatter-gathers, cross-shard transactions are hard, rebalancing data is operationally painful, and a bad shard key creates hot shards.

**In the interview:** "We shard only when one primary can't handle writes or storage — by `user_id`, so each user's data lives on one shard and most queries stay local."

**Go deeper:** [Scaling Writes](/learn/system-design/patterns/scaling-writes)
:::

:::qa 31 | How | I | What sharding strategies exist (range, hash, directory) and how do you pick a shard key?
- **Range-based**: shard by key ranges (dates, alphabetical). Range queries are efficient, but recent or popular ranges become hot.
- **Hash-based**: `hash(key)` decides the shard (often with consistent hashing). Even distribution; range queries must hit every shard.
- **Directory-based**: a lookup service maps each key (or tenant) to a shard. Flexible and easy to rebalance, but the directory is another component to keep available.

A good shard key has **high cardinality**, spreads load **evenly**, and matches the **dominant access pattern** so most queries hit one shard (e.g. `user_id` for per-user data, `tenant_id` for B2B).

**In the interview:** "Shard key `user_id` with consistent hashing: even spread, and the timeline query only touches the user's own shard."
:::

:::qa 32 | Define | I | What is data partitioning (horizontal, vertical, directory-based)? Partitioning vs replication?
**Partitioning** divides data into pieces:

- **Horizontal** (sharding): different rows in different partitions.
- **Vertical**: different columns or tables in different stores (e.g. move large blobs or rarely used columns elsewhere; split services by domain).
- **Directory-based**: a lookup table decides where each piece lives.

**Partitioning vs replication**: partitioning splits data so each node holds *different* data — it scales capacity. Replication copies the *same* data to multiple nodes — it scales reads and adds fault tolerance. Production systems combine both: each partition is replicated.

**In the interview:** "Partition by user for scale, replicate each partition three ways for availability."
:::

:::qa 33 | How | I | How do you handle hot partitions?
A hot partition gets disproportionate traffic — a celebrity's user ID, a viral post, today's date.

Fixes:

- **Better keys**: avoid low-cardinality or time-based keys for write-heavy data.
- **Key salting**: append a suffix (`post123#0..9`) to spread one logical key over several partitions; read by combining them.
- **Caching** hot reads in front of the partition.
- **Write aggregation**: batch increments in memory and flush periodically.
- **Split or isolate** hot keys onto dedicated partitions; adaptive capacity in managed stores.

**In the interview:** "The viral post's like counter is sharded into 16 sub-counters and aggregated on read."

**Go deeper:** [Like Counter](/learn/system-design/problem-breakdowns/like-counter)
:::

:::qa 34 | How | I | How do you handle database schema migrations in large systems with no downtime?
Use the **expand-and-contract** pattern so old and new code both work at every step:

1. **Expand**: add the new column/table (nullable, no locks); deploy code that writes to both old and new.
2. **Backfill** existing rows in small batches, throttled to protect production.
3. **Switch reads** to the new column behind a feature flag; verify.
4. **Contract**: stop writing the old column, then drop it later.

Also: avoid long table locks (online schema-change tools like gh-ost/pg_repack, `CREATE INDEX CONCURRENTLY`), make migrations backward compatible with the previous deploy, and always have a rollback plan.

**In the interview:** "Every migration is backward compatible with the currently running code, so deploys and rollbacks never need downtime."
:::
