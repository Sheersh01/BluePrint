---
title: E-commerce Checkout
seoTitle: Design an E-commerce Checkout System
description: Design checkout for an online store — carts, inventory reservation, idempotent order placement, payment, and an orchestrated order workflow.
tags: Multi-step Processes, Dealing with Contention
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🛒 What is an E-commerce Checkout?
Checkout is the path from "items in my cart" to "order confirmed": pricing the cart, reserving stock, charging the customer and creating the order — reliably, even when payments fail or users double-click.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to add and remove items in a cart that persists across devices.
2. At checkout, users should see the final price (items, tax, shipping, discounts).
3. Placing an order should reserve inventory, charge payment and create the order.
4. Users should get a confirmation and see the order status.

**Below the line (out of scope):**

- Fulfilment and shipping logistics.
- Product search and recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Never charge without creating an order, and never create duplicate orders or charges.
2. No overselling of limited stock.
3. Checkout completes in a couple of seconds and is highly available — it's where revenue happens.
4. Handle peak sales events (10× normal traffic).

**Below the line (out of scope):**

- Multi-currency and tax calculation internals.

```sketch Checkout Requirements
Functional
- persistent cart
- final price
- place order: reserve, charge, create
- confirmation + status

Non-functional
- no duplicate orders / charges
- no overselling
- fast, highly available
- 10x peak traffic
```

## The Set Up

### Defining the Core Entities

1. **Cart**: user, line items (SKU, quantity).
2. **Inventory**: available and reserved quantity per SKU (per warehouse).
3. **Order**: items, prices, totals, status, idempotency key.
4. **Payment**: authorisation/capture status with the payment provider.

### API or System Interface

```
PUT  /cart/items/:sku { quantity }
GET  /cart -> { items, subtotal }
POST /checkout/quote -> { quoteId, total, tax, shipping, expiresAt }
POST /orders { quoteId, paymentMethodToken } (Idempotency-Key header) -> { orderId, status }
GET  /orders/:id
```

## High-Level Design

### 1) Users manage a cart

The **Cart Service** stores carts in a key-value store keyed by user ID (fast reads and writes, simple shape). Carts don't reserve stock — that would let abandoned carts lock inventory.

### 2) Users see the final price

`POST /checkout/quote` calls pricing, promotions, tax and shipping services, then stores a short-lived **quote** with the exact totals. The order references the quote, so the customer is charged what they saw.

### 3) Placing an order

```diagram Order placement saga
node client 0,1 box "Client"
node orch 1.5,1 box "Order Orchestrator|(saga)"
node inv 3,0 box "Inventory Service"
node pay 3,1 box "Payment Service"
node ord 3,2 box "Order DB"
node q 1.5,2.4 circle "Events"
edge client <-> orch "POST /orders"
edge orch <-> inv "1. reserve"
edge orch <-> pay "2. authorize"
edge orch <-> ord "3. create order"
edge orch -> q "4. order.placed"
```

An **Order Orchestrator** runs the steps as a saga:

1. Reserve inventory for every line item (with an expiry).
2. Authorise the payment.
3. Create the order as `CONFIRMED` and commit the inventory reservation.
4. Emit `order.placed` for fulfilment, email and analytics.

If any step fails, compensations run in reverse: void the authorisation, release the reservation.

### 4) Confirmation and status

The client receives the order ID immediately; status updates (paid, shipped) come from events and are visible via `GET /orders/:id`.

## Potential Deep Dives

### 1) How do we prevent duplicate orders and charges?

:::solution bad Disable the button on the client
#### Approach

Prevent double clicks in the UI.

#### Challenges

Network retries, page refreshes and mobile reconnects still send duplicates.
:::

:::solution great Idempotency keys end to end
#### Approach

The client generates an idempotency key per checkout attempt. The Order Service stores it with a unique constraint; a repeated request returns the existing order instead of creating another. The orchestrator passes deterministic keys (orderId + step) to the payment provider, so retries never double-charge.

#### Challenges

Keys must be scoped per user and retained long enough to cover retries.
:::

### 2) How do we avoid overselling?

:::solution good Decrement stock at order time with a conditional update
#### Approach

`UPDATE inventory SET available = available - :qty WHERE sku = ? AND available >= :qty`.

#### Challenges

Correct, but if payment then fails we must add the stock back.
:::

:::solution great Reservations with expiry, committed on success
#### Approach

Move quantity from `available` to `reserved` atomically, with a reservation expiry. On success the reservation is committed; on failure or timeout it's released by the saga or an expiry job. For flash-sale-level contention, see [Flash Sale](/learn/system-design/problem-breakdowns/flash-sale).

#### Challenges

Multi-warehouse stock needs allocation logic to choose where to reserve.
:::

### 3) What if a step's outcome is unknown?

If the payment call times out, don't assume failure. The orchestrator persists state after every step, retries with the same idempotency key, and queries the provider for the transaction status. A periodic reconciliation compares orders, reservations and payments to catch anything stuck.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node gw 1.3,1.2 box "API Gateway"
node cart 2.6,0 box "Cart Service"
node quote 2.6,1.2 box "Pricing / Quote"
node orch 2.6,2.4 box "Order Orchestrator|- idempotency|- saga + compensations"
node inv 4,1.8 box "Inventory|reservations"
node pay 4,3 box "Payment Service"
node odb 1.3,3 circle "Orders DB"
node kafka 4,0.6 circle "Events"
edge client <-> gw
edge gw <-> cart
edge gw <-> quote
edge gw <-> orch
edge orch <-> inv
edge orch <-> pay
edge orch <-> odb
edge orch -> kafka
```

```quiz
[
  {
    "question": "Why shouldn't adding to cart reserve inventory?",
    "options": ["It's slow", "Abandoned carts would lock up stock", "Carts can't store SKUs", "Payment requires it"],
    "answer": 1,
    "explanation": "Reserve only at checkout, with an expiry."
  },
  {
    "question": "What prevents a retried order request from creating a second order?",
    "options": ["Disabling the button", "An idempotency key with a unique constraint", "Rate limiting", "Caching the cart"],
    "answer": 1,
    "explanation": "The repeat request returns the original order."
  },
  {
    "question": "If authorising payment fails after inventory was reserved, what happens?",
    "options": ["Keep the reservation", "A compensating action releases the reservation", "Charge again", "Ship anyway"],
    "answer": 1,
    "explanation": "Sagas undo completed steps on failure."
  },
  {
    "question": "Why does the order reference a quote?",
    "options": ["For SEO", "So the customer is charged exactly the total they saw", "To skip taxes", "To cache the cart"],
    "answer": 1,
    "explanation": "The quote locks pricing for a short window."
  }
]
```
