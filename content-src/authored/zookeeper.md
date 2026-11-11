---
title: ZooKeeper
subtitle: How to use ZooKeeper in system design interviews — coordination, leader election, service discovery, configuration, and distributed locks.
section: deep-dives
category: Key Technologies
author: Editorial Team
published: Nov 4, 2026
---

Apache ZooKeeper is a coordination service for distributed systems. It doesn't store your application data; it stores small pieces of critical **metadata** — who the leader is, which servers are alive, which shard lives where — and gives every node a consistent view of it. Systems like Kafka (historically), HBase and many in-house platforms rely on it, and etcd and Consul fill the same role.

## The Basics

ZooKeeper runs as an **ensemble** of servers (usually 3 or 5). One is elected leader; writes go through the leader and are committed once a **majority quorum** acknowledges them (the ZAB protocol). Reads can be served by any server. With 5 servers, the ensemble survives 2 failures.

Data is organised as a tree of **znodes**, like a filesystem: `/app/leader`, `/app/servers/server-1`. Each znode holds a small amount of data (kilobytes, not megabytes).

```diagram A ZooKeeper ensemble
node l 2,0.2 circle "Leader"
node f1 0.8,1.4 circle "Follower"
node f2 3.2,1.4 circle "Follower"
node c1 0,2.6 box "Service A"
node c2 2,2.6 box "Service B"
node c3 4,2.6 box "Service C"
edge l <-> f1 "quorum writes"
edge l <-> f2
edge c1 <-> f1 "sessions|+ watches"
edge c2 <-> l
edge c3 <-> f2
```

## Key Concepts

### Ephemeral and sequential znodes

- **Ephemeral znodes** exist only while the client session that created them is alive. If a server crashes and its session times out, its ephemeral nodes disappear — perfect for tracking liveness.
- **Sequential znodes** get a monotonically increasing suffix (`lock-0000000042`), giving a global ordering.

### Watches

Clients can set a **watch** on a znode and get notified when it changes or is deleted. Instead of polling "is the leader still alive?", a node waits for a notification.

### Consistency guarantees

All writes are linearizable and applied in the same order everywhere. Reads may be slightly behind on a follower, but a client calling `sync` first reads the latest committed state.

## Common Uses

### Leader election

Each candidate creates an ephemeral sequential znode under `/election`. The one with the lowest sequence number is leader. Every other candidate watches the node just before its own; when that node disappears, it checks whether it's now the lowest. Watching only your predecessor avoids a **herd effect** where every node wakes up on each change.

### Service discovery and membership

Each server registers an ephemeral znode under `/services/api/`. Clients list the children (and watch them) to find live servers; crashed servers vanish automatically when their sessions expire.

### Configuration and shard maps

Store small, critical config — feature flags, the mapping of shards to servers — in znodes. Watches push changes to every node within milliseconds.

### Distributed locks

Same recipe as leader election: the lowest sequential ephemeral node holds the lock. Because session expiry can release a lock while the old holder still thinks it owns it (e.g. after a long GC pause), pair locks with **fencing tokens** — use the znode's sequence number as a token that downstream storage checks.

## When to Use It in an Interview

- Choosing a single leader or coordinator (a scheduler, a partition owner).
- Tracking which servers are alive and which data they own — e.g. the hash ring in a [Distributed Cache](/learn/system-design/problem-breakdowns/distributed-cache) or document ownership in [Google Docs](/learn/system-design/problem-breakdowns/google-docs).
- Sharding coordination for watchers in a [Job Scheduler](/learn/system-design/problem-breakdowns/job-scheduler).

:::info
In many modern designs you can name **etcd** instead — it offers the same primitives (leases, watches, linearizable writes) with a simpler API and is what Kubernetes uses. Kafka has also replaced ZooKeeper with its built-in KRaft quorum.
:::

## Limitations

- **Not a database** — small data only; heavy read/write traffic will overwhelm it.
- **Write throughput** is limited by quorum replication through a single leader.
- **Operational care** — ensembles need odd sizes, low-latency disks for the transaction log, and careful session timeout tuning.
- **Majority required** — losing quorum makes the ensemble unavailable for writes (it chooses consistency over availability).

## Summary

ZooKeeper provides consistent, highly available coordination primitives: znodes, ephemeral nodes for liveness, sequential nodes for ordering, and watches for notifications. Use it (or etcd) for leader election, membership, configuration and locks — and keep application data elsewhere.

```quiz
[
  {
    "question": "What happens to an ephemeral znode when its client's session expires?",
    "options": ["It becomes permanent", "It is deleted automatically", "It is replicated", "It is locked"],
    "answer": 1,
    "explanation": "Ephemeral znodes are tied to the session, making them ideal for liveness tracking."
  },
  {
    "question": "How many server failures can a 5-node ZooKeeper ensemble tolerate?",
    "options": ["1", "2", "3", "4"],
    "answer": 1,
    "explanation": "A majority (3 of 5) must remain to commit writes."
  },
  {
    "question": "In leader election, why does each node watch only its predecessor?",
    "options": ["To save disk", "To avoid a herd effect where every node wakes up on every change", "Because watches are expensive to create", "To elect multiple leaders"],
    "answer": 1,
    "explanation": "Only the next-in-line node is notified when the node ahead of it disappears."
  },
  {
    "question": "What kind of data belongs in ZooKeeper?",
    "options": ["User-uploaded files", "Small, critical coordination metadata like leaders and shard maps", "Analytics events", "Full database tables"],
    "answer": 1,
    "explanation": "ZooKeeper is for coordination, not bulk data storage."
  }
]
```
