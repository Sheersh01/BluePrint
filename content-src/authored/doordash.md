---
title: DoorDash
seoTitle: Design a Food Delivery Platform like DoorDash
description: Design a global food delivery platform like DoorDash — restaurant search by location, ordering, dispatching orders to couriers, live courier tracking, and ETA prediction across many cities.
tags: Real-time Updates, Dealing with Contention, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🛵 What is DoorDash?
DoorDash, Uber Eats and Deliveroo connect three parties: **customers** who order food, **restaurants** that prepare it, and **couriers** (Dashers) who pick it up and deliver it. The system has to show what's available nearby, take orders, choose the right courier at the right moment so food isn't left waiting, and track delivery live — in hundreds of cities worldwide.
:::

### Functional Requirements

**Core Requirements**

1. Customers should be able to browse restaurants that deliver to their location, with menus and estimated delivery times.
2. Customers should be able to place and pay for an order.
3. Restaurants should receive orders and mark them as ready.
4. The system should assign each order to a courier, who can accept or decline.
5. Customers should be able to track their courier live.

**Below the line (out of scope):**

- Courier payouts and incentives.
- Ratings and reviews.
- Grocery and retail delivery.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Restaurant browsing in < 500 ms.
2. An order is never assigned to two couriers at once.
3. Courier locations update every few seconds, with high write volume.
4. Scale to ~1M orders per hour at dinner peak and ~1M active couriers globally.
5. Regional isolation: an outage in one region shouldn't affect others.

**Below the line (out of scope):**

- Strong consistency for menus (minutes of staleness is fine).

```sketch DoorDash Requirements
Functional
- browse nearby restaurants + ETAs
- order + pay
- restaurants receive orders
- assign courier
- live tracking

Non-functional
- browse < 500ms
- one courier per order
- location writes every few seconds
- 1M orders / hour peak
- regional isolation
```

## The Set Up

### Defining the Core Entities

1. **Restaurant**: location, delivery radius or zone, hours, menu, current prep-time estimate.
2. **Order**: customer, restaurant, items, status (`placed`, `confirmed`, `ready`, `picked_up`, `delivered`), assigned courier.
3. **Courier**: status (`offline`, `available`, `on_delivery`), current location, vehicle.
4. **Delivery offer**: an order offered to a courier, with expiry.

### API or System Interface

```
GET  /restaurants?lat=&lng=&cuisine= -> [{ restaurant, etaMinutes }]
POST /orders { restaurantId, items[], address, paymentMethodId, idempotencyKey }
POST /restaurant/orders/:id/ready
PUT  /couriers/me/location { lat, lng, ts }          (every ~4s)
POST /couriers/me/offers/:id/accept | decline
WS   /orders/:id/track -> courier location + status
```

## High-Level Design

### 1) Browsing nearby restaurants

Restaurants are indexed by **geohash/H3 cell**. A query takes the customer's cell and neighbouring cells, filters by open hours and delivery zone, and ranks by relevance and ETA. Menus and restaurant pages are cached heavily since they change rarely.

### 2) Placing an order

The **Order Service** validates items and prices, charges via the payment service (idempotent), stores the order and sends it to the restaurant's tablet. The order then moves through a state machine driven by events.

### 3) Assigning couriers

Couriers' locations stream into a **Location Service** that keeps the latest position per courier in an in-memory geo index (Redis GEO or H3 buckets). The **Dispatch Service** finds available couriers near the restaurant, picks the best one, and sends an **offer** with a short expiry. On accept, the order is assigned; on decline or timeout, the next candidate is offered.

```diagram Dispatch
node rest 0,1 box "Restaurant"
node order 1.5,1 box "Order Service"
node dispatch 3,1 box "Dispatch Service"
node loc 3,-0.3 circle "Courier Geo Index"
node courier 4.5,1 box "Courier App"
edge rest <-> order "confirm / ready"
edge order -> dispatch "needs courier"
edge dispatch <-> loc "nearby available"
edge dispatch <-> courier "offer / accept"
```

### 4) Live tracking

