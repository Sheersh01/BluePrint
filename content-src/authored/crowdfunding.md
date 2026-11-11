---
title: Crowdfunding
seoTitle: Design a Crowdfunding Platform like Kickstarter
description: Design a crowdfunding platform — campaigns with goals and deadlines, pledges authorised up front and captured only on success, live funding totals, and the deadline-day surge.
tags: Dealing with Contention, Multi-step Processes, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎯 What is a Crowdfunding Platform?
A crowdfunding platform (Kickstarter, GoFundMe, Indiegogo) lets creators run campaigns with a funding goal and deadline, and lets backers pledge money, often in exchange for rewards. In the "all-or-nothing" model, backers are only charged if the campaign reaches its goal by the deadline.
:::

### Functional Requirements

**Core Requirements**

1. Creators should be able to create a campaign with a goal, deadline and reward tiers (some with limited quantity).
2. Backers should be able to pledge an amount and optionally pick a reward.
3. Everyone should see the campaign's live total and backer count.
4. When the deadline passes, successful campaigns charge all backers; failed campaigns charge no one.

**Below the line (out of scope):**

- Payouts to creators and fraud review.
- Campaign discovery and search.
- Comments and updates.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No backer is charged twice or charged for a failed campaign.
2. Limited rewards must never be oversold.
3. Totals should update within a few seconds.
4. Handle viral campaigns: thousands of pledges per second on a single campaign and a huge surge in the final hours.

**Below the line (out of scope):**

- Strong consistency of the displayed total (a few seconds stale is fine).

```sketch Crowdfunding Requirements
Functional
- campaigns: goal, deadline, rewards
- pledge + pick reward
- live total + backers
- charge only if goal reached

Non-functional
- no double / wrong charges
- no overselling limited rewards
- totals fresh within seconds
- viral hot campaigns
```

## The Set Up

### Defining the Core Entities

1. **Campaign**: creator, goal, currency, deadline, status (`live`, `succeeded`, `failed`).
2. **Reward tier**: price, description, quantity limit, quantity claimed.
3. **Pledge**: backer, campaign, amount, reward, payment method, status (`authorised`, `captured`, `cancelled`, `failed`).

### API or System Interface

```
POST /campaigns { goal, deadline, rewards[] }
GET  /campaigns/:id -> { totalPledged, backers, rewards[], deadline }
POST /campaigns/:id/pledges { amount, rewardId?, paymentMethodId, idempotencyKey }
DELETE /pledges/:id          (cancel before the deadline)
```

## High-Level Design

### 1) Creating campaigns

The **Campaign Service** stores campaigns and reward tiers in a relational database. Campaign pages are mostly static and served through a CDN, except the live total.

### 2) Pledging

Since charges only happen after the deadline, the **Pledge Service** saves the backer's payment method with the payment processor (a stored card or setup intent) and records the pledge. If a reward is limited, it's claimed in the same transaction (below). The pledge is idempotent by key, so a double-clicked button creates one pledge.

```diagram Pledging
node backer 0,1 box "Backer"
node pledge 1.6,1 box "Pledge Service"
node db 3.2,1 circle "Pledges DB"
node pp 1.6,2.3 box "Payment Processor|save card"
node stream 3.2,-0.3 box "Pledge Events"
edge backer <-> pledge "pledge"
edge pledge <-> db "pledge + reward claim"
edge pledge <-> pp
edge db -> stream "CDC"
```

### 3) Live totals

Every pledge (and cancellation) is published as an event. An **aggregator** keeps `totalPledged` and `backers` per campaign in Redis, and pages poll it every few seconds (or receive updates via SSE). The database remains the source of truth.

### 4) Settling at the deadline

A **settlement job** runs when a campaign's deadline passes. It locks the campaign, computes the final total from the database, and marks it `succeeded` or `failed`. For success, it enqueues a **charge job per pledge**; for failure, it cancels them. Each charge uses the pledge ID as the idempotency key. Failed charges get a few retries and a message asking the backer to update their card.

## Potential Deep Dives

### 1) How do we avoid overselling limited rewards?

:::solution bad Check then insert
#### Approach

Read `claimed < limit`, then insert the pledge.

#### Challenges

Two backers racing for the last reward both pass the check.
:::

:::solution good Conditional update in a transaction
#### Approach

`UPDATE rewards SET claimed = claimed + 1 WHERE id = ? AND claimed < limit` in the same transaction as the pledge insert; zero rows updated means sold out.

#### Challenges

A hugely popular reward makes that single row a hot spot.
:::

:::solution great Pre-split counters for hot rewards
#### Approach

For a hot reward, split the remaining quantity into **N buckets** (e.g. 10 rows of 100 for 1,000 units) and have each pledge decrement a random bucket with a conditional update, trying another bucket if one is empty. Contention drops by N while still never overselling. Alternatively, an atomic decrement in Redis gates entry before the database write.

#### Challenges

When buckets run low, more retries are needed — fall back to scanning remaining buckets.
:::

### 2) How do we handle a hot campaign's total?

Thousands of pledges per second all updating `campaign.total` would serialise on one row. Instead, never update the total synchronously: pledges are inserted (which parallelises well), and the aggregator **increments counters asynchronously**, batching events per second. The exact total is computed from the pledge table at settlement time.

:::tip
Separate the "display" total (approximate, fast, async) from the "settlement" total (exact, computed once from the source of truth).
:::

### 3) How do we charge 100k backers reliably at the deadline?

Treat settlement as a **batch workflow**: the job writes a charge task per pledge to a queue, workers charge with idempotency keys, and pledge status records the outcome. Rate-limit calls to the payment processor, and make the whole job resumable — rerunning it only picks up pledges that aren't `captured` yet.

### Final Design

```diagram Final Design
node backer 0,1 box "Backers"
node cdn 1.4,-0.3 box "CDN|campaign pages"
node api 1.4,1 box "Pledge Service"
node db 2.8,1 circle "Pledges DB"
node agg 4.2,-0.3 box "Total Aggregator"
node redis 5.6,-0.3 circle "Live Totals"
node settle 4.2,1 box "Settlement Job"
node q 4.2,2.3 box "Charge Queue"
node pp 5.6,2.3 box "Payment Processor"
edge backer -> cdn
edge backer <-> api
edge api <-> db
edge db -> agg "events"
edge agg -> redis
edge db <-> settle
edge settle -> q
edge q -> pp "charge workers"
```

```quiz
[
  {
    "question": "In all-or-nothing crowdfunding, when are backers charged?",
    "options": ["Immediately", "Only after the campaign reaches its goal at the deadline", "Monthly", "When rewards ship"],
    "answer": 1,
    "explanation": "Cards are saved at pledge time and charged only on success."
  },
  {
    "question": "How do we avoid overselling a limited reward?",
    "options": ["Check in the UI", "A conditional update that only increments while claimed < limit", "Allow overselling and refund", "Cache the count"],
    "answer": 1,
    "explanation": "The database enforces the limit atomically."
  },
  {
    "question": "Why update the displayed total asynchronously?",
    "options": ["It's more accurate", "To avoid every pledge contending on a single row", "Regulations", "It's required by Redis"],
    "answer": 1,
    "explanation": "The exact total is computed from pledges at settlement."
  },
  {
    "question": "What makes the deadline settlement safe to rerun?",
    "options": ["Running it at night", "Per-pledge idempotency keys and status checks", "Bigger servers", "Deleting failed pledges"],
    "answer": 1,
    "explanation": "Reruns only process pledges that aren't already captured."
  }
]
```
