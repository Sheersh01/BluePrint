---
title: Flash Sale
seoTitle: Design a Flash Sale System
description: Design a flash sale — millions of users competing for limited inventory at a fixed start time — with atomic inventory reservation, virtual waiting rooms and protection against overselling.
tags: Dealing with Contention, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Shopify, Alibaba | 10
---

## Understanding the Problem

:::definition ⚡ What is a Flash Sale?
A flash sale offers a limited quantity of a product at a deep discount, starting at a precise moment — for example, 10,000 consoles at 50% off at noon. Millions of users arrive at once to compete for the stock.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view the sale page and a countdown to the start time.
2. Once the sale starts, users should be able to purchase the item while stock remains.
3. Users who reserve an item should have a few minutes to complete payment.

**Below the line (out of scope):**

- Creating and configuring sales (admin tools).
- Shipping and fulfilment.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. **No overselling** — we must never sell more units than we have.
2. Handle a spike of ~1M requests per second at the start time.
3. The rest of the store must stay up even if the sale is overwhelmed.
4. Fairness: purchases should roughly follow arrival order, and bots shouldn't win.
5. The sale page should load fast for everyone.

**Below the line (out of scope):**

- Advanced bot detection models.

```sketch Flash Sale Requirements
Functional
- view sale page + countdown
- buy while stock remains
- hold reservation during payment

Non-functional
- never oversell
- ~1M req/s at start
- isolate the rest of the store
- fair, bot-resistant
- fast page loads
```

## The Set Up

### Planning the Approach

This is the **contention** problem in its purest form: a tiny amount of inventory, a huge number of concurrent buyers, and a hard correctness constraint. The key move is to filter traffic down before it reaches anything stateful.

### Defining the Core Entities

1. **Sale**: product, discounted price, total quantity, start time, status.
2. **Inventory**: remaining units for a sale.
3. **Reservation**: a held unit for a user, with an expiry.
4. **Order**: a completed purchase.

```sketch Flash Sale Entities
Core Entities
- Sale
- Inventory
- Reservation
- Order
```

### API or System Interface

```
GET  /sales/:saleId -> Sale (+ remaining stock estimate)

POST /sales/:saleId/reservations -> { "reservationId", "expiresAt" } | 409 SOLD_OUT

POST /orders
{ "reservationId": "...", "paymentMethod": "pm_tok_..." } -> Order
```

## High-Level Design

### 1) Users should be able to view the sale page

The sale page is the same for everyone, so it's served as static content through a **CDN**. The countdown runs on the client using server time fetched once. A tiny, cached endpoint returns an approximate stock level, refreshed every second or two.

### 2) Users should be able to purchase while stock remains

A **Sale Service** handles reservation requests. It atomically decrements inventory; on success it creates a Reservation with a short expiry and returns it; when stock hits zero it returns `SOLD_OUT`.

```diagram Reserve an item
node c 0,1 box "Client"
node cdn 0,2.2 circle "CDN|sale page"
node gw 1.3,1 box "API Gateway"
node sale 2.6,1 box "Sale Service"
node inv 3.9,0.4 circle "Inventory"
node db 3.9,1.7 circle "Reservations DB"
edge c <-> cdn
edge c <-> gw "POST /reservations"
edge gw <-> sale
edge sale <-> inv "decrement"
edge sale -> db
```

### 3) Users should have a few minutes to pay

The client calls `POST /orders` with the reservation. The **Order Service** charges the card and converts the reservation into an Order. If the reservation expires unpaid, the unit is returned to inventory for someone else.

## Potential Deep Dives

### 1) How do we guarantee we never oversell?

:::solution bad Read stock, check, then write
#### Approach

`SELECT remaining`, check it's above zero, then `UPDATE remaining = remaining - 1`.

#### Challenges

Thousands of concurrent requests all read the same value and all succeed. Overselling is guaranteed.
:::

:::solution good Conditional update in the database
#### Approach

`UPDATE inventory SET remaining = remaining - 1 WHERE sale_id = ? AND remaining > 0` — exactly one row updated means success.

#### Challenges

Correct, but every request contends on a single hot row. A relational database will melt at hundreds of thousands of attempts per second against one row.
:::

:::solution great Atomic counter in Redis + database as source of truth
#### Approach

