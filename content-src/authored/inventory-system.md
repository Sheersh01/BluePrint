---
title: Inventory System
seoTitle: Design an Inventory Management System
description: Design an inventory system for a multi-warehouse retailer — stock levels per location, reservations at checkout, an inventory ledger, available-to-promise, syncing with physical counts, and preventing overselling.
tags: Dealing with Contention, Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📦 What is an Inventory System?
An inventory system tracks how many units of each product (SKU) are in each warehouse or store, how many are promised to orders, and how many can still be sold. It's consulted by product pages ("In stock"), checkout (reserve units), warehouses (receive and ship), and planners (reorder). Its central job is to never sell what isn't there, without blocking sales unnecessarily.
:::

### Functional Requirements

**Core Requirements**

1. Track on-hand quantity per SKU per location.
2. Product pages and search should show availability (in stock, low stock, out of stock) and delivery estimates.
3. Checkout should reserve units; cancelled or expired reservations release them; shipments decrement on-hand.
4. Warehouses should record receipts, transfers, and adjustments from physical counts.
5. Low stock should trigger reorder alerts.

**Below the line (out of scope):**

- Warehouse picking and robotics (see Amazon Warehouse).
- Demand forecasting models.
- Supplier purchase order management.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No overselling: reservations must never exceed available stock.
2. Availability reads are very high volume (~100k/s) and can be slightly stale; reservations must be exact.
3. Reservation latency < 100 ms at checkout.
4. Every change is auditable (who, why, when).
5. Handle flash-sale contention on hot SKUs.

**Below the line (out of scope):**

- Multi-company tenancy.

```sketch Inventory Requirements
Functional
- on-hand per SKU per location
- availability on product pages
- reserve / release / ship
- receipts, transfers, counts
- reorder alerts

Non-functional
- never oversell
- 100k/s reads, slightly stale ok
- reserve < 100ms
- auditable
- hot SKU contention
```

## The Set Up

### Defining the Core Entities

1. **SKU**: a sellable product variant.
2. **Stock record**: SKU, location, `onHand`, `reserved` (available = onHand − reserved − safety stock).
3. **Reservation**: order, SKU, location, quantity, status, expiry.
4. **Inventory movement**: an append-only ledger entry — receipt, shipment, transfer, adjustment — with reason and actor.

### API or System Interface

```
GET  /availability?skus=&postcode= -> [{ sku, status, earliestDelivery }]
POST /reservations { orderId, lines: [{ sku, qty }], shipTo, idempotencyKey } -> { reservationId, allocations }
POST /reservations/:id/confirm | release
POST /movements { type: receipt|shipment|transfer|adjustment, sku, location, qty, reason }
```

## High-Level Design

### 1) Stock per location and the ledger

Each change is written as an **inventory movement** in an append-only ledger, and the **stock record** for that SKU/location is updated in the same transaction. The ledger explains every number; the stock record makes reads fast.

### 2) Availability for product pages

Product pages need "is it available near this customer?" for many SKUs at once. A **projection** of available quantities per SKU per region is maintained from stock changes (via CDC) in a cache, and turned into simple statuses. Reads never hit the transactional database.

```diagram Availability reads
node page 0,1 box "Product Pages|+ search"
node avail 1.6,1 box "Availability Service"
node cache 3.2,1 circle "Availability Cache"
node db 3.2,2.3 circle "Inventory DB"
node cdc 4.8,2.3 box "CDC Projector"
edge page <-> avail
edge avail <-> cache
edge db -> cdc
edge cdc -> cache "update"
```

### 3) Reservations at checkout

Checkout calls **reserve** with the order lines and destination. The service picks a location (allocation) that can fulfil, increments `reserved` with a conditional update, and records a reservation with an **expiry** (e.g. 15 minutes). Payment success **confirms** it; failure or timeout **releases** it. When the warehouse ships, `onHand` and `reserved` both decrease.

### 4) Receipts, counts and reorders

