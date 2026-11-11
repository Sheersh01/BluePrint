---
title: Payment System
seoTitle: Design a Payment System Like Stripe
description: Design a payment system — accepting card payments through processors, idempotent charges, a double-entry ledger, webhooks and reconciliation.
tags: Multi-step Processes, Dealing with Contention
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Stripe, PayPal, Amazon | 15
---

## Understanding the Problem

:::definition 💳 What is a Payment System?
A payment system (like Stripe) lets merchants accept payments from customers. It collects card details securely, charges them through card networks and banks, records every movement of money, and tells merchants what happened.
:::

### Functional Requirements

**Core Requirements**

1. Merchants should be able to create a payment (charge a customer's card for an amount).
2. Merchants should be able to check the status of a payment.
3. Merchants should be notified (via webhook) when a payment succeeds or fails.
4. Merchants should be able to refund a payment.

**Below the line (out of scope):**

- Payouts to merchant bank accounts.
- Subscriptions and invoicing.
- Fraud detection models.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. **Correctness above all**: a customer must never be charged twice, and money must never be lost or created.
2. The system must be highly durable and auditable — every state change is recorded.
3. Payment requests should complete in a few seconds and be highly available.
4. Card data must be handled securely (PCI DSS).
5. Scale to 10,000 payments per second at peak.

**Below the line (out of scope):**

- Multi-currency conversion.

```sketch Payment System Requirements
Functional
- create payment (charge card)
- check status
- webhooks on success / failure
- refunds

Non-functional
- never double charge, never lose money
- durable + auditable
- seconds latency, highly available
- PCI compliant
- 10k payments / sec
```

## The Set Up

### Planning the Approach

Payments cross systems we don't control — card networks, banks, processors — any of which can time out. Our design is about making a **multi-step, partially failing process** correct: idempotency, a durable state machine, a ledger, and reconciliation.

### Defining the Core Entities

1. **Merchant**: the business accepting payments.
2. **Payment**: amount, currency, merchant, status, processor reference, idempotency key.
3. **Ledger Entry**: an immutable debit or credit to an account.
4. **Refund**: a reversal linked to a payment.
5. **Webhook Event**: a notification to deliver to a merchant.

```sketch Payment Entities
Core Entities
- Merchant
- Payment
- Ledger Entry
- Refund
- Webhook Event
```

### API or System Interface

```
POST /payments
Idempotency-Key: 6f1c...
{ "amount": 4999, "currency": "usd", "paymentMethod": "pm_tok_123" } -> Payment

GET  /payments/:paymentId -> Payment
POST /payments/:paymentId/refunds { "amount": 4999 } -> Refund
```

:::info
Amounts are integers in the smallest currency unit (cents). Never use floating point for money.
:::

## High-Level Design

### 1) Merchants should be able to create a payment

Card details are collected by our hosted form/SDK and exchanged for a **token** by a separate, PCI-scoped **Tokenization Vault**, so raw card numbers never touch the merchant's servers or the rest of our system. The merchant calls `POST /payments` with the token.

The **Payment Service** records the payment as `PENDING`, then calls an external **processor** (or card network) to authorise and capture the charge.

```diagram Create a payment
node m 0,1 box "Merchant Server"
node gw 1.2,1 box "API Gateway|- auth|- rate limit"
node pay 2.5,1 box "Payment Service"
node db 2.5,2.2 circle "Payments DB"
node vault 3.8,0.1 box "Token Vault|(PCI scope)"
node proc 3.8,1 circle "Processor /|Card Network"
note 3,2.2 "Payment|- id|- merchantId|- amount|- status|- idempotencyKey|- processorRef"
edge m <-> gw "POST /payments"
edge gw <-> pay
edge pay <-> db
edge pay <-> vault "detokenize"
edge pay <-> proc "authorize + capture"
```

### 2) Merchants should be able to check payment status

Status is read from the Payments DB. Payments follow a state machine: `PENDING → PROCESSING → SUCCEEDED | FAILED`, and `SUCCEEDED → REFUNDED` (or partially refunded).

### 3) Merchants should be notified via webhooks

Every state change writes a Webhook Event. A **Webhook Dispatcher** delivers events to the merchant's endpoint, signing each payload, and retries with backoff until it gets a `2xx`.

### 4) Merchants should be able to refund payments

The Refund flow mirrors payments: record a `PENDING` refund, call the processor, update state on the response, write ledger entries, and emit a webhook.

## Potential Deep Dives

### 1) How do we guarantee a customer is never charged twice?

:::solution bad Trust the client not to retry
#### Approach

Process each `POST /payments` as a new charge.

#### Challenges

Networks time out. A merchant who retries after a timeout — the right thing to do — creates a second charge.
:::

:::solution great Idempotency keys end to end
#### Approach

Merchants send an `Idempotency-Key` header. We store it with a unique constraint alongside the request hash and the final response. A repeat request with the same key returns the stored response (or waits if the first is still in progress) instead of charging again. We pass our own idempotency key (the payment ID) to the processor too, so our retries to them are also safe.

#### Challenges

Keys must be scoped per merchant and kept long enough (e.g. 24h+). A reused key with a different body should be rejected with an error rather than silently replaying.
:::

### 2) What happens when the processor times out?

A timeout doesn't mean failure — the charge may have gone through. We must not mark the payment failed, and must not blindly retry with a new request.

:::solution good Retry with the same idempotency key
#### Approach

Leave the payment in `PROCESSING` and retry the processor call using the same idempotency key until we get a definitive answer.

#### Challenges

Works when the processor supports idempotency, but extended outages leave payments stuck in limbo.
:::

:::solution great State machine + status queries + reconciliation
#### Approach

Payments in `PROCESSING` are picked up by a worker that queries the processor for the transaction status and drives the state machine forward. A daily **reconciliation** job compares our records against the processor's settlement files and flags any mismatch (charged but marked failed, or vice versa) for automated correction or human review.

#### Challenges

Reconciliation is batch and delayed, but it's the final safety net that catches every class of bug.
:::

:::pattern Pattern: Multi-step Processes
A payment spans our database, a vault and an external processor. Durable states, idempotent steps and a reconciliation backstop make it safe.
:::

### 3) How do we record money movements correctly?

:::solution bad Update a balance column
#### Approach

Increment the merchant's `balance` column on each successful payment.

#### Challenges

No history, no audit trail, and a bug or race silently corrupts the balance with no way to explain or repair it.
:::

:::solution great Immutable double-entry ledger
#### Approach

Every movement is recorded as a set of ledger entries that **sum to zero** — e.g. debit "customer funds receivable" 49.99, credit "merchant balance" 48.54, credit "fees revenue" 1.45. Entries are append-only; corrections are new entries, never edits. Balances are derived by summing entries (with cached aggregates for speed). The ledger write happens in the same transaction as the payment's state change.

#### Challenges

Higher write volume and modelling effort, but it's the standard that makes the books auditable and invariants checkable.
:::

### Final Design

```diagram Final Design
node m 0,1.2 box "Merchant"
node gw 1.2,1.2 box "API Gateway|- idempotency"
node pay 2.5,1.2 box "Payment Service|- state machine"
node db 2.5,2.4 circle "Payments DB|+ Ledger"
node vault 2.5,0 box "Token Vault (PCI)"
node proc 3.9,1.2 circle "Processor"
node worker 3.9,2.4 box "Status Worker|+ Reconciler"
node wh 1.2,2.4 box "Webhook Dispatcher|- signed, retries"
edge m <-> gw
edge gw <-> pay
edge pay <-> db
edge pay <-> vault
edge pay <-> proc
edge worker <-> proc
edge worker <-> db
edge db -> wh "events"
edge wh -> m "webhooks"
```

```quiz
[
  {
    "question": "What prevents a merchant's retried request from charging the customer twice?",
    "options": ["Rate limiting", "An idempotency key stored with the original response", "A faster database", "Shorter timeouts"],
    "answer": 1,
    "explanation": "A repeat key returns the original result instead of creating a new charge.",
    "section": "1-how-do-we-guarantee-a-customer-is-never-charged-twice"
  },
  {
    "question": "A call to the processor times out. What should happen?",
    "options": ["Mark the payment failed", "Charge again with a new request", "Keep it PROCESSING and resolve via status queries / idempotent retry", "Refund it"],
    "answer": 2,
    "explanation": "A timeout is ambiguous — the charge may have succeeded — so the state must be resolved, not guessed.",
    "section": "2-what-happens-when-the-processor-times-out"
  },
  {
    "question": "What is the defining property of a double-entry ledger?",
    "options": ["Entries can be edited", "Each transaction's entries sum to zero", "It stores only balances", "It lives in the cache"],
    "answer": 1,
    "explanation": "Balanced, immutable entries make money movements auditable and invariants checkable.",
    "section": "3-how-do-we-record-money-movements-correctly"
  },
  {
    "question": "Why should money be stored as integers in minor units?",
    "options": ["Integers are shorter", "Floating point can't represent many decimal amounts exactly", "Card networks only accept integers", "For encryption"],
    "answer": 1,
    "explanation": "Rounding errors from floats accumulate; cents as integers are exact."
  }
]
```
