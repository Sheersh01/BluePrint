---
title: Loyalty Rewards
seoTitle: Design a Loyalty Rewards Program
description: Design a loyalty rewards program — earning points from purchases via configurable rules, a points ledger with expiry, redemptions, tiers, and handling refunds.
tags: Dealing with Contention, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎁 What is a Loyalty Rewards Program?
A loyalty program gives customers points for purchases and other actions, and lets them redeem points for discounts, free items or perks. Airlines, coffee chains and retailers all run them. Customers often move up **tiers** (Silver, Gold) based on how much they spend in a year, unlocking better earn rates.
:::

### Functional Requirements

**Core Requirements**

1. Customers should earn points when they make purchases, according to configurable rules (e.g. 1 point per dollar, double points on promotions).
2. Customers should see their points balance and history.
3. Customers should be able to redeem points at checkout.
4. Points should expire after a period (e.g. 12 months).
5. Customers should move between tiers based on yearly spend.

**Below the line (out of scope):**

- Partner networks (earning points at other companies).
- Fraud detection beyond basic limits.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Balances must be accurate: points are a liability on the company's books.
2. Redemption at checkout must be fast (< 100 ms) and never let a customer spend points twice.
3. Earning can be slightly delayed (seconds to minutes).
4. Scale to ~50M members and ~5k transactions per second at peak.

**Below the line (out of scope):**

- Real-time tier changes (daily is fine).

```sketch Loyalty Requirements
Functional
- earn points via rules
- balance + history
- redeem at checkout
- expiry
- tiers

Non-functional
- accurate balances
- redeem < 100ms, no double spend
- earning can lag
- 50M members
```

## The Set Up

### Defining the Core Entities

1. **Member**: customer ID, tier, tier-qualifying spend this year.
2. **Points lot**: points earned from one event, with an earn date and expiry date and remaining amount.
3. **Points transaction**: earn, redeem, expire or adjust — an immutable ledger record.
4. **Earn rule**: condition (category, promotion, tier) and multiplier.

### API or System Interface

```
GET  /members/:id/points -> { balance, expiringSoon[], tier }
GET  /members/:id/points/history?cursor=
POST /redemptions { memberId, points, orderId, idempotencyKey } -> { redemptionId, value }
POST /redemptions/:id/cancel
(internal) purchase events consumed from the orders stream
```

## High-Level Design

### 1) Earning points

The order system publishes `order.completed` events. An **Earn Service** consumes them, evaluates **earn rules** (base rate × tier multiplier × active promotions), and writes a **points lot** and an `earn` transaction. Processing is idempotent by order ID, so a redelivered event doesn't award points twice.

```diagram Earning
node orders 0,1 box "Order Service"
node bus 1.5,1 box "Event Stream"
node earn 3,1 box "Earn Service|rules engine"
node rules 3,-0.3 circle "Earn Rules"
node ledger 4.5,1 circle "Points Ledger"
edge orders -> bus "order.completed"
edge bus -> earn
edge rules -> earn
edge earn -> ledger "lot + earn txn"
```

### 2) Balance and history

The balance is the sum of remaining points across unexpired lots. We store it on the member row too, updated in the same transaction as each points change, so balance reads are a single lookup.

### 3) Redeeming at checkout

Checkout calls the **Redemption Service**, which in one transaction checks the balance, consumes points from the **oldest lots first** (so points nearest expiry are used first), writes a `redeem` transaction and reduces the balance. If the order is later cancelled, a reversing transaction restores the points.

### 4) Expiry and tiers

A daily **expiry job** finds lots past their expiry date with points remaining, writes `expire` transactions and reduces balances. A **tier job** recalculates tiers from qualifying spend and notifies customers who move up or down.

## Potential Deep Dives

### 1) How do we prevent double redemption?

:::solution bad Check balance in the app
#### Approach

Read the balance, then write the redemption.

#### Challenges

Two checkouts at the same moment (app and in-store) both pass the check.
:::

:::solution good Conditional decrement
#### Approach

`UPDATE members SET balance = balance - 500 WHERE id = ? AND balance >= 500` in the same transaction as the redemption record.

#### Challenges

Correct, but checkout retries may still create two redemptions for one order.
:::

:::solution great Conditional decrement + idempotent redemptions
#### Approach

Use the conditional decrement and make redemption **idempotent by order ID**: a unique constraint on `(memberId, orderId)` means a retried checkout returns the existing redemption. For checkout flows that may be abandoned, **reserve** points first (status `held` with a short expiry) and **confirm** when payment succeeds; a sweeper releases expired holds.

#### Challenges

Holds reduce the available balance temporarily, which the UI should explain.
:::

### 2) How do we handle refunds of purchases that earned points?

A refunded order should claw back the points it earned. The Earn Service consumes `order.refunded` and writes a negative adjustment against the original lot. If the customer already spent those points, the balance can go **negative**; policy decides whether to allow that (and recover from future earning) or charge the cash difference.

:::tip
Mention that outstanding points are a financial liability. Finance needs the total unexpired balance and expected breakage (points that will never be redeemed) — another reason for an exact, append-only ledger.
:::

### 3) How do we scale to 50M members?

Shard the ledger by **member ID**: every operation touches one member, so there are no cross-shard transactions. History is read from a replica or a separate store fed by CDC. The expiry job runs per shard over an index on `expiresAt`, processing lots in batches so it doesn't spike database load at midnight.

### Final Design

```diagram Final Design
node orders 0,1 box "Order Service"
node bus 1.4,1 box "Event Stream"
node earn 2.8,1 box "Earn Service"
node ledger 4.2,1 circle "Points Ledger|by member"
node checkout 4.2,-0.4 box "Checkout"
node redeem 5.6,-0.4 box "Redemption Service"
node jobs 5.6,2.3 box "Expiry + Tier Jobs"
node history 2.8,2.3 circle "History Store"
edge orders -> bus
edge bus -> earn
edge earn -> ledger
edge checkout -> redeem
edge redeem <-> ledger
edge jobs <-> ledger
edge ledger -> history "CDC"
```

```quiz
[
  {
    "question": "Why track points in lots rather than only a balance?",
    "options": ["It's faster", "Each lot has its own expiry date", "To save storage", "Regulations require lots"],
    "answer": 1,
    "explanation": "Lots let points expire on their own schedule and be consumed oldest first."
  },
  {
    "question": "How do we avoid awarding points twice for one order?",
    "options": ["Hope events arrive once", "Process earn events idempotently by order ID", "Delete duplicates nightly", "Use a bigger queue"],
    "answer": 1,
    "explanation": "Event streams redeliver, so earning must be idempotent."
  },
  {
    "question": "What stops two simultaneous checkouts spending the same points?",
    "options": ["Caching the balance", "A conditional decrement plus a unique redemption per order", "Rate limiting", "Points can't be spent"],
    "answer": 1,
    "explanation": "The database enforces both the balance check and idempotency."
  },
  {
    "question": "What happens when a purchase that earned points is refunded?",
    "options": ["Nothing", "A negative adjustment claws back the points", "The member is banned", "Points double"],
    "answer": 1,
    "explanation": "Adjustments keep the ledger consistent with real purchases."
  }
]
```
