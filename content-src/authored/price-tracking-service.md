---
title: Price Tracking Service
seoTitle: Design a Price Tracking Service Like CamelCamelCamel
description: Design a price tracker — collecting product prices at scale, showing price history charts, and notifying users when a price drops below their target.
tags: Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Google | 5
---

## Understanding the Problem

:::definition 🏷️ What is a Price Tracking Service?
A price tracker (like CamelCamelCamel or Honey) monitors product prices on e-commerce sites, shows how a price has changed over time, and alerts users when a product drops below a price they choose.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view the price history of a product as a chart.
2. Users should be able to subscribe to a price-drop alert with a target price.
3. Users should be notified (by email) when the price falls below their target.

**Below the line (out of scope):**

- Browser extension UI.
- Searching across retailers.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Track ~500M products; popular products should be checked at least hourly.
2. Price-drop alerts should go out within an hour of the change.
3. Price history charts should load in < 500ms.
4. Prefer availability; history can be eventually consistent.

**Below the line (out of scope):**

- Legal terms of each retailer.

```sketch Price Tracking Requirements
Functional
- view price history chart
- subscribe: notify below target price
- email on price drop

Non-functional
- 500M products, popular hourly
- alerts within 1 hour
- charts < 500ms
- availability >> consistency
```

## The Set Up

### Planning the Approach

The system has a **write-heavy ingestion** side (collecting billions of price points) and a lightweight read side. We'll design collection, storage and alerting, then go deep on each.

### Defining the Core Entities

1. **Product**: a retailer product (URL/ASIN, title, current price).
2. **PricePoint**: (productId, price, timestamp).
3. **Subscription**: a user's alert — productId, targetPrice, status.
4. **User**: who receives notifications.

```sketch Price Tracking Entities
Core Entities
- Product
- PricePoint
- Subscription
- User
```

### API or System Interface

```
GET  /products/:productId/history?period=1y -> PricePoint[]

POST /subscriptions
{ "productId": "B00X...", "targetPrice": 199.99 } -> Subscription

DELETE /subscriptions/:id
```

## High-Level Design

### 1) Users should be able to view price history

Price points are written by collectors and read by a **Product Service** that returns the series for a time range.

```diagram Price history
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node prod 2.4,1 box "Product Service"
node ts 3.7,1 circle "Price DB"
node crawl 3.7,2.3 box "Price Collectors"
note 4.2,0.85 "PricePoint|- productId|- price|- ts"
edge client <-> gw "GET /history"
edge gw <-> prod
edge prod <-> ts
edge crawl -> ts "new prices"
```

### 2) Users should be able to subscribe to price drops

A **Subscription Service** stores subscriptions keyed by `productId`, with an index so we can quickly find every subscriber of a given product.

### 3) Users should be notified when the price drops

When a collector records a new price that is lower than the previous one, it emits a `price_changed` event. A **Notification Worker** looks up subscriptions for that product with `targetPrice >= newPrice` and sends emails.

## Potential Deep Dives

### 1) How do we collect prices for 500M products?

:::solution bad Crawl every product on a fixed schedule
#### Approach

Scrape all 500M product pages every hour.

#### Challenges

That's ~140k page fetches per second, most for products nobody watches. We'd be blocked by retailers and the cost would be enormous.
:::

:::solution good Prioritised crawling
#### Approach

Assign each product a crawl priority based on number of subscribers, views, and how volatile its price has been. A scheduler places products on a priority queue; popular items are checked hourly, the long tail daily or weekly.

#### Challenges

Rarely viewed products may miss short-lived deals; that's an acceptable trade.
:::

:::solution great Prioritised crawling + official APIs + crowd-sourced prices
#### Approach

Use retailer product APIs where available (cheaper and allowed), prioritised crawling elsewhere, and accept price observations from the browser extension when users visit product pages — validated against recent crawls to reject bad data.

#### Challenges

Crowd-sourced data must be verified (e.g. require agreement or a confirming crawl before alerting) to avoid false notifications.
:::

### 2) How should we store billions of price points?

:::solution bad One relational table with a row per observation
#### Approach

`price_points(product_id, price, ts)` in Postgres.

#### Challenges

Billions of rows grow without bound; range scans for a chart get slower and storage is wasteful when the price rarely changes.
:::

:::solution great Store changes only, in a time-series store
#### Approach

Write a point **only when the price changes** (plus a periodic heartbeat), which shrinks data dramatically. Use a time-series database (e.g. TimescaleDB, or Cassandra partitioned by `productId` with clustering on `ts`). Chart queries are a single-partition range scan; pre-aggregate daily min/max for long periods.

#### Challenges

A chart now needs "carry forward" logic between change points, which the client or service handles.
:::

### 3) How do we notify subscribers efficiently and reliably?

:::solution good Query subscriptions on every price change
#### Approach

On each `price_changed` event, `SELECT user_id FROM subscriptions WHERE product_id = ? AND target_price >= ? AND status = 'ACTIVE'`, then send emails.

#### Challenges

Works well with an index on `(product_id, target_price)`. A popular product might have hundreds of thousands of subscribers, so sending must be batched.
:::

:::solution great Event-driven pipeline with a durable queue
#### Approach

Collectors publish `price_changed` events to Kafka partitioned by `productId`. Notification workers fetch matching subscriptions, enqueue individual email jobs, and mark each subscription `NOTIFIED` (so a user isn't spammed if the price bounces). The email sender is idempotent per `(subscriptionId, priceEventId)`.

#### Challenges

Must handle retries and deduplication carefully; that's what the idempotency key is for.
:::

### Final Design

```diagram Final Design
node sched 0,0.4 box "Crawl Scheduler|(priority queue)"
node crawl 1.3,0.4 box "Collectors|+ retailer APIs"
node ts 2.6,0.4 circle "Time-series DB"
node kafka 2.6,1.7 circle "Kafka|price_changed"
node notif 3.9,1.7 box "Notification Workers"
node subs 3.9,0.4 circle "Subscriptions DB"
node email 5.1,1.7 box "Email Sender"
node prod 1.3,1.7 box "Product Service"
node client 0,1.7 box "Client"
edge sched -> crawl
edge crawl -> ts
edge crawl -> kafka
edge kafka -> notif
edge notif <-> subs
edge notif -> email
edge client <-> prod
edge prod <-> ts
```

```quiz
[
  {
    "question": "What is the most effective way to cut price-history storage?",
    "options": ["Compress JSON", "Write a point only when the price changes", "Store prices in the cache", "Delete products"],
    "answer": 1,
    "explanation": "Prices change rarely, so recording only changes removes most redundant rows.",
    "section": "2-how-should-we-store-billions-of-price-points"
  },
  {
    "question": "How should crawl frequency be decided?",
    "options": ["Same for all products", "By priority: subscribers, views and price volatility", "Randomly", "Alphabetically"],
    "answer": 1,
    "explanation": "Spending crawl budget where users care keeps alerts timely without crawling the long tail hourly.",
    "section": "1-how-do-we-collect-prices-for-500m-products"
  },
  {
    "question": "Why mark a subscription as NOTIFIED after sending?",
    "options": ["To delete the user", "To avoid spamming users when the price fluctuates around the target", "To speed up crawling", "It is required by SMTP"],
    "answer": 1,
    "explanation": "Without it, a price bouncing above and below the target would trigger repeated emails."
  },
  {
    "question": "Which index best supports finding subscribers for a price change?",
    "options": ["(user_id)", "(product_id, target_price)", "(created_at)", "(email)"],
    "answer": 1,
    "explanation": "It lets the query jump directly to a product's subscriptions with target at or above the new price."
  }
]
```
