---
title: Notification System
seoTitle: Design a Notification System (Push, Email, SMS)
description: Design a multi-channel notification system — push, email and SMS — with user preferences, reliable delivery, retries, deduplication and rate limiting.
tags: Scaling Writes, Multi-step Processes
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Uber, LinkedIn | 16
---

## Understanding the Problem

:::definition 🔔 What is a Notification System?
A notification system is a shared platform that lets internal services send messages to users over push, email and SMS without each team integrating with providers themselves.
:::

### Functional Requirements

**Core Requirements**

1. Internal services should be able to send a notification to a user (or many users) via push, email or SMS.
2. Users should be able to set preferences — opt out of channels or categories (e.g. marketing).
3. Services should be able to schedule notifications for a future time.

**Below the line (out of scope):**

- An in-app inbox UI.
- A/B testing notification copy.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Notifications must be delivered at least once — none should be silently lost.
2. Transactional notifications (OTP codes, payments) should arrive within seconds; marketing can be slower.
3. The system should handle 10M notifications per minute during campaign bursts.
4. Users shouldn't receive duplicates or be spammed.

**Below the line (out of scope):**

- Content localisation.
- Analytics dashboards.

```sketch Notification System Requirements
Functional
- send push / email / SMS
- user preferences & opt-outs
- scheduled sends

Non-functional
- at-least-once, never lost
- transactional in seconds
- 10M / min bursts
- no duplicates, no spam
```

## The Set Up

### Planning the Approach

The system is a pipeline: accept a request, resolve who and how to reach, then deliver through third-party providers (APNs, FCM, SES/SendGrid, Twilio). We'll make each step durable and independently scalable.

### Defining the Core Entities

1. **Notification**: the request — recipient(s), template, data, priority, category, schedule.
2. **Template**: per-channel content with placeholders.
3. **Preference**: a user's opt-ins per channel and category.
4. **Device / Contact**: push tokens, email address, phone number.
5. **Delivery**: one attempt to send one notification over one channel, with status.

```sketch Notification Entities
Core Entities
- Notification
- Template
- Preference
- Device / Contact
- Delivery
```

### API or System Interface

```
POST /notifications
{
  "userIds": ["u1", "u2"],
  "template": "order_shipped",
  "data": { "orderId": "123" },
  "category": "TRANSACTIONAL",
  "channels": ["PUSH", "EMAIL"],
  "sendAt": null,
  "idempotencyKey": "order-123-shipped"
} -> { "notificationId": "..." }

PUT /users/:userId/preferences
```

## High-Level Design

### 1) Services should be able to send a notification

The **Notification Service** validates the request, stores it, and immediately returns `202 Accepted`. Work then flows through queues so a slow provider never blocks callers.

```diagram Send pipeline
node svc 0,1 box "Internal Service"
node api 1.3,1 box "Notification Service"
node db 1.3,2.2 circle "Notifications DB"
node q 2.6,1 circle "Queue"
node fan 3.9,1 box "Router|- prefs|- templates"
node prov 5.2,1 box "Channel Workers|push / email / SMS"
edge svc -> api "POST /notifications"
edge api -> db
edge api -> q
edge q -> fan
edge fan -> prov
```

### 2) Users should be able to set preferences

The **Router** reads the user's preferences (cached in Redis, since every notification needs them) and drops channels or categories the user has opted out of. It then renders the template per channel and looks up contact details and device tokens.

### 3) Services should be able to schedule notifications

Scheduled notifications are stored with a `sendAt` time and released into the queue when due, using a delayed-delivery mechanism like the one in the Job Scheduler problem.

## Potential Deep Dives

### 1) How do we guarantee at-least-once delivery?

:::solution bad Call providers synchronously from the API
#### Approach

The Notification Service calls APNs, SES and Twilio directly before responding.

#### Challenges

Provider latency and outages leak into every caller; if the process crashes mid-send, the notification is lost.
:::

