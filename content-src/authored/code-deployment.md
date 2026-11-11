---
title: Code Deployment
seoTitle: Design a Code Deployment System
description: Design a code deployment system — building versioned artefacts once, distributing them to thousands of servers, rolling and canary deployments with health checks, automatic rollback, and a deploy pipeline across environments.
tags: Multi-step Processes, Managing Long Running Tasks
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🚀 What is a Code Deployment System?
A deployment system takes a commit that has passed CI and gets it running on production servers — safely. It builds an artefact once, ships it to every machine across regions, replaces the old version gradually while watching health, and rolls back automatically when something goes wrong. Facebook, Google and Netflix (Spinnaker) all run internal systems like this.
:::

### Functional Requirements

**Core Requirements**

1. Engineers should be able to deploy a specific build of a service to an environment (staging, production).
2. Deployments should roll out gradually (canary, then waves) across thousands of hosts in several regions.
3. Health should be checked during rollout; bad deploys should halt and roll back automatically.
4. Users should see deployment progress and history, and be able to roll back with one click.

**Below the line (out of scope):**

- Running tests (that's CI — see GitHub Actions).
- Database schema migrations (mentioned briefly).
- Infrastructure provisioning.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Safety: a bad build reaches only a small fraction of traffic before it's stopped.
2. Zero downtime during deploys.
3. Speed: a full production rollout within ~1 hour; rollback within minutes.
4. Scale to ~100k hosts and hundreds of deploys per day.
5. Auditable: who deployed what, where and when.

**Below the line (out of scope):**

- Mobile app releases.

```sketch Deployment Requirements
Functional
- deploy build X to env Y
- canary, then waves across regions
- health checks + auto rollback
- progress, history, one-click rollback

Non-functional
- small blast radius
- zero downtime
- rollout ~1h, rollback minutes
- 100k hosts
- auditable
```

## The Set Up

### Defining the Core Entities

1. **Artefact**: an immutable, versioned build output (container image or tarball) with a content hash.
2. **Service**: deploy target with environments, host groups and health metrics.
3. **Deployment**: service, artefact version, environment, strategy, status, current stage.
4. **Stage**: a step in the rollout — canary (1%), region A (10%), region A (100%), region B…
5. **Host agent**: software on each host that installs and reports versions.

### API or System Interface

```
POST /deployments { service, version, environment, strategy: "canary-waves" }
GET  /deployments/:id -> { status, stages: [{ name, hosts, healthy, status }] }
POST /deployments/:id/pause | resume | rollback
(agent) GET /hosts/:id/desired -> { service, version }   POST /hosts/:id/status
```

## High-Level Design

### 1) Build once, deploy everywhere

CI produces an **immutable artefact** (container image), stored in an artefact registry and tagged with commit and version. The same artefact goes to staging and production, so what was tested is exactly what ships.

### 2) The deployment orchestrator

A deployment is a **workflow** of stages. The **Deploy Orchestrator** (a durable workflow, e.g. on Temporal) sets the **desired version** for the hosts in the current stage, waits for them to converge, checks health for a bake period, then moves to the next stage.

```diagram Rollout
node eng 0,1 box "Engineer / CI"
node orch 1.6,1 box "Deploy Orchestrator|stages + gates"
node desired 3.2,1 circle "Desired State"
node agents 4.8,1 box "Host Agents"
node reg 4.8,-0.3 circle "Registry"
node metrics 1.6,2.3 box "Health Metrics"
edge eng -> orch "deploy v42"
edge orch -> desired "set stage hosts"
edge agents -> desired "poll"
edge agents <-> reg "pull"
edge metrics -> orch "gate checks"
```

### 3) Host agents converge

Each host runs an **agent** that polls its desired state. When the desired version changes, it downloads the artefact, drains traffic from the old instance (removing it from the load balancer), starts the new one, runs a local health check, and re-registers. It reports status back.

### 4) Progress and history

Every state change is recorded, so the UI shows each stage's progress and the full history. Rollback is just another deployment to the previous artefact version, using a faster strategy.

## Potential Deep Dives

### 1) Which rollout strategy?

:::solution bad Deploy to all hosts at once
#### Approach

Push the new version everywhere simultaneously.

#### Challenges

A bad build takes down the whole service, and there's a capacity dip while everything restarts.
:::

:::solution good Rolling deploy in batches
#### Approach

Replace hosts in batches (e.g. 10% at a time), keeping enough capacity serving.

#### Challenges

Without health gates, a bad build still rolls through every batch.
:::

:::solution great Canary + waves with automated gates
#### Approach

First deploy to a **canary** (a few hosts or 1% of traffic) and compare its error rate, latency and key business metrics against the old version's hosts for a **bake period**. If metrics are within thresholds, proceed in **waves** — one region at a time, growing in size — with a gate after each. Any gate failure **halts and rolls back** automatically. Blue-green deploys (switching traffic between two full fleets) are an option for services where mixed versions can't coexist.

#### Challenges

Canary analysis needs good metrics and statistical comparison so noise doesn't block deploys or let regressions through.
:::

### 2) How do we distribute artefacts to 100k hosts quickly?

A single registry serving a 500 MB image to 100k hosts would need enormous bandwidth. Use a **regional cache** of the registry in each data centre, and **peer-to-peer distribution** (BitTorrent-style, as in Facebook's and Uber's systems) so hosts download chunks from each other. Since rollout is staged, later waves find the artefact already cached nearby.

:::tip
Mention backward compatibility: during a rollout, old and new versions run side by side, so APIs and database changes must work with both (expand-then-contract migrations).
:::

### 3) Why do agents pull desired state instead of the server pushing?

A pull model scales to many hosts (agents poll a replicated store), survives orchestrator restarts (desired state is durable), and self-heals: a host that was offline converges when it comes back. The orchestrator only writes desired state and reads reported state, which also makes the system easy to reason about — the same idea as Kubernetes controllers.

### Final Design

```diagram Final Design
node eng 0,1 box "Engineers / CI"
node api 1.4,1 box "Deploy API|auth + audit"
node orch 2.8,1 box "Orchestrator|durable workflows"
node desired 4.2,1 circle "Desired State"
node agents 5.6,1 box "Host Agents|drain · swap · check"
node reg 5.6,-0.3 box "Registry|+ regional caches + P2P"
node canary 2.8,-0.3 box "Canary Analysis"
node metrics 4.2,-0.3 circle "Metrics"
node lb 5.6,2.3 box "Load Balancers"
edge eng <-> api
edge api -> orch
edge orch <-> desired
edge agents <-> desired
edge agents <-> reg
edge canary -> orch "gate"
edge metrics -> canary
edge agents <-> lb "drain / register"
```

```quiz
[
  {
    "question": "Why build the artefact once and promote it through environments?",
    "options": ["To save disk", "So exactly what was tested in staging is what runs in production", "Registries charge per build", "It's faster to type"],
    "answer": 1,
    "explanation": "Rebuilding can introduce differences."
  },
  {
    "question": "What does a canary deployment do?",
    "options": ["Deploys to everyone", "Exposes a small fraction of traffic to the new version and compares health before continuing", "Tests on birds", "Skips health checks"],
    "answer": 1,
    "explanation": "It limits blast radius of a bad build."
  },
  {
    "question": "Why drain a host before replacing its version?",
    "options": ["To save power", "So in-flight requests finish and users see no errors", "For logging", "To speed up downloads"],
    "answer": 1,
    "explanation": "Draining enables zero-downtime deploys."
  },
  {
    "question": "How can artefacts reach 100k hosts quickly?",
    "options": ["One central server", "Regional caches plus peer-to-peer distribution between hosts", "Email", "USB drives"],
    "answer": 1,
    "explanation": "Spreading the download load avoids a bandwidth bottleneck."
  }
]
```