Warehouses post receipts and transfers as movements. **Cycle counts** compare physical counts with the system and post adjustments with a reason. A job compares available quantity with reorder points and raises alerts.

## Potential Deep Dives

### 1) How do we prevent overselling?

:::solution bad Read available, then write
#### Approach

Read `onHand − reserved`, check it, then increment `reserved`.

#### Challenges

Concurrent checkouts both see 1 available and both reserve it.
:::

:::solution good Conditional update
#### Approach

`UPDATE stock SET reserved = reserved + :q WHERE sku = ? AND location = ? AND onHand - reserved - safety >= :q`. Zero rows updated means not enough stock; try another location.

#### Challenges

A hot SKU in a flash sale serialises thousands of updates on one row.
:::

:::solution great Conditional update + bucketed stock for hot SKUs
#### Approach

Keep the conditional update for normal SKUs. For hot SKUs, split the location's available quantity into **N buckets** (rows) and reserve from a random bucket, rebalancing buckets in the background; or gate reservations with an atomic counter in Redis and write the reservation asynchronously. **Idempotency keys** per order make retries safe, and reservation expiry guarantees abandoned carts release stock.

#### Challenges

Bucketing can report "sold out" while one bucket still has units; a fallback scan of other buckets fixes this.
:::

### 2) How do we keep the system in sync with reality?

The physical world drifts: damaged items, mis-scans, theft. Regular **cycle counts** of a few bins per day, prioritised by value and error history, produce adjustments. **Safety stock** per SKU (held back from availability) absorbs small errors so a count discrepancy rarely causes a cancelled order. Every adjustment is a ledger movement with a reason code, so shrinkage can be analysed.

:::tip
Separate the two numbers clearly: the ledger records what physically happened; availability is a business decision (on hand minus reservations minus safety stock).
:::

### 3) How do we choose the location for a reservation?

Allocation considers distance to the customer (delivery promise), stock levels (avoid draining a location), and cost (splitting an order across warehouses is expensive). Start simple — nearest location that can fulfil the whole order — and fall back to splits. The availability projection is per region so product pages can promise realistic delivery dates.

### Final Design

```diagram Final Design
node shop 0,1 box "Storefront"
node avail 1.4,-0.3 box "Availability API"
node cache 2.8,-0.3 circle "Availability Cache"
node res 1.4,1 box "Reservation Service|allocate + reserve"
node db 2.8,1 circle "Inventory DB|stock + ledger"
node wms 4.2,1 box "Warehouse Systems|receipts · ships · counts"
node cdc 4.2,-0.3 box "CDC Projector"
node sweep 2.8,2.3 box "Expiry Sweeper"
node reorder 4.2,2.3 box "Reorder Alerts"
edge shop <-> avail
edge avail <-> cache
edge shop <-> res "checkout"
edge res <-> db
edge wms -> db "movements"
edge db -> cdc
edge cdc -> cache
edge sweep -> db "release expired"
edge db -> reorder
```

```quiz
[
  {
    "question": "How do we prevent two checkouts reserving the last unit?",
    "options": ["Check in the UI", "A conditional update that only reserves when enough stock is available", "Cache the count", "Refund later"],
    "answer": 1,
    "explanation": "The database enforces the stock constraint atomically."
  },
  {
    "question": "Why do reservations have an expiry?",
    "options": ["For security", "So abandoned checkouts release stock automatically", "To speed up search", "Regulations"],
    "answer": 1,
    "explanation": "A sweeper releases expired holds."
  },
  {
    "question": "Why serve product-page availability from a separate projection?",
    "options": ["It's more accurate", "Reads are huge in volume and can be slightly stale, so they shouldn't hit the transactional DB", "To hide stock", "It's required by CDC"],
    "answer": 1,
    "explanation": "Reservations stay exact while reads scale independently."
  },
  {
    "question": "What is safety stock for?",
    "options": ["Marketing", "Absorbing small differences between system and physical counts", "Free samples", "Returns only"],
    "answer": 1,
    "explanation": "Holding a few units back avoids cancelling orders over count errors."
  }
]
```
