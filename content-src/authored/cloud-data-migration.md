---
title: Cloud Data Migration
seoTitle: Design a System to Migrate Petabytes of Data to the Cloud
description: Design a large-scale data migration service — parallel chunked transfers, checksums and verification, resumability, bandwidth control, and live cutover with change sync.
tags: Handling Large Blobs, Managing Long Running Tasks
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Google, OCI | 0
---

## Understanding the Problem

:::definition ☁️ What is Cloud Data Migration?
Migration services move large datasets — petabytes of files from an on-premises data centre or another cloud — into cloud object storage, verifying every byte and keeping the copy in sync until applications switch over.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create a migration job from a source (on-prem file servers, another bucket) to a destination bucket.
2. The system should copy all objects, preserving metadata, and verify integrity.
3. Jobs should show progress and per-object errors, and be resumable.
4. The system should support incremental syncs so changes made during migration are copied before cutover.

**Below the line (out of scope):**

- Database schema migration.
- Physical transfer appliances (shipping disks).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Throughput: saturate available bandwidth (e.g. 10-100 Gbps) using many parallel workers.
2. Correctness: no silent corruption or missed files; every object verified.
3. Fault tolerant: worker or network failures resume without recopying completed data.
4. Controllable: bandwidth limits so production traffic on the source isn't harmed.

**Below the line (out of scope):**

- Real-time replication forever.

```sketch Migration Requirements
Functional
- create job: source -> destination
- copy + preserve metadata
- progress, errors, resume
- incremental syncs before cutover

Non-functional
- saturate bandwidth
- verify every object
- resume after failures
- bandwidth throttling
```

## The Set Up

### Defining the Core Entities

1. **Job**: source, destination, filters, schedule, bandwidth limit, status.
2. **Manifest entry**: one object to copy — path, size, mtime, checksum, state.
3. **Task**: a batch of manifest entries (or chunks of a large file) assigned to a worker.
4. **Agent**: a worker running near the source with network access to both ends.

### API or System Interface

```
POST /migrations { "source": "nfs://dc1/share", "destination": "gs://bucket/prefix", "bandwidthLimitGbps": 5 } -> Job
GET  /migrations/:id -> { status, bytesCopied, objectsCopied, errors }
POST /migrations/:id/sync     (incremental pass)
```

## High-Level Design

### 1) Create a job and build a manifest

A **Coordinator** lists the source (in parallel, by directory) and writes a **manifest** of objects to copy into a database. Listing billions of files is itself a big job, so it is split across workers too.

```diagram Migration architecture
node src 0,1 circle "Source|(on-prem / cloud)"
node agents 1.5,1 box "Transfer Agents|- parallel chunks|- checksums"
node coord 1.5,2.4 box "Coordinator|- manifest|- task leases"
node db 3,2.4 circle "Manifest DB"
node dst 3,1 circle "Cloud Bucket"
edge agents <-> src "read"
edge agents -> dst "multipart upload"
edge coord <-> agents "tasks + heartbeats"
edge coord <-> db
```

### 2) Copy and verify objects

Agents lease tasks from the coordinator, read objects from the source and upload them with **multipart uploads** (large files split into chunks uploaded in parallel). Each chunk's checksum is sent with the upload so the destination rejects corrupted parts; after completion the agent compares the whole-object checksum, then marks the manifest entry done.

### 3) Progress, errors and resumability

The manifest is the source of truth: entries move from `PENDING → IN_PROGRESS → VERIFIED` (or `FAILED` with an error). If an agent dies, its task leases expire and are reassigned; completed parts of multipart uploads are reused rather than resent.

### 4) Incremental sync before cutover

Later passes re-list the source and copy only objects whose size, mtime or checksum changed since the last pass. Each pass gets smaller; at cutover, writes to the source are frozen briefly, a final sync runs, and applications switch to the cloud.

## Potential Deep Dives

### 1) How do we maximise throughput?

:::solution bad A single copy process
#### Approach

Run one `cp -r` from a single machine.

#### Challenges

Limited by one machine's network and disk; one failure restarts everything.
:::

:::solution great Many agents, parallel chunks, small-file batching
#### Approach

Scale out agents near the source. Large files go as parallel multipart chunks; millions of tiny files are batched per task (and optionally packed) to amortise per-request overhead. A token-bucket limiter per agent enforces the bandwidth cap and can follow a schedule (faster at night).

#### Challenges

Per-object API overhead dominates for small files, and destination rate limits per prefix may require spreading key names.
:::

### 2) How do we guarantee nothing is lost or corrupted?

Verify end to end: checksum at the source, per-chunk checksums during upload, and a whole-object checksum comparison at the destination. After the copy, run a **reconciliation**: compare source and destination listings (count, sizes, checksums) and report any differences. Never mark a job complete on "no errors seen" alone.

### Final Design

```diagram Final Design
node user 0,0 box "User / Console"
node coord 1.5,0 box "Coordinator|- listing|- leases|- reconciliation"
node db 3,0 circle "Manifest DB"
node src 0,1.6 circle "Source"
node agents 1.5,1.6 box "Agent Fleet|- multipart|- checksums|- throttling"
node dst 3,1.6 circle "Cloud Bucket"
edge user <-> coord
edge coord <-> db
edge coord <-> agents
edge agents <-> src
edge agents -> dst
edge coord <-> dst "verify listing"
```

```quiz
[
  {
    "question": "What is the manifest used for?",
    "options": ["Billing", "Tracking every object to copy and its state, enabling progress and resume", "Encrypting data", "DNS"],
    "answer": 1,
    "explanation": "It's the source of truth for what's done and what remains."
  },
  {
    "question": "How do you reduce downtime at cutover?",
    "options": ["Copy everything during a long outage", "Run incremental syncs until the delta is tiny, then freeze writes for a final pass", "Skip verification", "Copy only new files"],
    "answer": 1,
    "explanation": "Each pass shrinks; the final freeze is short."
  },
  {
    "question": "Why batch many small files per task?",
    "options": ["Small files are corrupt", "Per-object overhead dominates throughput for tiny files", "For encryption", "Destinations reject them"],
    "answer": 1,
    "explanation": "Batching amortises request overhead."
  },
  {
    "question": "What proves the migration is complete?",
    "options": ["No errors logged", "A reconciliation comparing source and destination counts, sizes and checksums", "Time elapsed", "User confirmation"],
    "answer": 1,
    "explanation": "Positive verification catches silently missed objects."
  }
]
```