:::solution great Durable queues per channel with retries and a DLQ
#### Approach

Persist the notification first, then enqueue. Each channel (push, email, SMS) has its own queue and worker pool so an SMS provider outage doesn't back up push. Workers acknowledge only after the provider accepts the message; failures retry with exponential backoff and eventually land in a dead-letter queue for inspection.

#### Challenges

Retries mean the same message can be sent twice — handled by deduplication below.
:::

### 2) How do we avoid duplicate notifications?

Callers include an **idempotency key**; the Notification Service stores it with a unique constraint and returns the existing notification on a repeat request. Channel workers record a `Delivery` row keyed by `(notificationId, userId, channel)` and skip sending if it's already `SENT`. This makes both API retries and worker retries safe.

### 3) How do we handle campaign bursts without delaying critical messages?

:::solution good Single queue, scale workers
#### Approach

Autoscale workers on queue depth.

#### Challenges

A 50M-recipient marketing blast sits in front of an OTP code, which then arrives minutes late.
:::

:::solution great Priority lanes and rate limiting
#### Approach

Separate **high-priority** (transactional) and **bulk** queues per channel, with dedicated capacity for high priority. Expand campaigns asynchronously in batches. Respect provider rate limits with a token bucket per provider, and enforce per-user frequency caps (e.g. at most 3 marketing pushes a day).

#### Challenges

Requires classifying every notification correctly — the API's `category` field drives routing.
:::

:::tip
Clean up dead push tokens: APNs and FCM tell you when a token is invalid. Deleting them avoids wasting sends and keeps provider reputation healthy.
:::

### Final Design

```diagram Final Design
node svc 0,1.2 box "Internal Services"
node api 1.3,1.2 box "Notification Service|- idempotency"
node db 1.3,2.4 circle "Notifications DB"
node sched 1.3,0 box "Scheduler|(sendAt)"
node router 2.6,1.2 box "Router|- prefs (Redis)|- templates|- freq caps"
node hi 3.9,0.6 circle "High-priority|queues"
node bulk 3.9,1.8 circle "Bulk|queues"
node workers 5.2,1.2 box "Channel Workers|- rate limits|- retries / DLQ"
node prov 6.4,1.2 circle "APNs / FCM|SES / Twilio"
edge svc -> api
edge api -> db
edge api -> router
edge sched -> router
edge router -> hi
edge router -> bulk
edge hi -> workers
edge bulk -> workers
edge workers -> prov
```

```quiz
[
  {
    "question": "Why should the API return 202 Accepted and send asynchronously?",
    "options": ["It is faster to type", "Provider latency and outages shouldn't block callers or lose messages", "SMS requires it", "To avoid storing notifications"],
    "answer": 1,
    "explanation": "Persisting and queueing decouples callers from slow, failure-prone third-party providers."
  },
  {
    "question": "What prevents a retried API request from sending the same notification twice?",
    "options": ["A longer timeout", "An idempotency key with a unique constraint", "Rate limiting", "A CDN"],
    "answer": 1,
    "explanation": "The repeat request maps to the existing notification instead of creating a new one.",
    "section": "2-how-do-we-avoid-duplicate-notifications"
  },
  {
    "question": "How do you stop a marketing blast from delaying OTP codes?",
    "options": ["Send marketing first", "Separate high-priority and bulk queues with dedicated capacity", "Use one big queue", "Disable OTP during campaigns"],
    "answer": 1,
    "explanation": "Priority lanes keep transactional traffic flowing regardless of bulk backlog.",
    "section": "3-how-do-we-handle-campaign-bursts-without-delaying-critical-messages"
  },
  {
    "question": "Why give each channel its own queue and worker pool?",
    "options": ["To isolate failures, so an SMS outage doesn't back up push", "To save memory", "Because email is encrypted", "It isn't useful"],
    "answer": 0,
    "explanation": "Isolation keeps healthy channels flowing while a broken provider retries."
  }
]
```
