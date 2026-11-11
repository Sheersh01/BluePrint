---
title: Distributed File System
seoTitle: Design a Distributed File System like GFS or HDFS
description: Design a distributed file system — splitting huge files into replicated chunks, a metadata master, write pipelines, failure detection and re-replication.
tags: Handling Large Blobs, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🗄️ What is a Distributed File System?
A distributed file system (like Google File System or HDFS) stores files far larger than any single disk across thousands of commodity machines, and presents them as one namespace of directories and files. It's built for big data workloads: huge files, mostly sequential reads, and appends rather than random overwrites.
:::

### Functional Requirements

**Core Requirements**

1. Clients should be able to create, read and delete files in a hierarchical namespace.
2. Clients should be able to append data to files, including several writers appending concurrently.
3. Files can be terabytes in size and should be readable in parallel by many machines.

**Below the line (out of scope):**

- POSIX semantics (random in-place overwrites, file locks).
- Small-file optimisation.
- Access control beyond simple permissions.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Durability: no data loss when disks or machines fail (they fail daily at this scale).
2. High aggregate throughput for large sequential reads and appends, rather than low latency.
3. Scale to petabytes and thousands of nodes.
4. Automatic recovery without operator involvement.

**Below the line (out of scope):**

- Geo-replication across data centres.

```sketch DFS Requirements
Functional
- namespace: create / read / delete
- append, concurrent appenders
- TB-sized files, parallel reads

Non-functional
- durable despite daily failures
- throughput over latency
- petabytes, thousands of nodes
- self-healing
```

## The Set Up

### Defining the Core Entities

1. **File**: a path in the namespace, made of an ordered list of chunks.
2. **Chunk**: a fixed-size piece of a file (64-128 MB) with a globally unique ID and a version number.
3. **Chunk server**: a machine storing chunk replicas on its local disks.
4. **Master (NameNode)**: holds the namespace and the file → chunks → locations mapping.

### API or System Interface

```
create(path) / delete(path) / list(dir)
open(path) -> handle
read(handle, offset, length) -> bytes
append(handle, bytes) -> offset          (record append, at-least-once)
```

## High-Level Design

### 1) Files are split into replicated chunks

Each file is split into **large fixed-size chunks**, and each chunk is stored on **three chunk servers**, ideally in different racks. Large chunks keep the metadata small (a petabyte is only ~10 million 100 MB chunks) and make reads mostly sequential.

### 2) A master holds metadata; data never flows through it

To read, the client asks the **master** which chunks hold a byte range and where their replicas live, caches the answer, and then reads **directly from a chunk server**. The master only serves small metadata requests, so one master can coordinate thousands of servers.

```diagram Reads
node client 0,1 box "Client"
node master 1.6,0 box "Master|namespace + chunk map"
node cs1 3.2,1 circle "Chunk Server"
node cs2 3.2,2.2 circle "Chunk Server"
edge client <-> master "1. which chunks, where?"
edge client <-> cs1 "2. read chunk directly"
note 3.7,1.5 "3 replicas,|different racks"
```

### 3) Appends flow through a replica pipeline

For a write, the master grants a **lease** to one replica, making it the **primary** for that chunk. The client pushes data along a **pipeline** of the replicas (each forwards to the next, using full network bandwidth), then asks the primary to commit. The primary picks the offset, applies the write, and tells the secondaries to apply it in the same order. Concurrent appenders are serialised by the primary.

## Potential Deep Dives

### 1) How do we keep the master from being a single point of failure?

:::solution bad A single in-memory master
#### Approach

Keep all metadata in the master's memory and nothing else.

#### Challenges

A crash loses the namespace — and with it every file.
:::

:::solution good Operation log plus checkpoints
#### Approach

Every namespace change is written to an **operation log** on local disk and remote replicas before it's acknowledged. Periodic **checkpoints** keep recovery fast. Chunk locations are *not* persisted: the master rebuilds them by asking chunk servers on startup.

#### Challenges

Recovery still means downtime while a new master starts and replays the log.
:::

:::solution great Hot standby with shared log
#### Approach

Run a **standby master** that tails the replicated edit log (HDFS uses a quorum of journal nodes) and keeps its state current. **ZooKeeper** handles leader election and fencing so only one master is active. Failover takes seconds. For very large namespaces, **federate** the namespace across several masters by directory.

#### Challenges

Fencing must be strict, or two masters could both accept writes.
:::

### 2) How do we detect and repair failures?

Chunk servers send **heartbeats** with the chunks they hold. When a server misses heartbeats, the master marks its replicas lost and schedules **re-replication** from surviving copies, prioritising chunks with the fewest replicas left. Each chunk stores **checksums** per 64 KB block, so silent disk corruption is detected on read and the replica is replaced. **Version numbers** let the master spot stale replicas that missed writes while a server was down.

:::tip
Mention rack awareness: two replicas in one rack and one in another tolerates a full rack loss without sending every write across racks.
:::

### 3) What consistency do appends offer?

Record append is **at-least-once**: if a replica fails mid-write, the client retries, so some replicas may contain duplicates or padding. Applications cope by writing self-describing records with checksums and unique IDs, and readers skip duplicates. This relaxed model is what lets many producers append to one file without distributed locking.

### Final Design

```diagram Final Design
node client 0,1 box "Client|metadata cache"
node master 1.6,-0.2 box "Active Master"
node standby 3.2,-0.2 box "Standby Master"
node zk 4.8,-0.2 circle "ZooKeeper"
node cs1 1.6,1.4 circle "Chunk Server"
node cs2 3.2,1.4 circle "Chunk Server"
node cs3 4.8,1.4 circle "Chunk Server"
edge client <-> master "metadata"
edge master -> standby "edit log"
edge standby <-> zk "election"
edge client -> cs1 "data pipeline"
edge cs1 -> cs2
edge cs2 -> cs3
```

```quiz
[
  {
    "question": "Why does a distributed file system use large chunks (64-128 MB)?",
    "options": ["Disks require it", "To keep master metadata small and make reads sequential", "To improve random writes", "For encryption"],
    "answer": 1,
    "explanation": "Fewer, larger chunks mean less metadata and efficient streaming I/O."
  },
  {
    "question": "Why doesn't file data flow through the master?",
    "options": ["Security", "So one master can coordinate thousands of servers without becoming a bandwidth bottleneck", "The master has no disk", "It's illegal"],
    "answer": 1,
    "explanation": "Clients fetch locations from the master, then talk to chunk servers directly."
  },
  {
    "question": "What does the primary replica's lease provide?",
    "options": ["Faster reads", "A single replica that decides the order of writes to a chunk", "Encryption keys", "Billing"],
    "answer": 1,
    "explanation": "The primary serialises mutations so all replicas apply them in the same order."
  },
  {
    "question": "How is silent disk corruption detected?",
    "options": ["It isn't", "Per-block checksums verified on read", "Heartbeats", "Comparing file names"],
    "answer": 1,
    "explanation": "Checksums catch corrupt blocks so the replica can be re-copied from a healthy one."
  }
]
```
