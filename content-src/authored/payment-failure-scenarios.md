---
title: Payment Failure Scenarios
subtitle: Every place a payment can break between sender, server, database and provider — and the tool that fixes each one.
section: tips
category: Tips & Tricks
seoTitle: Payment System Failure Scenarios and Fixes
description: 21 payment failure scenarios — timeouts, crashes, duplicate requests, webhooks, races — with the idempotency, state-machine, outbox and reconciliation fixes interviewers expect.
author: Editorial Team
published: Nov 11, 2026
---

Payment questions are really failure questions. The interviewer will pick a point in the flow — "what if the server crashes *here*?" — and watch whether you reach for the right tool. Walk through each scenario below, then use the tables at the end as a cheat sheet.

## The Failure Scenarios

### Scenario 1 — Sender never reaches Server

```
Sender
   │
   X
   │
Server
```

**Failure:** Network failure before the server receives the request.

**What happens?** Nothing happened from the payment system's perspective.

**Solution:** Sender can retry. But the request should contain:

```
Idempotency-Key: abc123
```

So:

```
Attempt 1 → fails before server
Attempt 2 → reaches server
```

No problem.

**Design principle:** Client retries + idempotency key.

### Scenario 2 — Server receives request but crashes before DB write

```
Sender
   │
   ▼
Server
   │
   X
   │
  DB
```

Server receives `Pay ₹100`, then crashes before saving anything. Sender gets a `timeout` and retries.

**Solution:** Idempotency key: `abc123`

The server processes the retry as a new attempt only if the original wasn't durably recorded.

**Important subtlety:** If the server crashes before recording the idempotency key, the retry may legitimately be processed again. That's okay only if the payment hasn't been sent to the Receiver yet.

### Scenario 3 — Server writes DB but crashes before calling Receiver

```
Sender
   ↓
Server
   ↓
 DB ✓
   X
Receiver
```

DB:

```
payment_id = 123
status = CREATED
```

Server crashes.

**Problem:** Payment exists in DB but hasn't been sent to Receiver.

**Solution:** Use a durable state machine + retry worker.

```
CREATED
   ↓
PROCESSING
   ↓
SUCCESS
```

A background worker finds `status = CREATED` and continues processing. This is much safer than relying entirely on the original HTTP request.

### Scenario 4 — Server calls Receiver but Receiver never responds

This is one of the most important scenarios.

```
Server
   │
   │ "Charge ₹100"
   ▼
Receiver
   │
   │ SUCCESS
   X
Server doesn't receive response
```

Receiver may have already charged the customer. Server sees `TIMEOUT`.

**❌ Wrong solution:** Immediately retry: "Charge ₹100 again" → Potential result: ₹100 + ₹100 = ₹200 charged.

**✅ Correct solution:** Use idempotency key at the Receiver boundary.

```
payment_id = PAY123
idempotency_key = PAY123
```

First attempt: `Receiver: PAY123 → charge ₹100`

Retry: `Receiver: PAY123 already processed → return original result`

Therefore: ₹100, not ₹200.

### Scenario 5 — Receiver succeeds but Server crashes

```
Server
   │
   ▼
Receiver
   │
   │ ₹100 SUCCESS
   ▼
Server
   X
```

The DB might say `PROCESSING` but Receiver says `SUCCESS`.

**Solution:** Don't blindly mark it failed. Use:

1. **Idempotent retry** — Retry the same payment ID (`PAY123`). Receiver returns `SUCCESS`.
2. **Query payment status** — If Receiver supports `GET /payments/PAY123`, Server can ask "What happened to PAY123?"
3. **Webhook** — Receiver can asynchronously tell Server: `PAY123 → SUCCESS`
4. **Reconciliation** — Periodically compare your DB vs Receiver's records. This catches payments that got stuck.

### Scenario 6 — DB crashes before payment is sent

```
Server
   │
   X
  DB
```

Server hasn't called Receiver yet.

**Solution:** Durable payment state + retry worker.

```
PAY123
status = CREATED
```

Worker: `CREATED → PROCESSING`, then calls Receiver.

### Scenario 7 — DB crashes after Receiver succeeds

This is nastier.

```
Server
   │
   ▼
Receiver
   │
   │ ₹100 SUCCESS
   ▼
Server
   │
   X
  DB
```

Receiver has `SUCCESS`. Your DB doesn't.

**Solution:** Again: Idempotency + status query/webhook + reconciliation.

