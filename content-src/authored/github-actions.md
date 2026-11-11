---
title: GitHub Actions
seoTitle: Design GitHub Actions — a CI/CD Workflow Platform
description: Design GitHub Actions from scratch — triggering workflows from repository events, turning YAML into a job graph, scheduling jobs onto ephemeral runners, isolating untrusted code, streaming logs, caching, and secrets.
tags: Managing Long Running Tasks, Multi-step Processes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition ⚙️ What is GitHub Actions?
GitHub Actions runs automated workflows — build, test, deploy — when something happens in a repository, such as a push or a pull request. A workflow is a YAML file describing **jobs** made of **steps**, with dependencies between jobs. The platform turns each event into runs, schedules jobs onto fresh virtual machines called **runners**, streams logs back, and reports a status check on the commit.
:::

### Functional Requirements

**Core Requirements**

1. Repository events (push, pull request, schedule, manual dispatch) should trigger matching workflows.
2. A workflow's jobs should run in dependency order, with matrix builds expanding into parallel jobs.
3. Each job should run on a clean runner (hosted, or self-hosted by the customer).
4. Users should see live logs and the final status of each step, job and run, and the commit gets a status check.
5. Workflows can use encrypted secrets and cache dependencies between runs.

**Below the line (out of scope):**

- The Actions marketplace.
- Billing for minutes (mentioned briefly).
- Artifact storage details.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Strong isolation: jobs run untrusted code (including from forks), so no job can see another's data or secrets.
2. Jobs start quickly (< 30 seconds queue time for hosted runners in normal conditions).
3. Reliability: every triggered run either completes or fails visibly; none are silently dropped.
4. Scale to millions of jobs per day with big spikes (top of the hour for scheduled workflows).
5. Fair sharing across organisations, with concurrency limits per plan.

**Below the line (out of scope):**

- GPU runners.

```sketch Actions Requirements
Functional
- events trigger workflows
- job graph + matrix
- clean runners (hosted / self-hosted)
- live logs + status checks
- secrets + caching

Non-functional
- strong isolation
- start < 30s
- no silently dropped runs
- millions of jobs / day
- fair across orgs
```

## The Set Up

### Defining the Core Entities

1. **Workflow**: YAML in the repo defining triggers, jobs, steps.
2. **Workflow run**: one execution for an event and commit, with status.
3. **Job**: a unit scheduled onto one runner, with `needs` dependencies and runner labels (`ubuntu-latest`, `self-hosted`).
4. **Step**: a command or action within a job.
5. **Runner**: a machine (ephemeral VM or self-hosted agent) that executes one job at a time.

### API or System Interface

```
(internal) on repo event -> evaluate workflows -> create runs
POST /repos/:r/actions/workflows/:id/dispatches { ref, inputs }
GET  /repos/:r/actions/runs/:id -> { status, jobs[] }
GET  /repos/:r/actions/jobs/:id/logs   (live stream while running)
(runner) long-poll GET /runner/jobs/next?labels=  -> job + short-lived token
(runner) POST /runner/jobs/:id/logs, /steps/:n/status
```

## High-Level Design

### 1) Triggering workflows

Repository events flow onto an **event bus**. The **Workflow Trigger Service** loads the workflow files at that commit, evaluates their `on:` filters (branches, paths), and creates **workflow runs**. A cron scheduler emits events for scheduled workflows.

### 2) Planning jobs

The **orchestrator** parses the YAML into a **job graph** (DAG), expands matrices (e.g. 3 OS × 4 versions = 12 jobs), and enqueues jobs with no unmet dependencies. As jobs finish, it enqueues their dependants, or skips them if a dependency failed.

```diagram Run orchestration
node repo 0,1 box "Repo Events"
node trigger 1.5,1 box "Trigger Service"
node orch 3,1 box "Orchestrator|job DAG"
node db 3,2.3 circle "Runs DB"
node queue 4.5,1 box "Job Queue|by runner label"
node runner 6,1 box "Runners"
edge repo -> trigger
edge trigger -> orch "runs"
edge orch <-> db
edge orch -> queue "ready jobs"
edge runner -> queue "long-poll"
edge runner -> db "status"
```

### 3) Running jobs on runners

Runners **pull** work: an agent on each runner long-polls the job queue for jobs matching its labels. Pull works for self-hosted runners behind firewalls and naturally load-balances. The job comes with a **short-lived token** scoped to that repository and run. For hosted runners, a **fleet manager** keeps a pool of pre-booted VMs per image and destroys each VM after one job.

