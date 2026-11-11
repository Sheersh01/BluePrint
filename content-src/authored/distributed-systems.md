---
title: Distributed Systems
subtitle: CAP, consistency, consensus, transactions across services, and the delivery guarantees you'll be asked to defend.
seoTitle: System Design Interview Questions — Distributed Systems Theory
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 14 | Define | B | What is the CAP theorem?
CAP says that when a **network partition** happens, a distributed system must choose between **Consistency** (every read sees the latest write) and **Availability** (every request gets a non-error response). Partition tolerance isn't optional — networks do fail — so the real choice is C or A *during a partition*.

- **CP** (e.g. a banking ledger): refuse or delay requests rather than return stale or conflicting data.
- **AP** (e.g. a social feed): keep serving, accept that some users briefly see stale data, reconcile later.

PACELC extends this: even without partitions, you trade latency against consistency.

**In the interview:** Make the choice per feature, not per system — "bookings are CP, the event catalog is AP".

**Go deeper:** [Key-Value Store](/learn/system-design/problem-breakdowns/key-value-store)
:::

:::qa 15 | Compare | I | Strong consistency vs eventual consistency. When to choose each?
**Strong consistency**: after a write is acknowledged, every subsequent read returns it. Simple to reason about, but needs coordination (a single leader or quorums), which adds latency and reduces availability during failures.

**Eventual consistency**: replicas converge if writes stop, but reads may briefly return stale data. Faster and more available, but application logic must tolerate staleness and sometimes resolve conflicts.

Choose strong for invariants that must never break — money balances, inventory, uniqueness, permissions. Choose eventual for feeds, counters, recommendations, search indexes. Middle grounds like **read-your-writes** often give users what they actually notice.

**In the interview:** "Users must see their own post immediately (read-your-writes); followers can see it a few seconds later (eventual)."
:::

:::qa 16 | Define | B | What are ACID (explain each letter) and BASE?
**ACID** describes transactional guarantees in traditional databases:

- **Atomicity** — all operations in a transaction happen, or none do.
- **Consistency** — a transaction moves the database from one valid state to another, respecting constraints.
- **Isolation** — concurrent transactions don't see each other's partial work (to a chosen isolation level).
- **Durability** — once committed, data survives crashes.

**BASE** describes many distributed NoSQL systems: **B**asically **A**vailable, **S**oft state (state may change without input as replicas converge), **E**ventually consistent.

**In the interview:** "Orders and payments go in an ACID store; activity feeds and counters can live in a BASE-style store optimised for scale."
:::

:::qa 17 | Define | A | What is consensus and why do systems need it?
Consensus is getting a group of nodes to agree on a single value — or an ordered log of values — even if some nodes crash or messages are delayed. It's the foundation for leader election, replicated state machines, configuration stores and distributed locks.

**Paxos** proved it can be done safely; **Raft** made it understandable: a leader is elected by majority vote, it appends entries to its log, and an entry is committed once a **majority** of nodes have it. Majorities overlap, so two leaders can never commit conflicting entries. A 5-node cluster tolerates 2 failures.

**In the interview:** "I won't implement consensus — I'll use etcd/ZooKeeper (Raft/ZAB) for leader election and metadata, keeping it off the hot data path."

**Go deeper:** [ZooKeeper](/learn/system-design/deep-dives/zookeeper)
:::

:::qa 18 | How | A | How does leader election work?
Leader election picks exactly one node to coordinate work (assigning partitions, ordering writes).

Common approaches:

- **Consensus protocols** (Raft): nodes time out waiting for a heartbeat, become candidates, and request votes; a candidate with a majority becomes leader for a new **term**.
- **Coordination services**: each candidate creates an ephemeral sequential node in ZooKeeper/etcd; the lowest sequence wins; others watch their predecessor and take over when it disappears.
- **Leases**: the leader holds a time-limited lease it must renew.

The dangerous case is a paused old leader that still thinks it's in charge — prevent damage with **fencing tokens** (a monotonically increasing term number checked by storage).

**In the interview:** "Election via etcd leases; every write carries the lease's epoch so a stale leader's writes are rejected."
:::

:::qa 19 | Define | I | What is the two-phase commit (2PC) protocol? Its downsides?
2PC makes a transaction atomic across multiple databases or services:

1. **Prepare**: a coordinator asks every participant to get ready to commit; each locks resources and votes yes/no.
2. **Commit**: if all voted yes, the coordinator tells everyone to commit; otherwise to abort.

Downsides: it's **blocking** — if the coordinator dies after prepare, participants hold locks until it recovers; it adds latency (two round trips with locks held); availability is limited by the least available participant; and it scales poorly across services or regions.

**In the interview:** "2PC is fine inside one database cluster, but across microservices I'd use a saga with compensations instead."
:::