This is why you should never depend exclusively on the **Server response** to determine payment truth.

### Scenario 8 — Sender doesn't receive Server response

```
Sender
   │
   ▼
Server
   │
   ▼
Receiver ✓
   │
   ▼
Server ✓
   X
Sender
```

Sender sees `TIMEOUT` and thinks "Payment failed." But it may have succeeded.

**❌ Wrong:** Sender creates another payment.

**✅ Correct:** Retry using the same idempotency key: `abc123`. Server responds `PAY123 SUCCESS`. No duplicate payment.

### Scenario 9 — Sender sends the same request twice

```
POST /payment
₹100
idempotency_key = ABC
```

then

```
POST /payment
₹100
idempotency_key = ABC
```

**Solution:** Store idempotency keys.

```
idempotency_key | payment_id | status
------------------------------------------------
ABC             | PAY123     | SUCCESS
```

When request `ABC` comes in, check DB. If it already exists: return existing result.

### Scenario 10 — Two different requests try to pay simultaneously

Suppose the user has `Balance = ₹100`. Two requests arrive:

```
Request A → spend ₹100
Request B → spend ₹100
```

Both read `Balance = ₹100`. Now you've spent ₹200 from ₹100.

**Solution:** Atomic update / row locking.

```sql
UPDATE accounts
SET balance = balance - 100
WHERE account_id = 123
AND balance >= 100;
```

If `rows affected = 1`, payment can proceed. If `rows affected = 0`, insufficient balance.

### Scenario 11 — Same payment processed by two Server instances

```
              ┌─ Server A
Sender ───────┤
              └─ Server B
```

Both somehow receive `PAY123`.

**Solution:** Database uniqueness constraint: `UNIQUE(idempotency_key)` and atomic insertion.

**Important:** Don't rely only on application-level checks.

Bad:

```python
if not exists(key):
    create(key)
```

Two servers can both execute: `A → check → doesn't exist`, `B → check → doesn't exist`.

Instead, let the DB enforce uniqueness.

### Scenario 12 — Receiver is down

```
Server → X → Receiver
```

**Solution:** Don't continuously hammer Receiver. Use:

**Retry with exponential backoff:** `1 sec → 2 sec → 4 sec → 8 sec → 16 sec`

plus **Circuit breaker:**

```
CLOSED
   ↓
OPEN
```

Stop sending requests temporarily. After some time: `HALF-OPEN` — test Receiver. If successful: `CLOSED`.

### Scenario 13 — Receiver is slow

```
Server
  │
  │ request
  ▼
Receiver
  │
  │ 60 seconds...
```

**Problem:** Server threads/connections get exhausted.

**Solution:** Set connection timeout and read timeout. And move payment processing toward an asynchronous architecture.

Instead of:

```
HTTP request → wait for receiver → return response
```

use:

```
HTTP request → DB → Queue → Worker → Receiver
```

### Scenario 14 — Server sends request, then retries because of timeout

This deserves special attention.

```
Server → Receiver
         ₹100
        timeout
Server → Receiver
         ₹100
```

Receiver may have received both.

**Solution:** Every payment request needs a stable identifier: `PAY123`. Receiver must treat `PAY123, PAY123, PAY123` as the same operation. This is idempotency.

### Scenario 15 — Receiver says FAILED, but response is lost

```
Server → Receiver
           │
           X
```

Server doesn't know. Retry with same payment ID: `PAY123`. Receiver: `PAY123 → FAILED`. Server can safely record `FAILED`, because it didn't create a second payment.

### Scenario 16 — Receiver succeeds but webhook arrives multiple times

Receiver might send:

```
Webhook PAY123 SUCCESS
Webhook PAY123 SUCCESS
Webhook PAY123 SUCCESS
```

**Solution:** Webhook processing must also be idempotent. Store `event_id` with `UNIQUE(event_id)`. If event already processed: ignore.

### Scenario 17 — Webhook arrives before your original response

Possible:

```
Server → Receiver
             │
             ├── SUCCESS
             │
             └── webhook ──→ Server
```

Webhook arrives before the synchronous response. That's okay. Your payment state machine must allow events to arrive in different orders.

```
PROCESSING
    ↓
SUCCESS
```

and later the original API response can simply confirm `SUCCESS`.

### Scenario 18 — Webhook says SUCCESS but DB update fails

```
Receiver
   │
   │ webhook
   ▼
Server
   │
   X
  DB
```

**Solution:** Don't lose the webhook. Use:

