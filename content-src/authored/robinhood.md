---
title: Robinhood
seoTitle: Design a Stock Trading App Like Robinhood
description: Design Robinhood — live stock prices, placing and cancelling orders through an exchange, and tracking order status — with real-time price fan-out and reliable order handling.
tags: Real-time Updates, Multi-step Processes
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Robinhood, Coinbase, Citadel | 10
---

## Understanding the Problem

:::definition 📈 What is Robinhood?
Robinhood is a commission-free brokerage app. Users watch live stock prices and place buy and sell orders, which Robinhood routes to an exchange for execution.
:::

### Functional Requirements

**Core Requirements**

1. Users should see live prices for stocks they're viewing.
2. Users should be able to place market and limit orders to buy or sell.
3. Users should be able to cancel an order that hasn't been filled.
4. Users should be able to view the status of their orders.

**Below the line (out of scope):**

- Options, crypto and margin trading.
- Portfolio analytics and charts.
- Building our own matching engine — we route orders to an external exchange.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Order handling must be strongly consistent and never lose or duplicate an order.
2. Prices should update in near real time (< 1s) for viewers.
3. The system should scale to 20M daily users and handle market-open spikes.
4. Order placement should be low latency (< 200ms to acknowledgement).

**Below the line (out of scope):**

- Regulatory reporting.
- Fraud detection.

```sketch Robinhood Requirements
Functional
- live prices
- place market / limit orders
- cancel orders
- view order status

Non-functional
- orders: consistent, no loss / dupes
- prices < 1s
- 20M DAU, market-open spikes
- order ack < 200ms
```

## The Set Up

### Planning the Approach

Two very different flows: **prices** (massive one-to-many fan-out, where staleness of a second is fine) and **orders** (low volume per user but must be exactly right). We'll keep them separate.

### Defining the Core Entities

1. **Symbol**: a tradable stock with its latest price.
2. **Order**: userId, symbol, side (buy/sell), type (market/limit), quantity, limit price, status, external exchange order ID.
3. **User**: the account placing orders.

```sketch Robinhood Entities
Core Entities
- Symbol
- Order
- User
```

### API or System Interface

```
GET  /symbols/:symbol -> Symbol
GET  /prices/stream?symbols=AAPL,TSLA   (SSE)

POST /orders
{ "symbol": "AAPL", "side": "BUY", "type": "LIMIT", "quantity": 10, "limitPrice": 190.5 } -> Order

DELETE /orders/:orderId
GET    /orders?status&cursor -> Order[]
```

## High-Level Design

### 1) Users should see live prices

Robinhood consumes a market-data feed from exchanges or a data vendor. A **Price Ingest** service processes ticks and keeps the latest price per symbol. Clients subscribe to the symbols on screen.

```diagram Live prices
node feed 0,1 circle "Market Data|Feed"
node ingest 1.3,1 box "Price Ingest"
node ps 2.6,1 circle "Pub/Sub"
node stream 3.9,1 box "Price Stream|Service (SSE)"
node client 5.2,1 box "Client"
edge feed -> ingest
edge ingest -> ps "per-symbol|channels"
edge ps -> stream
edge stream -> client "SSE"
```

### 2) Users should be able to place orders

An **Order Service** validates the order (buying power, market hours), writes it to the database as `PENDING`, and submits it to the exchange through an **Exchange Gateway** that speaks the exchange protocol (e.g. FIX).

```diagram Placing an order
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node order 2.4,1 box "Order Service"
node db 2.4,2.2 circle "Orders DB"
node exg 3.7,1 box "Exchange Gateway|(FIX)"
node ex 5,1 circle "Exchange"
note 2.9,2.2 "Order|- id|- userId|- symbol|- side, type|- qty, limitPrice|- status|- externalId"
edge client <-> gw "POST /orders"
edge gw <-> order
edge order <-> db
edge order <-> exg
edge exg <-> ex
```

### 3) Users should be able to cancel orders

Cancelling sends a cancel request to the exchange for the order's external ID. The order is only marked `CANCELLED` once the exchange confirms — it may have already filled.

### 4) Users should be able to view order status

The exchange sends execution reports (filled, partially filled, rejected, cancelled) back through the gateway; the Order Service updates the order status, and the client reads it.

## Potential Deep Dives

### 1) How do we fan out prices to millions of viewers?

:::solution bad Clients poll for prices
#### Approach

Each client calls `GET /symbols/:symbol` every second for every symbol on screen.

