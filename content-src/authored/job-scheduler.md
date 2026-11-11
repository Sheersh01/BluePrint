---
title: Job Scheduler
seoTitle: Design a Distributed Job Scheduler
description: Design a distributed job scheduler — one-off and recurring jobs, executing within seconds of their scheduled time, at-least-once delivery, retries and status tracking.
tags: Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Google, Stripe | 11
---

## Understanding the Problem

:::definition ⏰ What is a Job Scheduler?
A job scheduler runs tasks at a specified time or on a recurring schedule — "send this email in 2 hours", "rebuild the report every night at 2am" — across a fleet of workers.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to schedule a job to run immediately, at a future time, or on a recurring (cron) schedule.
2. Users should be able to monitor the status of their jobs (pending, running, succeeded, failed).

**Below the line (out of scope):**

- Job dependencies (DAGs).
- Cancelling or editing jobs after creation.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Jobs should start within ~2 seconds of their scheduled time.
2. The system should be highly available and never silently drop a job (at-least-once execution).
3. It should scale to 10,000 job executions per second.
4. Jobs can fail; the system should retry them with backoff.

**Below the line (out of scope):**

- Exactly-once execution guarantees (jobs should be idempotent).
- Resource isolation between tenants.

```sketch Job Scheduler Requirements
Functional
- schedule job: now / at time / cron
- monitor job status

Non-functional
- start within 2s of scheduled time
- at-least-once, never drop a job
- 10k executions / sec
- retries with backoff
```

## The Set Up

### Planning the Approach

The key modelling insight is to separate the **job definition** (what to run and its schedule) from each **execution** (one concrete run at one time). Recurring jobs produce many executions.

### Defining the Core Entities

1. **Job**: the task definition — type, parameters, and schedule (one-off time or cron expression).
2. **Execution**: one scheduled run of a job — execution time, status, attempt count.
3. **Worker**: a machine that runs executions.

```sketch Job Scheduler Entities
Core Entities
- Job (definition + schedule)
- Execution (one run)
- Worker
```

### API or System Interface

```
POST /jobs
{
  "task": "send_email",
  "params": { "to": "user@example.com" },
  "schedule": { "type": "CRON", "expression": "0 2 * * *" }
} -> Job

GET /jobs/:jobId/executions?status&cursor -> Execution[]
```

## High-Level Design

### 1) Users should be able to schedule jobs

A **Job Service** validates the request and writes a Job row, then writes the first Execution row with its `scheduledAt` time and status `PENDING`. For recurring jobs, the next execution is created when the current one is picked up.

### 2) Executions should run at their scheduled time

A **Watcher** periodically queries for executions that are due and pushes them onto a queue; **Workers** consume from the queue and run them.

```diagram Basic scheduling
node client 0,1 box "Client"
node api 1.2,1 box "Job Service"
node db 2.5,1 circle "Jobs DB"
node watcher 2.5,2.2 box "Watcher|- poll due executions"
node q 3.8,2.2 circle "Queue"
node workers 3.8,1 box "Workers"
note 3,0.25 "Execution|- jobId|- scheduledAt|- status|- attempt"
edge client <-> api "POST /jobs"
edge api -> db
edge watcher <-> db "due now?"
edge watcher -> q
edge q -> workers
edge workers -> db "update status"
```

### 3) Users should be able to monitor their jobs

Workers update the Execution status as they progress. The status API reads executions by `jobId` (and by user), so we index Executions on `(jobId, scheduledAt)`.

## Potential Deep Dives

### 1) How do we start jobs within 2 seconds of their scheduled time?

:::solution bad Poll the database every few seconds for due jobs
#### Approach

The Watcher runs `SELECT * FROM executions WHERE scheduled_at <= now() AND status = 'PENDING'` every couple of seconds.

#### Challenges

At 10k executions per second this is a heavy, constant query on the primary database, and frequent polling still adds up to the poll interval of delay.
:::

:::solution great Two-tier scheduling: DB for the long term, delayed queue for the near term
#### Approach