```
Webhook → Queue → Worker → DB
```

or persist the event before processing it. Then retry DB processing.

### Scenario 19 — Server processes payment but response is lost

This is essentially `SUCCESS`, but Sender doesn't know. Sender retries.

**Solution:** Idempotency key. `ABC123 → PAY123 → SUCCESS`. Return the previously stored result.

### Scenario 20 — Server crashes halfway through multiple DB operations

Suppose:

1. deduct balance
2. create payment
3. create transaction

Server crashes after step 1. Now: `balance = ₹0`, `payment = missing`, `transaction = missing`. Bad.

**Solution:** Use a DB transaction:

```sql
BEGIN;

deduct balance;
create payment;
create transaction;

COMMIT;
```

If anything fails: `ROLLBACK`. So either ALL happen or NONE happen.

### Scenario 21 — DB update and message publishing problem

```
Server
  │
  ├── DB ✓
  │
  └── Queue X
```

DB transaction succeeds but queue publish fails. Your payment exists but the worker doesn't know about it.

**Solution:** This is where the **Transactional Outbox Pattern** becomes useful.

Instead of DB + Queue independently:

```
BEGIN TRANSACTION

payment = PROCESSING
outbox_event = "PROCESS_PAYMENT"

COMMIT
```

Then an outbox worker publishes: `outbox → queue → payment worker`. Now the event isn't lost just because the server crashed.

## The Complete Architecture

A reasonably robust payment system starts looking like:

```
                     ┌───────────────┐
                     │    Sender     │
                     └───────┬───────┘
                             │
                    idempotency key
                             │
                             ▼
                     ┌───────────────┐
                     │     API       │
                     │    Server     │
                     └───────┬───────┘
                             │
                       DB transaction
                             │
                             ▼
                     ┌───────────────┐
                     │      DB       │
                     │               │
                     │ Payment       │
                     │ Idempotency   │
                     │ Outbox        │
                     └───────┬───────┘
                             │
                       Outbox worker
                             │
                             ▼
                     ┌───────────────┐
                     │     Queue     │
                     └───────┬───────┘
                             │
                          Worker
                             │
                     retry + backoff
                             │
                             ▼
                     ┌───────────────┐
                     │   Receiver    │
                     └───────┬───────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
                Response             Webhook
                   │                   │
                   └─────────┬─────────┘
                             ▼
                            DB
                             │
                       Reconciliation
```

## The 8 Tools You Should Remember

When you're given a payment failure scenario in a system-design interview/exercise, think about these:

| Problem | Tool |
|---|---|
| Request duplicated | Idempotency key |
| Concurrent modification | Atomic update |
| Multi-step DB consistency | DB transaction |
| Need to protect row while doing multiple operations | Row lock (`SELECT FOR UPDATE`) |
| Server crashes between DB and queue | Transactional outbox |
| Receiver temporarily unavailable | Retry + exponential backoff |
| Receiver continuously unavailable | Circuit breaker |
| Unknown payment outcome | Status API + webhook + reconciliation |

**The golden rule for payment systems:**

> Never interpret a timeout as a failure when the operation may have reached the Receiver.

A timeout means `UNKNOWN`, not `FAILED`. That single idea explains why idempotency keys + payment state machines + retries + reconciliation are so important.

## Failure Scenarios → Solutions (Full Table)