#### Challenges

Millions of users × several symbols × 1 request/sec is huge, wasteful load — and it spikes exactly at market open.
:::

:::solution great SSE with per-symbol pub/sub and coalescing
#### Approach

Clients open one SSE connection listing their symbols. Each Price Stream server subscribes to only the symbols its connected clients need (Redis Pub/Sub or a similar fan-out layer) and pushes updates. Ticks are **coalesced** — at most a few updates per second per symbol are forwarded, since humans can't read faster and a fresher price replaces a stale one anyway.

#### Challenges

Connections are long-lived, so servers must be scaled on connection count, and clients need to re-subscribe after reconnecting.
:::

### 2) How do we make sure orders are never lost or duplicated?

:::solution bad Submit to the exchange, then write to the database
#### Approach

Send the order to the exchange first and save it after the response.

#### Challenges

If we crash between the two, a real trade exists that we have no record of — unacceptable for a brokerage.
:::

:::solution great Write-ahead order record + client order IDs + reconciliation
#### Approach

1. Persist the order as `PENDING_SUBMIT` with a unique **client order ID** before contacting the exchange.
2. Submit to the exchange using that client order ID — exchanges reject duplicate IDs, so retries are safe.
3. Update to `SUBMITTED` with the exchange's ID, then apply execution reports as they arrive.
4. A **reconciliation job** periodically compares orders stuck in intermediate states with the exchange's view and repairs them.

The API itself accepts an idempotency key so a user's double tap doesn't create two orders.

#### Challenges

Order status is a state machine with many transitions; every transition must be applied idempotently because execution reports can be redelivered.
:::

:::pattern Pattern: Multi-step Processes
Placing an order spans our database and an external exchange. Durable state, idempotent steps and reconciliation are how you make a multi-step process reliable.
:::

### 3) How do we survive market-open spikes?

Order requests are buffered behind the Order Service with per-user ordering preserved (partitioned by userId), and the Exchange Gateway enforces the exchange's rate limits. Price streaming scales horizontally on connection count and is pre-warmed before the opening bell, since the spike is entirely predictable.

### Final Design

```diagram Final Design
node feed 0,0.3 circle "Market Data"
node ingest 1.3,0.3 box "Price Ingest|- coalesce ticks"
node ps 2.6,0.3 circle "Pub/Sub"
node stream 3.9,0.3 box "Price Stream (SSE)"
node client 0,1.8 box "Client"
node gw 1.3,1.8 box "API Gateway"
node order 2.6,1.8 box "Order Service|- idempotency|- state machine"
node db 2.6,3 circle "Orders DB"
node recon 3.9,3 box "Reconciler"
node exg 3.9,1.8 box "Exchange Gateway"
node ex 5.1,1.8 circle "Exchange"
edge feed -> ingest
edge ingest -> ps
edge ps -> stream
edge stream -> client "prices"
edge client <-> gw
edge gw <-> order
edge order <-> db
edge order <-> exg
edge exg <-> ex
edge recon <-> db
edge recon <-> exg
```

```quiz
[
  {
    "question": "Why persist the order before sending it to the exchange?",
    "options": ["It is faster", "So a crash can never leave a real trade with no record", "Exchanges require it", "To cache prices"],
    "answer": 1,
    "explanation": "A write-ahead record plus reconciliation means every submitted order is accounted for.",
    "section": "2-how-do-we-make-sure-orders-are-never-lost-or-duplicated"
  },
  {
    "question": "What makes retrying an order submission to the exchange safe?",
    "options": ["A longer timeout", "A unique client order ID the exchange deduplicates on", "Polling", "Sending it twice"],
    "answer": 1,
    "explanation": "The exchange rejects a second order with the same client order ID."
  },
  {
    "question": "Why coalesce price ticks before pushing them to clients?",
    "options": ["Humans can't read faster, and the newest price replaces older ones", "To hide prices", "Exchanges require it", "To increase latency"],
    "answer": 0,
    "explanation": "Forwarding a few updates per second per symbol cuts fan-out load with no visible loss.",
    "section": "1-how-do-we-fan-out-prices-to-millions-of-viewers"
  },
  {
    "question": "When should an order be marked CANCELLED?",
    "options": ["As soon as the user taps cancel", "Only after the exchange confirms the cancel", "After 5 minutes", "Never"],
    "answer": 1,
    "explanation": "The order may already have filled; the exchange is the source of truth."
  }
]
```
