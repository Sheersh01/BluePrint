---
title: PostgreSQL
subtitle: How to use PostgreSQL in system design interviews — ACID transactions, indexing, replication, scaling limits, and when to choose something else.
section: deep-dives
category: Key Technologies
author: Editorial Team
published: Nov 4, 2026
---

PostgreSQL is the default answer for "which database?" in most interviews, and for good reason. It's a mature, open-source relational database with strong consistency, rich indexing, JSON support and a huge ecosystem. If you don't have a specific reason to pick something else, Postgres is a safe, defensible choice — and interviewers respect candidates who can explain *why* it fits and *where* it stops fitting.

## The Basics

Postgres stores data in **tables** with typed columns, linked by foreign keys, and queried with SQL. A few properties matter most in interviews:

1. **ACID transactions** — multiple statements commit or roll back together, with isolation between concurrent transactions.
2. **Strong consistency** on the primary — once a write commits, every subsequent read on the primary sees it.
3. **Rich querying** — joins, aggregations, window functions and constraints that keep data valid.
4. **Extensibility** — JSONB documents, full-text search, PostGIS for geospatial data, and more.

```diagram A typical Postgres deployment
node app 0,1 box "App Servers"
node pool 1.3,1 box "Connection Pooler|(PgBouncer)"
node primary 2.7,0.4 circle "Primary|(reads + writes)"
node r1 4.1,0 circle "Replica 1"
node r2 4.1,1.4 circle "Replica 2"
edge app <-> pool
edge pool <-> primary "writes"
edge pool <-> r2 "reads"
edge primary -> r1 "WAL streaming"
edge primary -> r2 "WAL streaming"
```

## Key Concepts

### Transactions and isolation

Postgres uses **MVCC** (multi-version concurrency control): readers see a consistent snapshot without blocking writers. The default isolation level is *Read Committed*; *Repeatable Read* and *Serializable* give stronger guarantees at the cost of more transaction retries.

Know the tools for contention:

- `SELECT ... FOR UPDATE` locks rows you intend to change.
- Conditional updates (`UPDATE ... WHERE remaining > 0`) make check-and-set atomic.
- Unique constraints enforce invariants even if application code has bugs.

### Indexing

The default **B-tree** index serves equality and range lookups in O(log n). Other index types matter in interviews:

- **GIN** for full-text search (`tsvector`) and JSONB containment.
- **GiST** for geospatial queries with PostGIS.
- **Composite indexes** follow the leftmost-prefix rule — an index on `(user_id, created_at)` serves "a user's recent items" efficiently.
- **Partial indexes** (`WHERE status = 'ACTIVE'`) keep indexes small for hot subsets.

:::tip
In an interview, name the index you'd add for each core query. "An index on `(event_id, status)` so we can fetch available tickets quickly" is far more convincing than "we'll add indexes".
:::

### Replication

The primary streams its write-ahead log (WAL) to replicas. Replicas serve reads and can be promoted if the primary fails. Replication is asynchronous by default — fast, but a failover can lose the last few transactions and replicas may serve slightly stale reads. Synchronous replication removes that risk at the cost of write latency.

## Scaling Postgres

A single well-provisioned Postgres instance handles a lot: terabytes of data and tens of thousands of transactions per second. Scale in this order:

1. **Indexes and query tuning** — most performance problems are missing indexes.
2. **Connection pooling** — Postgres uses a process per connection; PgBouncer lets thousands of app connections share a few hundred database connections.
3. **Read replicas** — scale read throughput.
4. **Caching** — keep hot reads off the database entirely.
5. **Partitioning** — split large tables (e.g. by time) so queries and maintenance touch less data.
6. **Sharding** — split data across multiple primaries by a key (manually or with Citus). This is the big step: cross-shard joins and transactions become hard.

## When to Use It in an Interview

Choose Postgres when you need:

- Transactions across multiple rows or tables — bookings, payments, inventory ([Ticketmaster](/learn/system-design/problem-breakdowns/ticketmaster), [Payment System](/learn/system-design/problem-breakdowns/payment-system)).
- Relational data with flexible querying and constraints.
- Moderate write volume with strong consistency.
- Geospatial or full-text features without adding another system ([Yelp](/learn/system-design/problem-breakdowns/yelp)).

## Limitations

- **Write scaling** — a single primary caps write throughput; sharding is operationally heavy. For millions of writes per second, consider Cassandra or DynamoDB.
- **Huge analytical scans** — row storage isn't ideal for scanning billions of rows; use a columnar warehouse.
- **Advanced search** — built-in full-text search is good, but relevance tuning at scale points to Elasticsearch.
- **Global multi-region writes** — single-primary design makes active-active across regions hard.

## Summary

Postgres gives you transactions, constraints, flexible queries and a strong ecosystem. Start with it by default, index deliberately, scale reads with replicas and caches, and know that sharding — or a different database — is the answer once a single primary can't keep up with writes.

```quiz
[
  {
    "question": "What does MVCC allow in PostgreSQL?",
    "options": ["Multiple primaries", "Readers to see a consistent snapshot without blocking writers", "Automatic sharding", "Schema-less storage"],
    "answer": 1,
    "explanation": "Multiple row versions let reads and writes proceed concurrently."
  },
  {
    "question": "Which index type would you use for PostGIS geospatial queries?",
    "options": ["B-tree", "Hash", "GiST", "None"],
    "answer": 2,
    "explanation": "GiST indexes support spatial operators like distance and containment."
  },
  {
    "question": "What is the main risk of asynchronous replication?",
    "options": ["Slower writes", "Replica lag and possible loss of recent commits on failover", "Replicas can't serve reads", "It requires sharding"],
    "answer": 1,
    "explanation": "Async replicas may be behind the primary at the moment it fails."
  },
  {
    "question": "Why use a connection pooler like PgBouncer?",
    "options": ["To encrypt traffic", "Postgres uses a process per connection, so pooling lets many clients share few connections", "To shard data", "To replicate WAL"],
    "answer": 1,
    "explanation": "Thousands of direct connections would exhaust memory and CPU."
  }
]
```