| # | Failure scenario | What can go wrong? | Correct solution | Why? |
|---|---|---|---|---|
| 1 | Sender → Server fails | Server never receives request | Client retry + Idempotency Key | Safe to retry without creating duplicates |
| 2 | Server crashes before DB write | Request is lost | Idempotency Key + Retry | Sender can safely retry |
| 3 | Server writes DB, then crashes before Receiver call | Payment stuck in DB | Payment state machine + Background Worker | Worker can resume CREATED/PROCESSING payments |
| 4 | Server → Receiver timeout | Receiver may have processed payment, but Server doesn't know | Idempotency Key + Status API/Webhook | Never assume timeout = failure |
| 5 | Receiver succeeds, Server crashes before DB update | Receiver says SUCCESS, DB says PROCESSING | Idempotent retry + Webhook + Reconciliation | Eventually discover true payment state |
| 6 | DB crashes before Receiver call | Payment state may not be persisted | DB Transaction + Durable State | Don't lose payment intent |
| 7 | DB crashes after Receiver succeeds | Money transferred but DB doesn't show it | Webhook + Reconciliation | Recover inconsistent state |
| 8 | Sender doesn't receive Server response | User thinks payment failed | Same Idempotency Key on retry | Prevents duplicate payment |
| 9 | Sender sends same request twice | Two payments may be created | Idempotency Key + UNIQUE constraint | Same logical request produces one result |
| 10 | Two requests modify same balance | Race condition / negative balance | Atomic UPDATE | Database performs check + update atomically |
| 11 | Two Server instances process same payment | Duplicate processing | DB UNIQUE constraint + Idempotency Key | DB guarantees uniqueness |
| 12 | Receiver is down | Repeated requests fail | Retry + Exponential Backoff | Gives Receiver time to recover |
| 13 | Receiver continuously fails | Server gets overloaded by retries | Circuit Breaker | Temporarily stop calling unhealthy Receiver |
| 14 | Receiver is very slow | Server connections/threads get exhausted | Timeout + Async Processing/Queue | Don't keep HTTP requests waiting |
| 15 | Server retries after Receiver timeout | Could charge twice | Same Idempotency Key to Receiver | Receiver recognizes duplicate |
| 16 | Receiver returns FAILED but response is lost | Server doesn't know final result | Retry using same Payment ID / Status API | Retry doesn't create another payment |
| 17 | Receiver sends webhook multiple times | Payment processed multiple times | Webhook Idempotency + UNIQUE event_id | Duplicate webhook becomes harmless |
| 18 | Webhook arrives before API response | Events arrive out of order | Payment State Machine | System handles asynchronous ordering |
| 19 | Webhook received but DB update fails | Webhook information could be lost | Queue + Retry / Durable Event | Process webhook again |
| 20 | Server crashes halfway through DB operations | Partial DB state | DB Transaction | All-or-nothing DB changes |
| 21 | DB succeeds but Queue publish fails | Payment exists but worker doesn't know | Transactional Outbox | DB and event become reliably linked |
| 22 | Concurrent balance withdrawals | Both requests read same balance | Atomic Update / Row Lock | Prevents lost updates/overspending |
| 23 | Need read → validate → modify multiple times | Another transaction can change row in between | Row Lock (SELECT FOR UPDATE) | Keeps row protected during transaction |
| 24 | Payment remains PROCESSING forever | System doesn't know what happened | Timeout policy + Reconciliation | Periodically resolve stuck payments |
| 25 | Receiver and DB disagree | Money state differs between systems | Reconciliation job | Compare both systems and repair discrepancies |

## Quick Reference: If the Problem Is...

| If the problem is... | Think of... |
|---|---|
| 🔁 Same request comes again | Idempotency Key |
| ⚔️ Two requests modify same data | Atomic Update |
| 🔒 Need to protect a row during multiple operations | Row Lock |
| 💾 Multiple DB operations must succeed together | DB Transaction |
| 📤 DB succeeded but event/queue failed | Transactional Outbox |
| 🔄 Temporary external failure | Retry + Exponential Backoff |
| 🚨 External service keeps failing | Circuit Breaker |
| ❓ Don't know whether payment succeeded | Status API + Webhook + Reconciliation |
| 📩 Webhook can arrive multiple times | Webhook Idempotency |
| 🕐 Payment stuck in processing | State Machine + Reconciliation |

## Decision Matrix: Idempotency Key vs Atomic Update vs Row Lock

| Situation | Idempotency Key | Atomic Update | Row Lock |
|---|---|---|---|
| Same API request repeated | ✅ | ❌ | ❌ |
| Network timeout + retry | ✅ | ❌ | ❌ |
| Double-click "Pay" | ✅ | ❌ | ❌ |
| Two users spend same balance | ❌ | ✅ | Sometimes |
| Prevent stock going below 0 | ❌ | ✅ | Sometimes |
| Increment/decrement counter | ❌ | ✅ | ❌ |
| Read → check → modify row | ❌ | Sometimes | ✅ |
| Multiple operations need protected row | ❌ | Sometimes | ✅ |
| Prevent duplicate payment creation | ✅ | ❌ | ❌ |
| Prevent duplicate DB records | ✅ + UNIQUE constraint | ❌ | ❌ |

## Where to Go Next

- Put it together in a full design: [Payment System](/learn/system-design/problem-breakdowns/payment-system).
- The concurrency tools in more depth: [Dealing with Contention](/learn/system-design/patterns/dealing-with-contention).
- State machines, workers and sagas: [Multi-step Processes](/learn/system-design/patterns/multi-step-processes).