Load the stock into Redis before the sale. Each reservation runs an atomic `DECR` (or a Lua script that decrements only if > 0). Redis executes commands single-threaded, so it can never go below zero, and it handles hundreds of thousands of operations per second. Successful decrements create a reservation asynchronously in the database via a queue; expired reservations `INCR` the counter back.

For even higher throughput, split stock across several Redis keys (**inventory sharding**, e.g. 10 buckets of 1,000) and route each user to one bucket.

#### Challenges

Redis and the database must be reconciled after the sale; if Redis fails mid-sale, a replica with stale counts could oversell slightly, so use synchronous replication (`WAIT`) or accept a small configured buffer.
:::

### 2) How do we survive 1M requests per second at the start?

:::solution bad Scale the backend and hope
#### Approach

Autoscale the Sale Service and database.

#### Challenges

Autoscaling reacts in minutes; the spike arrives in milliseconds. Shared dependencies (auth, database) collapse and take the rest of the store down with them.
:::

:::solution great Virtual waiting room + early rejection
#### Approach

At the start time, every buyer enters a **virtual waiting room**: they get a signed token with a queue position, and the client polls (cheaply, via the edge) until admitted. The admission service lets users through at the rate the Sale Service can handle. Once stock is gone, the waiting room closes and everyone remaining sees "sold out" instantly — without touching the backend.

Run the flash sale on **isolated infrastructure** so its load can't affect normal shopping.

#### Challenges

Users dislike waiting rooms, so show honest progress. Queue tokens must be signed to prevent skipping the line.
:::

:::pattern Pattern: Dealing with Contention
Filter demand before it reaches the contended resource, then make the remaining contention atomic. Flash sales are the textbook example.
:::

### 3) How do we keep it fair and stop bots?

Require users to be logged in, limit one reservation per account per sale (enforced with a Redis `SETNX` on `sale:{id}:user:{userId}`), add a CAPTCHA or proof-of-work before entering the waiting room, and assign queue positions by arrival time at the edge rather than by who hammers the API fastest.

### Final Design

```diagram Final Design
node c 0,1.2 box "Clients"
node cdn 1.2,0.1 circle "CDN|static page"
node wr 1.4,1.2 box "Waiting Room|- signed tokens|- admit at rate"
node gw 2.7,1.2 box "API Gateway|(isolated)"
node sale 4,1.2 box "Sale Service|- 1 per user"
node redis 5.3,0.4 circle "Redis|stock counters"
node q 5.3,1.9 circle "Queue"
node db 6.5,1.9 circle "Orders DB"
node order 4,2.4 box "Order Service|- payment|- expiry"
edge c <-> cdn
edge c <-> wr
edge wr -> gw "admitted"
edge gw <-> sale
edge sale <-> redis "atomic DECR"
edge sale -> q "reservation"
edge q -> db
edge order <-> db
edge order -> redis "INCR on expiry"
```

```quiz
[
  {
    "question": "Why does read-check-write oversell under concurrency?",
    "options": ["The database is slow", "Many requests read the same remaining count before any of them writes", "The cache is full", "Payments fail"],
    "answer": 1,
    "explanation": "The check and the write must be atomic, otherwise concurrent requests all pass the check.",
    "section": "1-how-do-we-guarantee-we-never-oversell"
  },
  {
    "question": "Why is Redis a good fit for the stock counter during the sale?",
    "options": ["It stores data on disk only", "Single-threaded atomic operations at very high throughput", "It supports SQL joins", "It is free"],
    "answer": 1,
    "explanation": "Atomic DECR can't go below zero and handles far more ops/sec on one key than a database row."
  },
  {
    "question": "What is the main purpose of a virtual waiting room?",
    "options": ["Show ads", "Admit users at a rate the backend can handle and reject cheaply once sold out", "Speed up payments", "Store inventory"],
    "answer": 1,
    "explanation": "It flattens the spike and keeps most traffic away from stateful services.",
    "section": "2-how-do-we-survive-1m-requests-per-second-at-the-start"
  },
  {
    "question": "How can you enforce one purchase per user?",
    "options": ["Client-side check", "Atomic SETNX on a per-sale, per-user key", "Longer reservations", "Bigger servers"],
    "answer": 1,
    "explanation": "SETNX succeeds only for the first attempt by that user for that sale."
  }
]
```
