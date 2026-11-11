---
title: Database Control Plane
seoTitle: Design a Control Plane for a Distributed Database
description: Design the control plane for a managed distributed database — cluster provisioning, desired-state reconciliation, failover, scaling, and safe rolling operations.
tags: Multi-step Processes, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Netflix | 0
---

## Understanding the Problem

:::definition 🎛️ What is a Database Control Plane?
A distributed database has a **data plane** (the nodes that store and serve data) and a **control plane** (the system that creates clusters, scales them, replaces failed nodes, applies upgrades and backups). Managed services like Amazon RDS, Cassandra operators, or Netflix's internal platforms are control planes.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create, resize and delete database clusters via an API.
2. The control plane should detect failed nodes and replace them automatically.
3. The control plane should perform rolling operations — version upgrades and config changes — without downtime.
4. Users should be able to see the status of each cluster and in-progress operations.

**Below the line (out of scope):**

- Query routing (handled by the data plane).
- Billing.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. A control-plane outage must never take down the data plane — databases keep serving traffic.
2. Operations must be safe: never remove more replicas than the cluster can tolerate.
3. Operations are long-running (minutes to hours) and must survive control-plane restarts.
4. Manage thousands of clusters and tens of thousands of nodes.

**Below the line (out of scope):**

- Multi-cloud support.

```sketch Control Plane Requirements
Functional
- create / resize / delete clusters
- auto-replace failed nodes
- rolling upgrades + config changes
- status of clusters + operations

Non-functional
- data plane survives control plane outage
- never violate quorum
- durable long-running operations
- 1000s of clusters
```

## The Set Up

### Defining the Core Entities

1. **Cluster spec (desired state)**: engine version, node count, instance type, config.
2. **Cluster status (observed state)**: nodes, their health, versions, roles.
3. **Node**: a VM/container running the database.
4. **Operation**: a long-running workflow (create, scale, upgrade, replace node) with steps and status.

### API or System Interface

```
POST  /clusters { "engine": "cassandra", "version": "4.1", "nodes": 6, "instanceType": "r6i.2xlarge" }
PATCH /clusters/:id { "nodes": 9 } | { "version": "5.0" }
GET   /clusters/:id -> { spec, status, operations }
DELETE /clusters/:id
```

## High-Level Design

### 1) Users create and resize clusters

The API writes the **desired state** (spec) to a durable store and returns immediately. It doesn't perform the work inline — a **reconciler** notices that desired and observed state differ and launches an operation to close the gap, like a Kubernetes controller.

```diagram Desired-state reconciliation
node user 0,1 box "User / CLI"
node api 1.3,1 box "Control API"
node store 2.6,0.2 circle "State Store|spec + status"
node recon 2.6,1.8 box "Reconciler|diff desired vs observed"
node wf 4,1.8 box "Workflow Engine|(operations)"
node cloud 5.3,1.8 circle "Cloud APIs"
node agents 4,0.2 box "Node Agents|report health"
edge user <-> api
edge api -> store "write spec"
edge recon <-> store
edge recon -> wf "start operation"
edge wf -> cloud "provision"
edge agents -> store "observed state"
```

### 2) Detect and replace failed nodes

An **agent** on every node reports health and database-level status (is it in the ring, is replication caught up). If a node is unhealthy beyond a threshold, the observed state no longer matches the spec, and the reconciler starts a "replace node" operation: provision a new node, join it, stream data, then decommission the old one.

### 3) Rolling operations

Upgrades proceed **one node (or one rack/zone) at a time**: drain, upgrade, restart, wait until healthy and caught up, then continue. Each step is gated by health checks.

### 4) Status

Cluster status and operation progress are read from the state store and surfaced through the API and UI.

## Potential Deep Dives

### 1) How do we run long operations reliably?

:::solution bad Run operations inside API request handlers
#### Approach

Call cloud APIs and wait for completion during the request.

#### Challenges

Operations take hours; any restart loses progress and leaves clusters half-changed.
:::

:::solution great Durable workflows with idempotent steps
#### Approach

Model each operation as a workflow (Temporal, Step Functions, or a state machine persisted in the database). Every step — provision VM, join node, stream data, verify — is idempotent and its result is recorded, so after a crash the workflow resumes exactly where it left off. Only one operation per cluster runs at a time (a per-cluster lock) to avoid conflicting changes.

#### Challenges

Workflow versioning when operation logic changes mid-flight.
:::

### 2) How do we make operations safe?

:::solution good Health checks between steps
#### Approach

Wait for each node to be healthy before moving on.

#### Challenges

Doesn't prevent two independent operations (or an auto-replacement during an upgrade) from taking down multiple replicas at once.
:::

:::solution great Disruption budgets and topology awareness
#### Approach

Before removing or restarting any node, check a **disruption budget**: with replication factor 3 and quorum reads/writes, at most one replica of any token range may be down. Operate by rack/zone so replicas in other zones keep quorum. Automatically pause and alert if error rates or latency regress, and support rollback.

#### Challenges

Requires the control plane to understand the database's replica placement, not just VMs.
:::

### 3) What if the control plane itself goes down?

The data plane must be fully independent: nodes keep serving, replicating and electing leaders without the control plane. The control plane only changes topology. Run it in multiple zones, keep its state in a replicated store, and ensure reconcilers are **level-triggered** (they compare state rather than relying on missed events), so after an outage they simply catch up.

### Final Design

```diagram Final Design
node user 0,1.2 box "Users / UI"
node api 1.3,1.2 box "Control API|- auth, validation"
node store 2.6,0 circle "State Store|(replicated)"
node recon 2.6,1.2 box "Reconcilers|level-triggered"
node wf 2.6,2.4 box "Workflow Engine|- per-cluster lock|- disruption budget"
node cloud 4,2.4 circle "Cloud / K8s APIs"
node nodes 4,1.2 box "DB Nodes + Agents|(data plane)"
node mon 4,0 box "Monitoring|health, metrics"
edge user <-> api
edge api -> store
edge recon <-> store
edge recon -> wf
edge wf -> cloud
edge wf <-> nodes "drain / join"
edge nodes -> mon
edge mon -> store "observed state"
```

```quiz
[
  {
    "question": "What is the most important property of the control plane relative to the data plane?",
    "options": ["It serves queries", "Its outage must not take down the databases", "It stores the data", "It is single-region"],
    "answer": 1,
    "explanation": "Databases keep running; the control plane only changes topology."
  },
  {
    "question": "What does desired-state reconciliation do?",
    "options": ["Runs commands immediately", "Continuously compares spec to observed state and acts to close the gap", "Deletes clusters", "Caches queries"],
    "answer": 1,
    "explanation": "It's the controller pattern used by Kubernetes operators."
  },
  {
    "question": "What is a disruption budget?",
    "options": ["A cost limit", "A limit on how many replicas can be unavailable at once", "A backup schedule", "A rate limit"],
    "answer": 1,
    "explanation": "It ensures operations never break quorum."
  },
  {
    "question": "Why model operations as durable workflows?",
    "options": ["For pretty UIs", "Operations take hours and must resume after control-plane restarts", "Cloud APIs require it", "To avoid health checks"],
    "answer": 1,
    "explanation": "Persisted, idempotent steps make long operations recoverable."
  }
]
```
