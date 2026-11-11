---
title: Webhook System
seoTitle: Design a Webhook Delivery System
description: Design a webhook delivery system — customers register endpoints, events are delivered reliably with retries and backoff, signed payloads, per-endpoint isolation so slow receivers don't hurt others, and replay.
tags: Managing Long Running Tasks, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🔔 What is a Webhook System?
A webhook system lets a platform (Stripe, GitHub, Shopify) notify its customers' servers when something happens — a payment succeeded, a PR was merged — by sending an HTTP POST to a URL the customer registered. The platform doesn't control those servers: they can be slow, down for hours, or return errors, so delivery has to be reliable, secure and isolated.
:::

### Functional Requirements

**Core Requirements**

1. Customers should register endpoints (URLs) and choose which event types they want.
2. When an event occurs, every matching endpoint should receive it as an HTTP POST.
3. Failed deliveries should be retried with backoff for up to ~3 days.
4. Customers should see delivery attempts and responses, and manually replay events.
5. Receivers should be able to verify that a webhook genuinely came from us.

**Below the line (out of scope):**

- Transforming payloads per customer.
- Polling APIs as an alternative.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. At-least-once delivery: no event is silently dropped.
2. Low latency when receivers are healthy: delivered within seconds.
3. Isolation: a slow or failing endpoint must not delay deliveries to others.
4. Scale to ~50k events per second and millions of endpoints.
5. Security: signed payloads and protection against our servers being used to attack internal networks (SSRF).

**Below the line (out of scope):**

- Exactly-once delivery (receivers dedupe by event ID).
- Strict global ordering.

```sketch Webhook Requirements
Functional
- register endpoints + event types
- POST matching events
- retry with backoff, ~3 days
- delivery logs + replay
- verifiable signatures

Non-functional
- at-least-once
- seconds when healthy
- isolate bad endpoints
- 50k events / s
- signed + SSRF-safe
```

## The Set Up

### Defining the Core Entities

1. **Endpoint**: customer, URL, subscribed event types, signing secret, status (active, disabled).
2. **Event**: ID, type, payload, created at.
3. **Delivery**: event × endpoint, status, attempts, next attempt time.
4. **Attempt**: timestamp, response code, latency, error.

### API or System Interface

```
POST /webhook-endpoints { url, events: ["payment.succeeded"] } -> { id, secret }
GET  /webhook-endpoints/:id/deliveries?status=failed
POST /deliveries/:id/retry
Outgoing: POST {customer url}
  Headers: X-Signature: t=..., v1=HMAC_SHA256(secret, t + "." + body)
  Body: { id, type, created, data }
```

## High-Level Design

### 1) Registering endpoints

Customers create endpoints with the event types they care about; we generate a **signing secret**. URLs are validated (HTTPS, public IPs only) at registration and again at delivery time.

### 2) Fan-out from events to deliveries

Internal services publish domain events to **Kafka**. A **dispatcher** consumes them, looks up which endpoints subscribe to that event type for that customer (cached), and creates one **delivery** per endpoint, enqueuing it for sending.

```diagram Delivery pipeline
node svc 0,1 box "Internal Services"
node kafka 1.5,1 box "Kafka|events"
node disp 3,1 box "Dispatcher|match endpoints"
node q 4.5,1 box "Delivery Queues"
node workers 6,1 box "Sender Workers"
node cust 7.5,1 box "Customer Endpoints"
node db 4.5,2.3 circle "Deliveries DB"
edge svc -> kafka
edge kafka -> disp
edge disp -> q
edge disp -> db
edge q -> workers
edge workers -> cust "signed POST"
edge workers -> db "attempts"
```

### 3) Sending and retrying

**Sender workers** POST the payload with a timestamped **HMAC signature** and a short timeout (~10 s). A 2xx response marks the delivery done. Errors and timeouts schedule a retry with **exponential backoff and jitter** (1 min, 5 min, 30 min, 2 h, … over ~3 days). After the final attempt, the delivery is marked failed and the customer is emailed.

### 4) Visibility and replay

