---
title: Bigtable
seoTitle: Design a Distributed Wide-Column Store like Bigtable
description: Design a distributed wide-column storage system like Bigtable — sorted row keys, range-partitioned tablets, LSM storage, a coordinating master and hot-spot handling.
tags: Scaling Writes, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📚 What is Bigtable?
Bigtable is a distributed storage system for structured data: a sparse, sorted map from `(row key, column, timestamp)` to a value. Rows are kept in key order and split into ranges spread across many servers, so it can hold petabytes while still supporting fast point lookups and range scans. HBase and Cassandra's storage engine follow similar ideas.
:::

### Functional Requirements

**Core Requirements**

1. Clients should be able to write and read cells by row key and column.
2. Clients should be able to scan a range of rows in key order.
3. Each cell should keep multiple timestamped versions, with old versions garbage-collected.
4. Single-row operations should be atomic.

**Below the line (out of scope):**

- Multi-row transactions and secondary indexes.
- SQL queries.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Scale to petabytes and millions of operations per second.
2. Low latency: single-digit milliseconds for point reads and writes.
3. Strong consistency per row.
4. Durable and highly available; servers fail without data loss.

**Below the line (out of scope):**

- Multi-region active-active writes.

```sketch Bigtable Requirements
Functional
- read / write cells by row + column
- range scans in key order
- versioned cells
- atomic single-row ops

Non-functional
- petabytes, millions of ops/s
- ms latency
- strongly consistent rows
- durable, survives failures
```

## The Set Up

### Defining the Core Entities

1. **Table**: rows sorted by row key, with column families defined up front.
2. **Tablet**: a contiguous range of rows (~100-200 MB to a few GB), the unit of distribution.
3. **Tablet server**: serves reads and writes for a set of tablets.
4. **SSTable**: an immutable sorted file of key-values stored in a distributed file system.

### API or System Interface

```
put(table, rowKey, {family:qualifier: value}, timestamp?)
get(table, rowKey, columns?, maxVersions?)
scan(table, startKey, endKey, filter?)
checkAndPut(table, rowKey, condition, mutation)   (atomic per row)
```

## High-Level Design

### 1) Rows are range-partitioned into tablets

Because rows are sorted, the table is cut into **tablets** by key range. Each tablet is served by one **tablet server** at a time. Range partitioning keeps scans efficient (a range touches few tablets), unlike hash partitioning. Tablets split when they grow too large and merge when small.

### 2) Clients find the right tablet through a location hierarchy

A small **metadata table** maps key ranges to tablet servers; its own location is stored in a coordination service (Chubby/ZooKeeper). Clients look up and **cache** tablet locations, so most requests go straight to the right server.

```diagram Finding a tablet
node client 0,1 box "Client|location cache"
node zk 0,-0.5 circle "ZooKeeper|root location"
node meta 1.8,-0.4 box "Metadata Tablets|range -> server"
node ts 3.2,1.6 box "Tablet Server"
node dfs 4.8,1.6 circle "DFS|SSTables + log"
edge client <-> zk "1"
edge client <-> meta "2"
edge client <-> ts "3. read / write"
edge ts <-> dfs
```

### 3) Writes use an LSM tree

A write is appended to the tablet server's **commit log** (in the distributed file system) and inserted into an in-memory sorted **memtable**. When the memtable fills, it's flushed as an immutable **SSTable**. Reads merge the memtable with the tablet's SSTables. Background **compaction** merges SSTables, drops deleted cells and expired versions.

### 4) A master assigns tablets

The **master** assigns tablets to servers, balances load, and handles splits. It's not on the data path. Tablet servers hold a lock in ZooKeeper; if a server's lock lapses, the master reassigns its tablets.

## Potential Deep Dives

### 1) How do we recover when a tablet server dies?

Data lives in the distributed file system, so nothing on the server's disk is lost — only its memtables. The master reassigns the dead server's tablets; each new server **replays the commit log** from the last flush to rebuild the memtable. Since one server's log covers many tablets, the log is **sorted by tablet first** so each new server reads only its portion in parallel. Recovery takes seconds to a minute.

### 2) How do we make reads fast with many SSTables?

:::solution bad Check every SSTable
#### Approach

On a read, look up the key in every SSTable for the tablet.

#### Challenges

Reads slow down as SSTables accumulate, each costing a disk seek.
:::

:::solution good Compaction plus block index
#### Approach

Compact regularly to keep SSTable counts low, and keep each SSTable's **block index** in memory so a lookup costs at most one seek per file.

#### Challenges

Still one seek per SSTable for keys that don't exist in most files.
:::

:::solution great Bloom filters and a block cache
#### Approach

Each SSTable has a **Bloom filter** in memory, so most files that don't contain the key are skipped with no disk I/O. A **block cache** keeps hot blocks in memory, and **locality groups** store column families that are read together in separate files so scans touch less data.

#### Challenges

Bloom filters and caches use memory, which must be budgeted per server.
:::

### 3) How do we avoid hot spots?

Sequential row keys (timestamps, incrementing IDs) send every write to the last tablet. Design keys to spread load: **prefix with a hash or salt**, or reverse domain names and lead with an entity ID (`userId#timestamp`) so a user's data stays together while users spread across tablets. The master also **splits** hot tablets and moves them to idle servers.

:::tip
Row-key design is the most important choice in a wide-column store. Talk through a concrete key for the use case, like `reverse(url)#timestamp` for a web table.
:::

### Final Design

```diagram Final Design
node client 0,1 box "Client|cached locations"
node master 1.6,-0.3 box "Master|assign · balance · split"
node zk 3.2,-0.3 circle "ZooKeeper"
node ts1 1.6,1.2 box "Tablet Server|memtable + cache"
node ts2 3.2,1.2 box "Tablet Server"
node dfs 2.4,2.6 circle "Distributed FS|SSTables + logs"
edge client <-> ts1
edge master <-> zk
edge master -> ts1 "assign"
edge ts1 <-> dfs
edge ts2 <-> dfs
edge ts2 <-> zk "lease"
```

```quiz
[
  {
    "question": "Why does Bigtable use range partitioning rather than hash partitioning?",
    "options": ["It's simpler", "So range scans in key order touch only a few tablets", "Hashing is slow", "For encryption"],
    "answer": 1,
    "explanation": "Sorted ranges keep adjacent keys together, making scans efficient."
  },
  {
    "question": "What happens to data when a tablet server fails?",
    "options": ["It's lost", "Another server replays the commit log from the DFS and serves the tablets", "The table is read-only forever", "Clients rewrite it"],
    "answer": 1,
    "explanation": "SSTables and logs live in the distributed file system, so only memtables need rebuilding."
  },
  {
    "question": "What do Bloom filters on SSTables do?",
    "options": ["Compress data", "Let reads skip files that definitely don't contain the key", "Encrypt rows", "Order writes"],
    "answer": 1,
    "explanation": "They avoid disk seeks for keys that aren't present."
  },
  {
    "question": "Why are timestamp-first row keys a problem?",
    "options": ["They're too long", "All new writes hit the same tablet, creating a hot spot", "They can't be sorted", "They break versioning"],
    "answer": 1,
    "explanation": "Monotonic keys concentrate writes at the end of the key range."
  }
]
```
