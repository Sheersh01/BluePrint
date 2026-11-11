---
title: GPU Job Manager
seoTitle: Design an Interface for Managing and Running Jobs across GPUs
description: Design a system for submitting and running jobs across a GPU cluster — job queues, quotas and priorities, gang scheduling, topology-aware placement, preemption with checkpoints, and live job status and logs.
tags: Managing Long Running Tasks, Dealing with Contention
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🖥️ What is a GPU Job Manager?
Teams training and running ML models share an expensive cluster of GPU machines. A GPU job manager is the interface and scheduler they use: submit a job ("train this model on 64 GPUs"), see it queue, start, and stream logs, and cancel or resubmit it. Behind it, the scheduler decides which jobs run where, keeps usage fair across teams, and keeps the GPUs busy.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to submit a job with a container image, command, and resources (e.g. 8 nodes × 8 GPUs, GPU type).
2. Users should see job status (queued, running, succeeded, failed), position in the queue, live logs and GPU metrics.
3. Users should be able to cancel jobs; failed jobs can be retried automatically.
4. Admins should set quotas and priorities per team.

**Below the line (out of scope):**

- Serving inference endpoints.
- Dataset management.
- Cost billing between teams (mentioned briefly).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. High GPU utilisation (> 85%): idle GPUs are very expensive.
2. Fairness: teams get their guaranteed share; idle capacity is borrowed but returned quickly.
3. Distributed jobs start all at once (all 64 GPUs together) and are placed for fast interconnect.
4. Tolerate hardware failures: GPUs and nodes fail regularly at scale; jobs recover from checkpoints.
5. Scale to ~10k GPUs and thousands of queued jobs.

**Below the line (out of scope):**

- Multi-cluster federation across regions (mentioned briefly).

```sketch GPU Jobs Requirements
Functional
- submit: image, command, GPUs
- status, queue position, logs
- cancel + auto-retry
- team quotas + priorities

Non-functional
- > 85% utilisation
- fair share + borrowing
- all-or-nothing start, good placement
- survive hardware failures
- 10k GPUs
```

## The Set Up

### Defining the Core Entities

1. **Job**: owner, team, image, command, resources, priority, status, retries.
2. **Node**: GPUs (type, count), health, rack/network topology.
3. **Allocation**: which GPUs on which nodes a job holds.
4. **Queue / quota**: per team, guaranteed GPUs and maximum borrowable GPUs.
5. **Checkpoint**: saved training state in object storage.

### API or System Interface

```
POST /jobs { image, command, nodes: 8, gpusPerNode: 8, gpuType: "H100", priority, maxRetries }
GET  /jobs/:id -> { status, queuePosition, allocation, startedAt }
GET  /jobs/:id/logs?follow=true      (streamed)
DELETE /jobs/:id
PUT  /teams/:id/quota { guaranteedGpus, maxGpus }
```

## High-Level Design

### 1) Submitting jobs

The **Job API** validates the request against the team's quota, stores the job in the **job database** as `queued`, and notifies the scheduler. The UI and CLI read the same API.

### 2) Scheduling

The **scheduler** runs in a loop: it orders queued jobs by priority and team fair-share, and for each, tries to find a **placement** for all its GPUs at once (**gang scheduling**). When it finds one, it records the allocation and tells the **node agents** on those machines to start the containers.

```diagram Scheduling
node user 0,1 box "UI / CLI"
node api 1.6,1 box "Job API"
node db 3.2,1 circle "Job DB"
node sched 3.2,-0.3 box "Scheduler|fair share + gang"
node agents 4.8,-0.3 box "Node Agents"
node gpus 4.8,1 circle "GPU Nodes"
edge user <-> api
edge api <-> db
edge sched <-> db
edge sched -> agents "start job"
edge agents -> gpus
```

### 3) Running and monitoring

Node agents start containers, report status and heartbeats, and ship logs to a **log service** that users can follow live. GPU metrics (utilisation, memory, temperature) flow into the metrics system and are shown per job.

### 4) Failures and retries

