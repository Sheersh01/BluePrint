---
title: On-Call Escalation
seoTitle: Design an On-Call Escalation System Like PagerDuty
description: Design an on-call paging system — ingesting alerts, deduplicating into incidents, rotating schedules, escalation policies with timers, and reliable multi-channel notifications.
tags: Multi-step Processes, Managing Long Running Tasks
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Uber | 0
---

## Understanding the Problem

:::definition 📟 What is an On-Call Escalation System?
An on-call system (like PagerDuty or Opsgenie) receives alerts from monitoring tools, works out who is on call, pages them, and escalates to the next person if nobody acknowledges in time.
:::

### Functional Requirements

**Core Requirements**

1. Monitoring systems should be able to send alerts to a service.
2. Duplicate alerts should be grouped into a single incident.
3. Teams should define on-call schedules (rotations) and escalation policies (e.g. page primary, after 5 minutes page secondary, after 10 page the manager).
4. Responders should be notified by push, SMS and phone call, and be able to acknowledge or resolve incidents.

**Below the line (out of scope):**

- Post-incident reports and analytics.
- Chat-ops integrations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Extreme reliability: a page must never be silently lost — this system is used when everything else is broken.
2. Low latency: notifications sent within seconds of an alert.
3. Escalation timers fire on time.
4. Must keep working during regional cloud outages (which is exactly when alerts spike).

**Below the line (out of scope):**

- Billing and user management.

```sketch On-Call Requirements
Functional
- ingest alerts
- dedupe into incidents
- schedules + escalation policies
- notify; ack / resolve

Non-functional
- never lose a page
- notify in seconds
- timers on time
- survive regional outages
```

## The Set Up

### Defining the Core Entities

1. **Alert**: an event from a monitoring source with a dedup key.
2. **Incident**: grouped alerts with status (TRIGGERED → ACKNOWLEDGED → RESOLVED).
3. **Schedule**: rotation of users over time, with overrides.
4. **Escalation policy**: ordered levels, each with targets and a timeout.
5. **Notification**: a delivery attempt to a user on a channel.

### API or System Interface

```
POST /v1/alerts { "serviceKey", "dedupKey": "db-cpu-high", "severity": "critical", "summary" }
POST /incidents/:id/acknowledge
POST /incidents/:id/resolve
GET  /schedules/:id/oncall?at=2026-11-10T03:00Z -> User
```

## High-Level Design

### 1) Ingest alerts

An **Ingestion API** accepts alerts, writes them durably (replicated log), and acknowledges the sender. It must be the most available part of the system — senders retry, so idempotency by `(serviceKey, dedupKey)` prevents duplicates.

### 2) Group into incidents

The **Incident Service** looks up an open incident for the dedup key; if found, it appends the alert, otherwise it creates a new incident in `TRIGGERED` state and starts the escalation workflow.

```diagram Alert to page
node mon 0,1 box "Monitoring|Tools"
node ing 1.3,1 box "Ingestion API"
node log 2.6,1 circle "Durable Log"
node inc 3.9,1 box "Incident Service|- dedup"
node esc 3.9,2.3 box "Escalation Engine|- timers"
node sched 5.2,2.3 circle "Schedules"
node notif 2.6,2.3 box "Notifier|push, SMS, voice"
edge mon -> ing "POST /alerts"
edge ing -> log
edge log -> inc
edge inc -> esc "start policy"
edge esc <-> sched "who is on call?"
edge esc -> notif
```

### 3) Schedules and escalation

The **Escalation Engine** resolves level 1 targets — computing who's on call from the schedule's rotation rules and overrides at that moment — notifies them, and sets a timer for the level's timeout. If the incident is still unacknowledged when the timer fires, it moves to the next level.

### 4) Notify, acknowledge, resolve

The **Notifier** sends push, SMS and voice calls via multiple providers. Acknowledging cancels pending escalation timers; resolving closes the incident.

## Potential Deep Dives

### 1) How do we guarantee pages are never lost?

:::solution bad Fire-and-forget notifications
#### Approach

Call the SMS provider once when the incident triggers.

#### Challenges

Provider outages, rejected numbers or a crash mid-send mean nobody is woken up.
:::

:::solution great Durable escalation workflow with multi-provider delivery
#### Approach

Model each incident's escalation as a durable workflow (state persisted after every step). Notifications go through a queue with retries; each channel has **multiple providers** with automatic failover (if Twilio fails, try another SMS provider). Track delivery receipts, and escalate faster if a notification can't be delivered at all.

#### Challenges

Must dedupe so failover doesn't spam responders with duplicates — idempotency keys per notification attempt.
:::

### 2) How do escalation timers fire reliably?

:::solution good Poll the database for due escalations
#### Approach

A worker queries `WHERE next_escalation_at <= now()` every few seconds.

#### Challenges

Simple and robust at moderate scale; polling delay adds a few seconds.
:::

:::solution great Durable timers in a workflow engine or delayed queue
#### Approach

Schedule a durable timer per escalation level (e.g. a delayed message or Temporal timer). Acknowledgement cancels it; firing re-checks incident state before escalating (so a late timer after ack is a no-op).

#### Challenges

Timers must be checked against current state to stay idempotent.
:::

### 3) How do we stay up during cloud outages?

Run active-active across multiple regions (and ideally multiple cloud providers) with replicated state, use DNS failover for the ingestion endpoint, and avoid depending on the same infrastructure your customers are alerting about. Practise failover regularly — this system can't be the thing that breaks during an incident.

### Final Design

```diagram Final Design
node mon 0,1.2 box "Monitoring Tools"
node ing 1.3,1.2 box "Ingestion API|multi-region"
node log 2.6,1.2 circle "Replicated Log"
node inc 3.9,0.3 box "Incident Service"
node wf 3.9,1.5 box "Escalation Workflows|- durable timers"
node sched 5.2,1.5 circle "Schedules +|Policies"
node q 3.9,2.7 circle "Notification Queue"
node prov 5.2,2.7 box "Providers|SMS / voice / push|with failover"
edge mon -> ing
edge ing -> log
edge log -> inc
edge inc -> wf
edge wf <-> sched
edge wf -> q
edge q -> prov
```

```quiz
[
  {
    "question": "Why deduplicate alerts by a dedup key?",
    "options": ["To save storage only", "So a flapping alert creates one incident instead of hundreds of pages", "For billing", "To encrypt alerts"],
    "answer": 1,
    "explanation": "Grouping prevents paging storms."
  },
  {
    "question": "What happens if a durable escalation timer fires after the incident was acknowledged?",
    "options": ["It pages anyway", "It re-checks state and does nothing", "It resolves the incident", "It crashes"],
    "answer": 1,
    "explanation": "Checking current state keeps timers idempotent."
  },
  {
    "question": "Why use multiple SMS/voice providers?",
    "options": ["Cheaper messages", "Failover so a provider outage doesn't drop pages", "Faster typing", "Legal requirement"],
    "answer": 1,
    "explanation": "Delivery must survive third-party failures."
  },
  {
    "question": "Why must the system be independent of the infrastructure it monitors?",
    "options": ["It's cheaper", "Alerts spike exactly when that infrastructure is failing", "For privacy", "It isn't important"],
    "answer": 1,
    "explanation": "A shared failure would silence the pages."
  }
]
```