Every attempt is recorded so the dashboard can show request, response code and latency. Customers can **replay** a delivery or all failed deliveries for an endpoint once they've fixed their server.

## Potential Deep Dives

### 1) How do we isolate slow or failing endpoints?

:::solution bad One shared queue
#### Approach

All deliveries go into one queue processed by a worker pool.

#### Challenges

A popular customer's endpoint that takes 10 s per request ties up workers, and every other customer's webhooks wait behind it.
:::

:::solution good Separate retry queue
#### Approach

Send first attempts from a fast queue; failed deliveries move to a delayed retry queue.

#### Challenges

A slow-but-not-failing endpoint still consumes worker time on first attempts.
:::

:::solution great Per-endpoint concurrency limits and circuit breakers
#### Approach

Track each endpoint's **concurrency and latency**. Each endpoint gets a small limit on in-flight requests; excess deliveries wait in that endpoint's own backlog (scheduled in a time-indexed store), not in front of others. An endpoint that keeps failing trips a **circuit breaker**: we pause sending and probe it periodically, then drain its backlog gradually once it recovers. Endpoints failing for days are **disabled** with a notification.

#### Challenges

Millions of per-endpoint backlogs need a scheduler built on a sorted set or database index of `nextAttemptAt`, not millions of queues.
:::

### 2) How do receivers trust and deduplicate webhooks?

Each request includes a **timestamp and HMAC signature** over the timestamp and body using the endpoint's secret; receivers recompute it and reject old timestamps, which defeats replay attacks. Because delivery is at-least-once, the payload carries a stable **event ID** for deduplication. Secrets can be rotated with an overlap period where both old and new signatures are sent.

:::tip
Mention ordering: we don't guarantee it (retries reorder events), so payloads include a timestamp or version and receivers should fetch the latest object state from the API when order matters.
:::

### 3) How do we prevent SSRF?

A customer could register `http://169.254.169.254/` or an internal hostname to make our servers attack our own network. Senders resolve DNS themselves and **refuse private, loopback and link-local addresses** (checking after resolution, to defeat DNS rebinding), run in an isolated network segment with egress only to the internet, don't follow redirects to internal addresses, and cap response sizes.

### Final Design

```diagram Final Design
node svc 0,1 box "Internal Services"
node kafka 1.4,1 box "Kafka"
node disp 2.8,1 box "Dispatcher"
node sub 2.8,-0.3 circle "Endpoint Cache"
node sched 4.2,1 box "Delivery Scheduler|per-endpoint limits"
node db 4.2,2.3 circle "Deliveries DB"
node workers 5.6,1 box "Senders|isolated egress"
node cust 7,1 box "Customer Endpoints"
node dash 2.8,2.3 box "Dashboard + Replay"
edge svc -> kafka
edge kafka -> disp
edge disp <-> sub
edge disp -> sched
edge sched <-> db
edge sched -> workers
edge workers -> cust
edge workers -> db
edge dash <-> db
```

```quiz
[
  {
    "question": "Why include a timestamp in the webhook signature?",
    "options": ["For sorting", "So receivers can reject old requests replayed by an attacker", "To compress the body", "It's required by HTTP"],
    "answer": 1,
    "explanation": "A signed timestamp prevents replay attacks."
  },
  {
    "question": "What prevents one slow customer endpoint from delaying everyone?",
    "options": ["More retries", "Per-endpoint concurrency limits and circuit breakers", "A single big queue", "Longer timeouts"],
    "answer": 1,
    "explanation": "Each endpoint's backlog waits separately."
  },
  {
    "question": "How do receivers handle duplicate deliveries?",
    "options": ["They can't happen", "Deduplicate by the event ID in the payload", "Reject all retries", "Compare response codes"],
    "answer": 1,
    "explanation": "At-least-once delivery means receivers must be idempotent."
  },
  {
    "question": "What is the SSRF risk in webhooks?",
    "options": ["Slow responses", "Customers registering internal addresses to make our servers attack our own network", "Large payloads", "Expired certificates"],
    "answer": 1,
    "explanation": "Block private addresses after DNS resolution and isolate egress."
  }
]
```