If a node fails, its agent stops heartbeating; the scheduler marks the job's allocation failed, stops the remaining processes and **requeues** the job (up to `maxRetries`). The job resumes from its latest **checkpoint**. Bad nodes are cordoned for repair.

## Potential Deep Dives

### 1) How do we share GPUs fairly but keep them busy?

:::solution bad First come, first served
#### Approach

One global queue in submission order.

#### Challenges

One team submitting hundreds of jobs starves everyone else, and big jobs block small ones behind them.
:::

:::solution good Static quotas per team
#### Approach

Each team gets a fixed number of GPUs and can never exceed it.

#### Challenges

Fair, but when a team is idle its GPUs sit unused while others wait.
:::

:::solution great Guaranteed quotas with borrowing and preemption
#### Approach

Each team has a **guaranteed share**; idle capacity can be **borrowed** by others at lower priority. When the owner submits work, the scheduler **preempts** borrowed jobs (with notice, so they can checkpoint) to give capacity back. Within a team, priority classes order jobs, and **backfilling** lets small jobs run in gaps while a large job waits for enough GPUs — as long as they won't delay its start.

#### Challenges

Preemption only works if jobs checkpoint frequently; the platform should provide checkpointing libraries and make it the default.
:::

### 2) Why does placement matter?

Distributed training exchanges gradients constantly, so a 64-GPU job is much faster on nodes connected by the same high-speed network fabric (e.g. within one InfiniBand leaf switch) than spread across the data centre. The scheduler is **topology-aware**: it prefers placements within one rack or switch group and avoids fragmenting groups with small jobs. Gang scheduling avoids deadlock where two big jobs each hold half the GPUs they need and wait forever.

:::tip
Mention fragmentation: small jobs scattered across nodes can leave no complete 8-GPU node free. Pack small jobs onto partially used nodes first.
:::

### 3) How do we handle failures at scale?

With 10k GPUs, some hardware fails daily. Node agents run **health checks** (GPU errors, network tests) before and during jobs; suspect nodes are drained. Jobs write checkpoints to object storage every N minutes, and the scheduler requeues failed jobs with **priority** so they restart soon. For very large jobs, keeping a few **hot spare** nodes lets a job replace a failed node in minutes instead of waiting in the queue.

### Final Design

```diagram Final Design
node user 0,1 box "UI / CLI"
node api 1.5,1 box "Job API|quota checks"
node db 3,1 circle "Job + Quota DB"
node sched 3,-0.3 box "Scheduler|fair share · gang · topology"
node agents 4.5,1 box "Node Agents|health + heartbeats"
node gpus 6,1 circle "GPU Cluster"
node logs 4.5,2.3 box "Logs + Metrics"
node s3 6,2.3 circle "Checkpoints"
edge user <-> api
edge api <-> db
edge sched <-> db
edge sched -> agents
edge agents -> gpus
edge agents -> logs
edge gpus -> s3
edge user <-> logs "follow logs"
```

```quiz
[
  {
    "question": "What is gang scheduling?",
    "options": ["Scheduling by team name", "Starting all of a distributed job's processes together, or none of them", "Scheduling at night", "Random placement"],
    "answer": 1,
    "explanation": "It avoids partial starts and deadlocks between big jobs."
  },
  {
    "question": "How can idle GPUs be used without breaking guarantees?",
    "options": ["They can't", "Other teams borrow them at lower priority and are preempted when the owner needs them", "Turn them off", "Give them to the biggest team"],
    "answer": 1,
    "explanation": "Borrowing with preemption keeps utilisation high and quotas intact."
  },
  {
    "question": "Why place a distributed job within one network switch group?",
    "options": ["It's cheaper", "Gradient exchange is much faster on the same high-speed fabric", "For security", "Racks have more power"],
    "answer": 1,
    "explanation": "Topology-aware placement shortens training time."
  },
  {
    "question": "What makes preemption and failures tolerable?",
    "options": ["Bigger GPUs", "Frequent checkpoints so jobs resume where they left off", "Longer timeouts", "Fewer jobs"],
    "answer": 1,
    "explanation": "Checkpoints turn restarts into small delays."
  }
]
```