The tracking service subscribes to the assigned courier's location updates and pushes them to the customer over a **WebSocket** or SSE, along with status changes.

## Potential Deep Dives

### 1) When and to whom should we dispatch?

:::solution bad Nearest courier, immediately
#### Approach

As soon as an order is placed, offer it to the closest available courier.

#### Challenges

The courier arrives long before the food is ready and waits, wasting capacity, while orders placed a minute later might have suited them better.
:::

:::solution good Time dispatch to prep time
#### Approach

Predict when the food will be ready (per-restaurant prep-time model) and dispatch so the courier's travel time ends just as the food is ready.

#### Challenges

Still greedy: each order is matched in isolation.
:::

:::solution great Batched optimisation per zone
#### Approach

Every few seconds, for each geographic zone, solve an **assignment problem** over all pending orders and available couriers, minimising expected delivery time and courier idle time using predicted prep times and travel times. Allow **batching** two orders from the same or nearby restaurants to one courier. Offers go out from the solution, and declines feed back into the next round.

#### Challenges

Needs accurate ETA models and enough compute per zone at peak, with a greedy fallback if the solver is late.
:::

### 2) How do we avoid assigning an order to two couriers?

Offers are sent one at a time per order with an expiry, and acceptance is a **conditional update**: `UPDATE orders SET courier = ? WHERE id = ? AND courier IS NULL AND status = 'awaiting_courier'`. If two couriers somehow accept, only one update succeeds; the other gets "no longer available". Couriers are similarly locked so they can't accept two incompatible offers.

:::tip
Mention the unhappy paths: a courier who goes offline mid-delivery triggers re-dispatch, and a restaurant that runs late shifts the dispatch time.
:::

### 3) How do we handle 1M couriers sending locations every 4 seconds?

That's ~250k writes per second. Location updates go to the Location Service, which keeps only the **latest point in memory**, sharded by city or region, and streams updates to Kafka for tracking, ETAs and analytics. Nothing is written to a relational database per update. Each region runs its own stack (location, dispatch, orders) so a failure stays local, with global services only for accounts and payments.

### Final Design

```diagram Final Design
node cust 0,1 box "Customer App"
node gw 1.4,1 box "API Gateway"
node search 2.8,-0.3 box "Restaurant Search|geo index"
node order 2.8,1 box "Order Service"
node pay 2.8,2.3 box "Payments"
node dispatch 4.2,1 box "Dispatch|zone optimiser"
node loc 5.6,1 box "Location Service"
node courier 7,-0.3 box "Courier App"
node kafka 5.6,2.3 box "Kafka|locations"
node track 4.2,2.3 box "Tracking (WS)"
edge cust <-> gw
edge gw <-> search
edge gw <-> order
edge order <-> pay
edge order <-> dispatch
edge dispatch <-> loc
edge courier -> loc "location"
edge dispatch <-> courier "offers"
edge loc -> kafka
edge kafka -> track
edge track -> gw "live position"
```

```quiz
[
  {
    "question": "Why not dispatch the nearest courier immediately?",
    "options": ["It's illegal", "The courier may wait a long time for food that isn't ready", "Couriers prefer long trips", "It's slower to compute"],
    "answer": 1,
    "explanation": "Dispatch timing should match predicted prep time."
  },
  {
    "question": "How do we ensure one courier per order?",
    "options": ["Ask couriers to coordinate", "A conditional update that only assigns if no courier is set", "Send offers to everyone", "Cache assignments"],
    "answer": 1,
    "explanation": "The database guarantees only one acceptance wins."
  },
  {
    "question": "How should courier location updates be stored?",
    "options": ["A row per update in SQL", "Latest position in an in-memory geo index, history streamed to Kafka", "Email", "In the order table"],
    "answer": 1,
    "explanation": "Only the latest location is needed for dispatch."
  },
  {
    "question": "Why run separate regional stacks?",
    "options": ["Branding", "To keep failures and latency local to each region", "Couriers speak different languages", "It's cheaper"],
    "answer": 1,
    "explanation": "Orders and couriers in one city rarely interact with another."
  }
]
```
