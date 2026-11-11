---
title: Online Auction
seoTitle: Design an Online Auction Platform Like eBay
description: Design an online auction system — listing items, placing bids with strong consistency, real-time bid updates and reliably closing auctions on time.
tags: Dealing with Contention, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: eBay, Amazon, Meta | 8
---

## Understanding the Problem

:::definition 🔨 What is an Online Auction?
An online auction platform (like eBay) lets sellers list items with a starting price and end time, and lets buyers place bids. When the auction ends, the highest bidder wins.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to post an item for auction with a starting price and an end time.
2. Users should be able to bid on an item; a bid is accepted only if it is higher than the current highest bid.
3. Users should be able to view an auction, including the current highest bid, updated in real time.

**Below the line (out of scope):**

- Search and browse.
- Payments and shipping.
- Proxy (automatic) bidding.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Bidding must be strongly consistent — every user must agree on the current highest bid, and no accepted bid can be lost.
2. Bid updates should reach viewers in near real time (< 1s).
3. The system should handle popular auctions with thousands of concurrent bidders.
4. The system should scale to 10M concurrent auctions.

**Below the line (out of scope):**

- Fraud and shill-bidding detection.

```sketch Online Auction Requirements
Functional
- post item (start price, end time)
- bid (must beat current high)
- view auction w/ real-time high bid

Non-functional
- strong consistency for bids
- real-time updates (< 1s)
- thousands of bidders per hot auction
- 10M concurrent auctions
```

## The Set Up

### Planning the Approach

Bidding is a classic **contention** problem: many users racing to update the same value. We'll start simple and then focus deep dives on correctness under contention, real-time fan-out, and closing auctions.

### Defining the Core Entities

1. **Item**: what's being sold — title, description, images.
2. **Auction**: an item listing with starting price, end time, status, and current max bid.
3. **Bid**: an amount placed by a user on an auction, with a timestamp and acceptance status.
4. **User**: a buyer or seller.

```sketch Auction Entities
Core Entities
- Item
- Auction
- Bid
- User
```

### API or System Interface

```
POST /auctions
{ "item": {...}, "startingPrice": 100, "endTime": "2026-12-01T18:00:00Z" } -> Auction

POST /auctions/:auctionId/bids
{ "amount": 150 } -> Bid

GET /auctions/:auctionId -> Auction & Item
```

## High-Level Design

### 1) Users should be able to post an item for auction

An **Auction Service** writes the Item and Auction rows. Images go to blob storage via presigned URLs, and the Auction stores references to them.

### 2) Users should be able to bid on an item

A **Bidding Service** handles bids. For every bid it reads the auction's current max, checks the new amount is higher, and writes the Bid while updating the max.

```diagram Placing a bid
node client 0,1 box "Client"
node gw 1.1,1 box "API Gateway"
node auc 2.3,0.3 box "Auction Service"
node bid 2.3,1.7 box "Bidding Service"
node db 3.6,1 circle "Postgres"
note 4.1,0.3 "Auction|- id|- itemId|- startingPrice|- maxBid|- endTime|- status"
note 4.1,1.7 "Bid|- id|- auctionId|- userId|- amount|- createdAt"
edge client <-> gw
edge gw <-> auc "create / view"
edge gw <-> bid "POST /bids"
edge auc <-> db
edge bid <-> db
```

Done naively, two bids arriving together can both read the same max and both be accepted. We'll fix that in the first deep dive.

### 3) Users should be able to view an auction with real-time updates

Viewing an auction reads the Auction row (with its cached `maxBid`). To keep the price live, clients open a persistent connection and receive new highest bids as they happen — covered in the deep dives.

## Potential Deep Dives

### 1) How do we guarantee bids are processed correctly under contention?

:::pattern Pattern: Dealing with Contention
Many writers racing to change the same row is the heart of this pattern. The tools are atomic conditional updates, locks, or serialising writes through a single owner.
:::

:::solution bad Read, check, then write in application code
#### Approach

Read `maxBid`, compare in the service, then insert the bid and update the max as separate statements.

#### Challenges

Classic race condition: two bids of 150 and 160 can both read max = 140 and both succeed, or a lower bid can overwrite a higher one.
:::

:::solution good Row lock with SELECT ... FOR UPDATE
#### Approach

In one transaction, `SELECT max_bid FROM auctions WHERE id = ? FOR UPDATE`, compare, insert the bid, update `max_bid`, commit. Concurrent bidders on the same auction serialise on the row lock.

#### Challenges

Correct, and fine for most auctions. For a very hot auction, bidders queue on the lock and latency grows; long-held locks also tie up connections.
:::

:::solution great Atomic conditional update (optimistic)
#### Approach