### 4) Logs, status checks, secrets and caches

The runner streams step logs in chunks to a **log service** (live view through WebSocket/SSE, archived to object storage). Status changes update the run and post a **check** on the commit. Secrets are decrypted and injected only into the job that needs them and masked in logs. Caches are tarballs in object storage keyed by a user-defined key (e.g. lockfile hash), scoped per repository and branch.

## Potential Deep Dives

### 1) How do we isolate untrusted code?

:::solution bad Shared long-lived build machines
#### Approach

Run jobs from many customers on a pool of long-lived servers.

#### Challenges

One job can leave behind malware, read another's files or secrets, or exhaust resources.
:::

:::solution good Containers per job
#### Approach

Run each job in a fresh container on shared hosts.

#### Challenges

Containers share a kernel; a kernel exploit or privileged Docker usage can break out to other tenants.
:::

:::solution great Ephemeral VMs per job + scoped credentials
#### Approach

Each hosted job runs in a **fresh virtual machine** (or microVM) destroyed afterwards, so nothing persists between tenants. Jobs get a **short-lived, repository-scoped token**; workflows from **forked pull requests** get read-only tokens and no secrets by default. Networks are isolated per VM, and cache keys are scoped so one branch can't poison another's cache.

#### Challenges

Boot time — solved with warm pools of pre-booted VMs per image.
:::

### 2) How do we make jobs start fast under spiky load?

Many scheduled workflows fire at `0 * * * *`, creating spikes. The fleet manager **forecasts demand** per image and region and keeps warm pools sized ahead of it; the scheduler also **jitters** scheduled triggers within a few minutes. Queues are sharded by runner label and region. **Concurrency limits** per organisation keep one huge customer from consuming the whole pool, with fair queuing between organisations.

:::tip
Mention the reliability contract: a job dequeued by a runner that then disappears (VM crash) is detected by missing heartbeats and requeued or failed visibly, never left "in progress" forever.
:::

### 3) How do we handle logs at scale?

Logs are append-only text streams. Runners batch lines every second to the log service, which writes to a fast store for live tailing and **flushes completed chunks to object storage**. The UI reads live chunks while the job runs and archived blobs afterwards. Secret masking happens on the runner before logs leave the machine.

### Final Design

```diagram Final Design
node repo 0,1 box "Repo Events"
node trig 1.4,1 box "Trigger + Cron"
node orch 2.8,1 box "Orchestrator"
node db 2.8,2.3 circle "Runs DB"
node q 4.2,1 box "Job Queues|label · region · org"
node fleet 4.2,-0.3 box "Fleet Manager|warm VM pools"
node runner 5.6,1 box "Ephemeral Runners"
node logs 5.6,2.3 box "Log Service"
node s3 7,2.3 circle "Logs + Caches"
node secrets 5.6,-0.3 circle "Secrets Vault"
edge repo -> trig
edge trig -> orch
edge orch <-> db
edge orch -> q
edge runner -> q "pull"
edge fleet -> runner "boot"
edge runner -> logs
edge logs -> s3
edge runner <-> secrets
```

```quiz
[
  {
    "question": "Why do runners pull jobs instead of the server pushing them?",
    "options": ["It's faster", "It works for self-hosted runners behind firewalls and balances load naturally", "Servers can't push", "For billing"],
    "answer": 1,
    "explanation": "Runners make outbound requests, so no inbound firewall rules are needed."
  },
  {
    "question": "Why run each hosted job in a fresh VM?",
    "options": ["Cheaper", "So untrusted code can't affect or read other tenants' jobs", "To get more CPU", "Required by YAML"],
    "answer": 1,
    "explanation": "Destroying the VM after each job removes any leftover state."
  },
  {
    "question": "What should workflows triggered by forked PRs get by default?",
    "options": ["Full write tokens and secrets", "Read-only tokens and no secrets", "Admin access", "Nothing runs"],
    "answer": 1,
    "explanation": "Fork code is untrusted and must not exfiltrate secrets."
  },
  {
    "question": "How are top-of-the-hour cron spikes handled?",
    "options": ["Ignore them", "Warm pools sized by forecast plus jittering scheduled triggers", "Reject jobs", "Run them tomorrow"],
    "answer": 1,
    "explanation": "Pre-booted capacity and spreading triggers keep queue times low."
  }
]
```
