---
title: Subscription Management
seoTitle: Design a Subscription Billing System like Stripe Billing
description: Design a subscription management system — plans, recurring billing cycles, proration on upgrades, failed-payment retries (dunning), entitlements and idempotent renewals at scale.
tags: Multi-step Processes, Managing Long Running Tasks
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🔁 What is a Subscription Management System?
A subscription system lets customers sign up for a plan (monthly or yearly), charges them automatically each cycle, handles upgrades, downgrades and cancellations, and tells the product what each customer is entitled to use. Netflix, Spotify and SaaS products all rely on one — often Stripe Billing or an in-house equivalent.
:::

### Functional Requirements

**Core Requirements**

1. Customers should be able to subscribe to a plan with a billing period and price.
2. The system should charge customers automatically at each renewal and issue invoices.
3. Customers should be able to upgrade, downgrade or cancel, with proration where appropriate.
4. Failed payments should be retried, and access suspended if payment never succeeds.
5. Products should be able to check a customer's entitlements (what they currently have access to).

**Below the line (out of scope):**

- Tax calculation (a separate service).
- Usage-based metering (discussed briefly).
- Revenue recognition accounting.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Never double-charge, and never silently skip a renewal.
2. Entitlement checks must be fast (< 10 ms) and highly available — they gate the product.
3. Handle ~50M subscriptions, with renewals heavily clustered on the 1st of the month.
4. All billing changes must be auditable.

**Below the line (out of scope):**

- Real-time renewal at the exact second — within a few hours of the due time is fine.

```sketch Subscription Requirements
Functional
- subscribe to plans
- automatic renewals + invoices
- upgrade / downgrade / cancel
- retry failed payments
- entitlement checks

Non-functional
- never double-charge
- entitlements < 10ms, always up
- 50M subs, 1st-of-month spikes
- auditable
```

## The Set Up

### Defining the Core Entities

1. **Plan**: product, price, currency, billing interval, features.
2. **Subscription**: customer, plan, status (`trialing`, `active`, `past_due`, `cancelled`), current period start/end.
3. **Invoice**: line items for one billing period, amount, status, payment attempts.
4. **Entitlement**: the features a customer can currently use, derived from active subscriptions.

### API or System Interface

```
POST  /subscriptions { customerId, planId, paymentMethodId }
PATCH /subscriptions/:id { planId, prorate: true }
POST  /subscriptions/:id/cancel { atPeriodEnd: true }
GET   /customers/:id/entitlements -> { features[] }
Webhooks out: invoice.paid, invoice.payment_failed, subscription.updated
```

## High-Level Design

### 1) Customers subscribe

The **Subscription Service** stores the subscription, generates the first **invoice**, and charges it through the **payment processor**. On success the subscription becomes `active` with `current_period_end` one interval ahead, and entitlements are updated.

### 2) Automatic renewals

A **renewal scheduler** finds subscriptions whose `current_period_end` has passed (an index on that column) and enqueues a renewal job for each. A **billing worker** creates the next invoice and charges it. Advancing the period and recording the invoice happen in one transaction, keyed by `(subscriptionId, periodStart)` so the same period can never be billed twice.

```diagram Renewals
node sched 0,1 box "Renewal Scheduler|due subscriptions"
node queue 1.6,1 box "Job Queue"
node worker 3.2,1 box "Billing Worker"
node db 3.2,2.3 circle "Billing DB"
node pp 4.8,1 box "Payment Processor"
edge sched -> queue
edge queue -> worker
edge worker <-> db "invoice + period"
edge worker <-> pp "charge"
```

### 3) Upgrades, downgrades, cancellations

An **upgrade** mid-cycle is prorated: credit the unused part of the old plan, charge the remaining part of the new one, and switch entitlements immediately. A **downgrade** usually takes effect at period end, so the customer keeps what they paid for. **Cancellation** at period end just stops the next renewal.

### 4) Failed payments and entitlements

If a charge fails, the subscription moves to `past_due` and enters **dunning** (below). Every status change publishes an event that the **Entitlement Service** consumes to update a fast lookup store.