:::qa 20 | Define | I | What is the Saga pattern and how does it differ from 2PC?
A saga breaks a distributed transaction into a sequence of **local transactions**, each with a **compensating action** that undoes it (charge → refund, reserve → release). If step 3 fails, compensations for steps 2 and 1 run in reverse.

Differences from 2PC:

- No locks held across services — each step commits immediately, so it scales and stays available.
- Consistency is **eventual**: intermediate states are visible (e.g. "payment taken, shipping pending").
- Compensations must be designed explicitly, and steps must be idempotent for retries.

Sagas can be **choreographed** (services react to events) or **orchestrated** (a coordinator drives the steps — easier to reason about).

**In the interview:** "Checkout is an orchestrated saga: reserve inventory, authorise payment, create order; failures trigger compensations."

**Go deeper:** [Multi-step Processes](/learn/system-design/patterns/multi-step-processes)
:::

:::qa 21 | How | I | How does a distributed lock work?
A distributed lock ensures only one process across many machines works on a resource at a time.

- **Redis**: `SET lock:resource <owner> NX PX 30000` acquires only if absent, with an expiry so a crashed holder doesn't block forever. Release with a script that deletes only if the value still matches the owner.
- **ZooKeeper/etcd**: create an ephemeral sequential node; the lowest sequence holds the lock; it's released automatically when the holder's session dies.

Caveat: TTLs and pauses mean a holder can lose its lock without knowing. Protect critical writes with **fencing tokens**, and keep a database constraint as the real safety net.

**In the interview:** "Redis lock with a TTL to hold a seat during checkout; the final booking still uses a conditional update so a lost lock can't double-book."

**Go deeper:** [Dealing with Contention](/learn/system-design/patterns/dealing-with-contention)
:::

:::qa 22 | Define | I | What is consistent hashing, why is it used, and how does it minimise data movement?
With naive `hash(key) % N`, adding or removing one node remaps almost every key. **Consistent hashing** places both nodes and keys on a hash ring; each key belongs to the next node clockwise. When a node joins or leaves, only the keys in its arc move — about **1/N** of the data.

**Virtual nodes** give each physical node many positions on the ring, which evens out load and lets bigger machines take more of the ring.

It's used for sharding caches and databases (Dynamo, Cassandra), load balancing sticky connections, and CDNs.

**In the interview:** "Cache keys are distributed with consistent hashing and virtual nodes, so adding a cache server moves ~1/N of keys instead of flushing everything."

**Go deeper:** [Distributed Cache](/learn/system-design/problem-breakdowns/distributed-cache)
:::

:::qa 23 | Define | I | What is idempotency and why does it matter?
An operation is idempotent if doing it multiple times has the same effect as doing it once. In distributed systems, timeouts make it impossible to know whether a request succeeded, so clients **retry** — and without idempotency, retries create duplicate charges, orders or messages.

Techniques:

- Naturally idempotent operations (`PUT` a value, `DELETE` by ID).
- **Idempotency keys**: the client sends a unique key; the server stores it with the result and returns the stored result on repeats.
- Unique constraints and deduplication by message ID in consumers.

**In the interview:** "Every payment request carries an idempotency key stored with a unique constraint, so a retried request returns the original charge."

**Go deeper:** [Payment System](/learn/system-design/problem-breakdowns/payment-system)
:::

:::qa 24 | Compare | I | At-most-once vs at-least-once vs exactly-once delivery/processing semantics.
- **At-most-once**: send and don't retry. Messages may be lost, never duplicated. Fine for metrics sampling or presence pings.
- **At-least-once**: retry until acknowledged. Nothing is lost, but duplicates happen (a consumer processes then crashes before acking). The most common choice.
- **Exactly-once**: each message affects state once. True exactly-once delivery is impossible over unreliable networks; systems achieve **effectively-once processing** with at-least-once delivery plus idempotent consumers, or transactions that commit output and offsets atomically (Kafka transactions, Flink checkpoints).

**In the interview:** "At-least-once delivery with idempotent consumers — dedupe by event ID — gives us effectively-once results."

**Go deeper:** [Message Queue](/learn/system-design/problem-breakdowns/message-queue)
:::

:::qa 25 | Define | A | What are event sourcing and CQRS?
**Event sourcing** stores every change as an immutable event ("ItemAdded", "OrderPaid") instead of overwriting current state. Current state is derived by replaying events. You get a full audit trail, time travel and the ability to build new views from history — at the cost of complexity, schema evolution for old events, and the need for snapshots.

**CQRS** (Command Query Responsibility Segregation) separates the **write model** (validates commands, emits events) from **read models** (denormalised views optimised for queries, updated asynchronously). It lets reads and writes scale and evolve independently, with eventual consistency between them.

They pair naturally but are independent.

**In the interview:** "The ledger is event-sourced for auditability; dashboards read from projections built off the event stream."
:::
