---
title: Sorting Large Data Sets
seoTitle: Design a System to Sort Terabytes of Data
description: Design a system to sort data far larger than memory — external merge sort, distributed range partitioning with sampling, and fault-tolerant execution.
tags: Managing Long Running Tasks
difficulty: easy
author: Editorial Team
published: Nov 10, 2026
askedAt: Google, Microsoft | 0
---

## Understanding the Problem

:::definition 🗂️ What is Large-Scale Sorting?
Sorting a dataset that doesn't fit in one machine's memory — say 10TB of log records sorted by timestamp — requires splitting the work across disk and many machines, then combining the results.
:::

### Functional Requirements

**Core Requirements**

1. Given an input dataset (files in blob storage), produce output files sorted by a key.
2. Output should be globally sorted: concatenating output files in order yields a sorted dataset.
3. Users should be able to submit a sort job and track its progress.

**Below the line (out of scope):**

- Streaming (continuously arriving) data.
- Custom user code beyond a key extractor.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Handle datasets of 10TB+ with machines that have, say, 64GB of RAM.
2. Finish in reasonable time by scaling out to hundreds of workers.
3. Tolerate worker failures without restarting the whole job.

**Below the line (out of scope):**

- Sub-second latency.

```sketch Sorting Requirements
Functional
- sort files by key
- globally sorted output
- submit + track jobs

Non-functional
- 10TB+ input, 64GB RAM nodes
- scale out to 100s of workers
- tolerate worker failures
```

## The Set Up

### Defining the Core Entities

1. **Job**: input location, key, output location, status.
2. **Task**: a unit of work (sort a chunk, or merge a partition) assigned to a worker.
3. **Run**: a sorted intermediate file written by a task.

### API or System Interface

```
POST /sort-jobs { "input": "s3://logs/2026/", "key": "timestamp", "output": "s3://sorted/" } -> { jobId }
GET  /sort-jobs/:id -> { status, progress }
```

## High-Level Design

### 1) Sort data larger than one machine's memory

On a single machine, use **external merge sort**:

1. Read the input in chunks that fit in memory (e.g. 50GB), sort each chunk in memory, and write it to disk as a sorted **run**.
2. Merge all runs with a k-way merge using a min-heap: repeatedly emit the smallest head among the runs.

This reads and writes the data a small number of times and never needs it all in memory.

### 2) Produce globally sorted output across many machines

Split the work into two phases, like MapReduce:

```diagram Distributed sort with range partitioning
node in 0,1 circle "Input|(S3)"
node samp 1.3,0 box "Sampler|- pick split points"
node map 1.3,1.5 box "Map Workers|- read chunk|- route by range"
node red 2.8,1.5 box "Reduce Workers|- merge one range"
node out 4.2,1.5 circle "Output|part-0..N|(sorted)"
edge in -> samp
edge samp -> map "split points"
edge in -> map
edge map -> red "shuffle"
edge red -> out
```

1. **Sample** the input to choose N−1 split points that divide the key space into N ranges of roughly equal size.
2. **Map**: workers read input chunks and send each record to the reducer responsible for its key range.
3. **Reduce**: each reducer sorts (external merge) the records it received and writes `part-i`. Because ranges don't overlap, `part-0, part-1, ...` concatenated is globally sorted.

### 3) Track progress

A **coordinator** splits the job into tasks, assigns them to workers, and records task status, which the status API reports.

## Potential Deep Dives

### 1) How do we keep partitions balanced?

:::solution bad Fixed key ranges
#### Approach

Divide the key space evenly (e.g. by first letter).

#### Challenges

Real data is skewed — most keys may start with "s" — so one reducer gets most of the work and the job is as slow as that straggler.
:::

:::solution great Sample-based split points
#### Approach

Take a random sample of keys (e.g. 0.1%), sort it, and pick evenly spaced quantiles as split points. Ranges then hold roughly equal record counts.

#### Challenges

Heavily duplicated keys can still overload one range; break ties with a secondary key.
:::

### 2) How do we handle worker failures and stragglers?

:::solution good Restart the whole job
#### Approach

If anything fails, start over.

#### Challenges

On a multi-hour job with hundreds of workers, some failure is almost guaranteed.
:::

:::solution great Task-level retries and speculative execution
#### Approach

The coordinator tracks each task; if a worker stops heartbeating, its task is rescheduled elsewhere. Intermediate outputs are written durably, so completed map tasks aren't redone. Near the end, slow tasks are **speculatively** duplicated on other workers and whichever finishes first wins.

#### Challenges

Task outputs must be written atomically (write to a temp path, then rename) so duplicates don't corrupt results.
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node coord 1.3,1.2 box "Coordinator|- tasks + heartbeats|- speculative exec"
node samp 2.8,0 box "Sampler"
node map 2.8,1.2 box "Map Workers"
node red 2.8,2.4 box "Reduce Workers|external merge"
node s3 4.3,1.2 circle "Blob Storage|input / runs / output"
edge client <-> coord "submit / status"
edge coord -> samp
edge coord -> map
edge coord -> red
edge map <-> s3
edge red <-> s3
edge samp <-> s3
```

```quiz
[
  {
    "question": "What is external merge sort?",
    "options": ["Sorting entirely in memory", "Sorting memory-sized chunks into runs on disk, then k-way merging them", "Sorting on GPUs", "Using a hash table"],
    "answer": 1,
    "explanation": "It handles data larger than RAM with a few sequential passes."
  },
  {
    "question": "Why is output part-0..part-N globally sorted when concatenated?",
    "options": ["Reducers coordinate constantly", "Each reducer owns a non-overlapping key range, and ranges are ordered", "Files are sorted again afterwards", "Luck"],
    "answer": 1,
    "explanation": "Range partitioning guarantees every key in part-i precedes every key in part-(i+1)."
  },
  {
    "question": "How are balanced split points chosen?",
    "options": ["Evenly across the alphabet", "From quantiles of a random sample of keys", "Randomly", "By file size"],
    "answer": 1,
    "explanation": "Sampling reflects the real key distribution, including skew."
  },
  {
    "question": "What is speculative execution?",
    "options": ["Guessing results", "Running duplicate copies of slow tasks and using whichever finishes first", "Skipping failed tasks", "Sorting twice"],
    "answer": 1,
    "explanation": "It reduces the impact of straggling workers on total job time."
  }
]
```