## Potential Deep Dives

### 1) How do we renew 50M subscriptions without double charging?

:::solution bad Cron job loops through subscriptions
#### Approach

A nightly cron selects all due subscriptions and charges them one by one.

#### Challenges

On the 1st it takes hours, and if it crashes midway, a rerun may charge some customers twice.
:::

:::solution good Queue of renewal jobs
#### Approach

The scheduler enqueues one job per due subscription; many workers process them in parallel.

#### Challenges

Queues deliver at least once, so a job may run twice — still a double-charge risk without more care.
:::

:::solution great Idempotent invoices and charges
#### Approach

Each renewal creates an invoice with a unique key `(subscriptionId, periodStart)`; a duplicate job finds the existing invoice and does nothing. The charge uses the invoice ID as the payment processor's **idempotency key**, so even a retried charge call can't double-bill. To spread the 1st-of-month spike, renewals are processed over a few hours, and new subscriptions anchor billing to their own signup date.

#### Challenges

If the charge outcome is unknown (timeout), the invoice stays `pending` and is reconciled by querying the processor, never by charging again blindly.
:::

### 2) How does dunning work?

Dunning is a **long-running workflow** per failed invoice: retry the card on a schedule (e.g. after 1, 3, 5 and 7 days), email the customer to update their card, and finally cancel or suspend. Many failures are temporary (insufficient funds, expired card refreshed by card-network updater services), so smart retry timing recovers a lot of revenue. Run it in a durable workflow engine (Temporal) or as scheduled jobs with state stored on the invoice.

:::tip
Mention the grace period: keeping access during the first few days of `past_due` avoids punishing customers for a bank hiccup.
:::

### 3) How do we make entitlement checks fast and reliable?

Products call entitlements on nearly every request, so it can't depend on the billing database. The Entitlement Service keeps a **denormalised record per customer** (features, limits, expiry) in Redis or DynamoDB, updated from subscription events. Clients cache it for a short time. If the service is unreachable, products **fail open** using the cached value rather than locking customers out.

### Final Design

```diagram Final Design
node app 0,1 box "Customer / App"
node api 1.5,1 box "Subscription API"
node db 3,1 circle "Billing DB"
node sched 3,-0.3 box "Renewal Scheduler"
node worker 4.5,-0.3 box "Billing Workers"
node pp 6,-0.3 box "Payment Processor"
node dunning 4.5,1 box "Dunning Workflows"
node bus 3,2.3 box "Event Bus"
node ent 4.5,2.3 box "Entitlement Service"
node cache 6,2.3 circle "Entitlement Store"
edge app <-> api
edge api <-> db
edge sched -> worker
edge worker <-> pp
edge db -> sched
edge db <-> dunning
edge db -> bus
edge bus -> ent
edge ent -> cache
```

```quiz
[
  {
    "question": "How do we prevent a renewal job that runs twice from charging twice?",
    "options": ["Run jobs only once a month", "A unique invoice per subscription and period, used as the payment idempotency key", "Lock the whole table", "Ask the customer"],
    "answer": 1,
    "explanation": "Idempotent invoices and charges make duplicate jobs harmless."
  },
  {
    "question": "What is dunning?",
    "options": ["Sending invoices", "Retrying failed payments and notifying customers before suspending", "Calculating tax", "Upgrading plans"],
    "answer": 1,
    "explanation": "It's a long-running recovery workflow for failed payments."
  },
  {
    "question": "Why serve entitlements from a separate store?",
    "options": ["It's cheaper", "Products check them constantly, so they need to be fast and independent of billing", "Billing has no data", "Regulations require it"],
    "answer": 1,
    "explanation": "A denormalised, cached store keeps the product fast even if billing is busy."
  },
  {
    "question": "When does a downgrade usually take effect?",
    "options": ["Immediately with a refund", "At the end of the current period", "Never", "After a week"],
    "answer": 1,
    "explanation": "Customers keep what they've already paid for."
  }
]
```