Skip the explicit lock and let the database compare-and-set in one statement:

```
UPDATE auctions
SET max_bid = :amount, max_bidder = :userId
WHERE id = :auctionId AND max_bid < :amount AND status = 'OPEN';
```

If one row is updated, the bid wins and we insert it as accepted; if zero rows are updated, it lost and we record it as rejected. No lock is held across round trips.

#### Challenges

Losing bids get a fast rejection, which is the desired behaviour. For extreme cases you can route all bids for one auction through a single partition of a queue (e.g. Kafka keyed by auctionId) so they are processed strictly in order by one consumer.
:::

:::tip
Always persist every bid — accepted or rejected — with its timestamp. Disputes ("I bid first!") are common, and an append-only bid log is your audit trail.
:::

### 2) How do we push bid updates to viewers in real time?

:::solution bad Client polling
#### Approach

Clients poll `GET /auctions/:id` every second.

#### Challenges

Thousands of viewers per hot auction × one request per second is a lot of wasted load, and updates are still delayed by up to the poll interval.
:::

:::solution great Server-Sent Events with pub/sub
#### Approach

Viewers open an SSE connection to a **Notification Service**. When a bid is accepted, the Bidding Service publishes to a Redis Pub/Sub channel `auction:{id}`. Each notification server subscribes to the channels for the auctions its connected viewers are watching and pushes the new max to them.

#### Challenges

Connections are stateful, so notification servers need connection-aware load balancing and clients must reconnect (SSE does this automatically) and re-fetch current state after a reconnect.
:::

### 3) How do we close auctions reliably and on time?

When `endTime` passes, the auction must stop accepting bids and a winner must be declared exactly once.

:::solution good Cron job scanning for ended auctions
#### Approach

Every minute, query `WHERE end_time <= now() AND status = 'OPEN'` and close them.

#### Challenges

Up to a minute of slack where late bids could be accepted unless the bid query also checks `end_time`. Scanning gets heavier as data grows.
:::

:::solution great Delayed message + guard in the bid path
#### Approach

When an auction is created, schedule a delayed message (e.g. SQS delay, a durable timer, or a job scheduler) for its end time. The consumer marks the auction `CLOSED` with a conditional update and emits a "winner" event. In the meantime, the bid's conditional update already includes `end_time > now()`, so no bid can sneak in after the deadline even if closing is delayed.

#### Challenges

Clock skew between servers matters near the deadline; use the database's clock as the single source of truth. Closing must be idempotent in case the message is delivered twice.
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node gw 1.1,1.2 box "API Gateway"
node auc 2.3,0.2 box "Auction Service"
node bid 2.3,1.2 box "Bidding Service|- conditional update"
node notif 2.3,2.3 box "Notification Service|(SSE)"
node db 3.6,0.7 circle "Postgres"
node ps 3.6,2 circle "Redis|Pub/Sub"
node sched 4.8,0.7 box "Auction Closer|(delayed msgs)"
edge client <-> gw
edge gw <-> auc
edge gw <-> bid
edge client <-> notif "SSE"
edge auc <-> db
edge bid <-> db
edge bid -> ps "bid accepted"
edge ps -> notif
edge sched <-> db "close + winner"
```

```quiz
[
  {
    "question": "What prevents two concurrent bids from both being accepted against the same old max?",
    "options": ["Client-side validation", "An atomic conditional UPDATE ... WHERE max_bid < :amount", "Caching the max bid", "Polling more frequently"],
    "answer": 1,
    "explanation": "The database evaluates the condition and writes atomically, so only one of the racing bids can win.",
    "section": "1-how-do-we-guarantee-bids-are-processed-correctly-under-contention"
  },
  {
    "question": "Why is SSE a good fit for live auction prices?",
    "options": ["Viewers mostly receive updates; traffic is one-way from server to client", "It supports file uploads", "It is a database", "It guarantees ordering across auctions"],
    "answer": 0,
    "explanation": "Bids go through normal HTTP requests; SSE efficiently pushes new prices down to many viewers."
  },
  {
    "question": "How do you ensure no bid is accepted after the auction ends, even if closing is delayed?",
    "options": ["Trust the client clock", "Include end_time > now() in the bid's conditional update", "Close auctions early", "Disable caching"],
    "answer": 1,
    "explanation": "The bid path itself enforces the deadline using the database clock.",
    "section": "3-how-do-we-close-auctions-reliably-and-on-time"
  },
  {
    "question": "Why record rejected bids too?",
    "options": ["To fill the database", "For auditing and resolving disputes", "To speed up reads", "It is required by SSE"],
    "answer": 1,
    "explanation": "An append-only log of every bid and its outcome is the evidence when users dispute results."
  }
]
```