Query the database only every few minutes for executions due in the **next window** (say 5 minutes) and enqueue them into a queue that supports per-message delivery delays (e.g. SQS delay seconds, or a Redis sorted set scored by time). The queue releases each message at its exact time, so workers see it within milliseconds. Jobs created for "now" or within the current window skip the database scan and go straight to the delayed queue.

#### Challenges

The window boundary needs care so jobs aren't missed or double-enqueued — enqueueing is idempotent by execution ID, and status moves from `PENDING` to `QUEUED` with a conditional update.
:::

### 2) How do we make sure no job is ever dropped?

:::solution good Workers mark status in the database
#### Approach

Workers set status to `RUNNING` when they start and `SUCCEEDED` when they finish.

#### Challenges

If a worker crashes mid-job, the execution is stuck in `RUNNING` forever.
:::

:::solution great Visibility timeouts + heartbeats + retries
#### Approach

Workers receive messages with a **visibility timeout**: if they don't acknowledge in time (because they crashed), the queue redelivers the message to another worker. Long jobs extend the timeout with heartbeats. Failures are retried with exponential backoff up to a max attempt count, after which the execution goes to a dead-letter queue and is marked `FAILED`.

#### Challenges

This is at-least-once delivery, so a job may run twice (e.g. a worker finishes but crashes before acking). Jobs must be **idempotent** — pass an idempotency key (the execution ID) to downstream systems.
:::

:::pattern Pattern: Managing Long Running Tasks
Decoupling submission from execution with a durable queue and tracking status separately is the core of this pattern.
:::

### 3) How do we scale to 10k executions per second?

Partition the Executions table by time bucket (e.g. hourly) so the scheduler only touches the hot partition, and keep historical executions in cheaper storage. Run multiple Watchers that each own a shard of jobs (by `hash(jobId)`), coordinated via leases so two watchers never scan the same shard. Workers scale horizontally on queue depth.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node api 1.2,1.2 box "Job Service"
node db 2.5,0.3 circle "Jobs DB|(partitioned by time)"
node watcher 2.5,1.6 box "Watchers|- scan next 5 min|- sharded by jobId"
node dq 3.8,1.6 circle "Delayed Queue"
node workers 5,1.6 box "Workers|- heartbeat|- retry w/ backoff"
node dlq 5,0.4 circle "DLQ"
edge client <-> api
edge api -> db
edge api -> dq "due soon"
edge watcher <-> db
edge watcher -> dq
edge dq -> workers
edge workers -> dlq "max attempts"
edge workers -> db "status"
```

```quiz
[
  {
    "question": "Why model Job and Execution as separate entities?",
    "options": ["To save storage", "A recurring job produces many independent executions with their own status", "Because cron requires it", "To avoid indexes"],
    "answer": 1,
    "explanation": "Each run has its own time, attempts and status; the job only defines what and when."
  },
  {
    "question": "What ensures a job is retried if its worker crashes?",
    "options": ["A bigger worker", "The queue's visibility timeout redelivers unacknowledged messages", "Database triggers", "Client polling"],
    "answer": 1,
    "explanation": "Unacked messages become visible again after the timeout and are picked up by another worker.",
    "section": "2-how-do-we-make-sure-no-job-is-ever-dropped"
  },
  {
    "question": "With at-least-once delivery, what property must jobs have?",
    "options": ["Idempotency", "Statelessness of the database", "Encryption", "Short names"],
    "answer": 0,
    "explanation": "A job may run more than once; idempotent jobs make duplicates harmless."
  },
  {
    "question": "How does the two-tier design achieve ~2s precision without hammering the database?",
    "options": ["Polling every 100ms", "Scanning the DB occasionally for the next window and using a delayed queue for exact timing", "Running every job immediately", "Caching the cron expressions"],
    "answer": 1,
    "explanation": "The DB is scanned every few minutes; the delayed queue releases each message at its precise time.",
    "section": "1-how-do-we-start-jobs-within-2-seconds-of-their-scheduled-time"
  }
]
```
