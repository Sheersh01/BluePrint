---
title: Money Transfer
subtitle: A naive Python transfer function. Find what breaks — validation, partial failures, races, retries, timeouts — and fix it.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix a Naive Money Transfer Function
description: A code-review interview question — a naive Python money transfer function with partial failures, race conditions, duplicate retries and external timeouts, and how to fix each one.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
Validation, DB transactions, concurrency control, idempotency, external service timeouts, reconciliation, async notifications.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| Same request retried (client retry) | — | **Idempotency key** |
| Two different requests racing on same balance | Idempotency key | **Row lock / atomic DB update** |
| Debit + credit + transaction record must stay consistent | Try/catch everywhere | **DB transaction (BEGIN … COMMIT / ROLLBACK)** |
| Notification fails | Roll back transfer | **Async queue/event + retry after commit** |
| External bank API times out | Retry transfer blindly | **Query status by reference ID + reconciliation** |

**Mental model (decision tree)**

```
Same request repeated?
        ↓
   Idempotency key

Different requests racing?
        ↓
  DB locking / atomic update

Debit + credit + transaction record?
        ↓
   DB transaction

Notification?
        ↓
 Async queue after commit

External service timeout?
        ↓
 Query status → reconcile (never blind retry)
```

## 1. The Starting Point — Naive Python Transfer Code

The function you're handed in the interview:

```python
def transfer(sender_id, receiver_id, amount):
    sender = get_user(sender_id)
    receiver = get_user(receiver_id)

    if not sender or not receiver:
        return {"error": "User not found"}

    if sender.balance >= amount:
        sender.balance -= amount
        receiver.balance += amount

        save_user(sender)       # can succeed
        save_user(receiver)     # can fail → money lost
        create_transaction(sender_id, receiver_id, amount)  # can fail → no record
        send_notification(receiver_id, amount)                # can fail → should NOT rollback

        return {"status": "success"}
    return {"error": "Insufficient balance"}
```

**Flow (what goes wrong step by step)**

```
sender.balance -= amount
receiver.balance += amount
        ↓
save sender
        ↓
save receiver
        ↓
create transaction
        ↓
send notification
        ↓
return
```

**Why this matters in interviews**: A simple "transfer money" function is a gateway into distributed systems thinking — validation, consistency, concurrency, idempotency, and external dependencies.

## 2. What Most Candidates Catch ✅

### 2.1 Validate Both Users

- Sender exists
- Receiver exists

**Also add**:

- Sender ≠ receiver
- Sender is active
- Account is allowed to transfer

### 2.2 Don't Permanently Update Balances Before Safe Commit

Correct instinct. The current code updates balances and saves them in separate steps — multiple failure points can leave money inconsistent.

### 2.3 Handle Failures

Correct direction, but **"add try/catch everywhere" is not enough**.

The interviewer will ask: **"What exactly do you do inside the catch?"**

That's where system-design thinking matters — rollback, atomicity, reconciliation, not just logging.

## 3. What Most Candidates Miss ⚠️

### 3.1 Race Condition / Concurrent Transfers

**Scenario**: Sender has ₹1,000. Two requests arrive simultaneously:

- Request A: transfer ₹800
- Request B: transfer ₹800

Both read `balance = ₹1000`, both pass `if sender.balance >= amount`, and the user effectively transfers ₹1,600 despite having ₹1,000.

**Fix**: Atomic balance updates / concurrency control (see Section 5).

### 3.2 Partial Failure — Sender Saved, Receiver Failed

```
Sender:   ₹2000 → ₹1200  ✅
Receiver: unchanged      ❌
```

Money disappeared. **This is arguably the biggest flaw.**

**Fix**: Database transaction so balance changes happen together (all-or-nothing).

### 3.3 Transaction Record Fails After Balances Change

Even worse:

```
sender updated ✅
receiver updated ✅
transaction creation ❌
```

Money moved, but no reliable transaction record. Serious consistency issue for financial systems.

**Fix**: Include transaction record creation inside the same DB transaction as debit/credit.

### 3.4 Duplicate Requests / Retries

Client sends `POST /transfer`. Server succeeds, but response is lost. Client retries → ₹500 transferred twice.

**Fix**: Idempotency key / transaction ID (see Section 6).

### 3.5 Amount Validation

Code doesn't check `amount > 0`. Someone could send `amount = -500`.

**Also consider**: maximum transfer limits, decimal precision, currency.

### 3.6 Notification Should Not Determine Transaction Success

Current flow ties notification to success. If notification fails — should the transfer roll back?

**No.** Notification is a secondary operation.

**Better flow**:

```
Transfer committed
       ↓
Return success
       ↓
publish event
       ↓
notification service (retry on failure)
```

This is where **message queues/events** enter your HLD.

## 4. Important Correction — How to Phrase Atomicity

:::warning Imprecise
"First the transaction needs to be successful, only then the amount goes to receiver."
:::

**✅ Precise**

There isn't a separate mysterious "transaction" before changing balances. The balance updates and transaction record should be **one atomic unit**:

```
BEGIN DB TRANSACTION

validate balance
lock/check sender balance
debit sender
credit receiver
create transaction record

COMMIT
```

If anything critical fails → **ROLLBACK**.

## 5. Concurrency Control — Two Different Requests Racing

:::info Interviewer asks
"Assume we're using a relational database and your transfer operation is atomic. Now two requests from the same sender arrive simultaneously. How exactly would you prevent the sender from spending the same balance twice?"
:::

### ⚠️ Common Mistake

**Idempotency key** — good instinct, but solves a **different** problem.

| Request | Amount | Idempotency Key |
|---|---|---|
| A | ₹800 | key-A |
| B | ₹800 | key-B |

These are two **different legitimate requests**. Idempotency keys don't stop them. Both can read `balance = ₹1000` and proceed.

### ✅ Correct Answer — Database Concurrency Control

**Approach 1: Row Lock (`SELECT … FOR UPDATE`)**

```sql
BEGIN;

SELECT balance
FROM users
WHERE id = ?
FOR UPDATE;
```

Now the sender's row is locked.

```
Request A:
  read ₹1000 → debit ₹800 → balance ₹200 → commit

Request B:
  waits for A → reads ₹200 → insufficient balance → rollback
```

**Approach 2: Atomic Update**

```sql
UPDATE users
SET balance = balance - ?
WHERE id = ?
AND balance >= ?;
```

Verify that **exactly one row** was updated. If 0 rows updated → insufficient balance.

:::tip Say this
"Idempotency keys prevent duplicate processing of the same request, but they don't prevent two different concurrent transfers. For that, I'd use a database transaction with row-level locking or an atomic balance update, so only one transfer can successfully consume the available balance."
:::

## 6. Idempotency — Same Request Retried

:::info Interviewer asks
"The debit, credit, and transaction record are all inside one database transaction. But the service crashes after COMMIT and before the client receives the response. The client retries. How do you make sure the user doesn't get charged twice?"
:::

**This is where idempotency key is exactly the right answer.** ✅

**Flow**

```
Client
  ↓
POST /transfer
Idempotency-Key: ABC123
  ↓
Transfer Service
  ↓
Check ABC123 in DB
```

**First request**:

```
ABC123 doesn't exist
      ↓
perform transfer
      ↓
COMMIT
      ↓
save ABC123 → SUCCESS + transaction_id
      ↓
return transaction_id
```

**Client retries (response was lost)**:

```
ABC123 already exists
      ↓
DO NOT transfer again
      ↓
return the existing transaction result
```

### Critical Detail — Enforce at DB Level

Say in the interview:

:::tip Say this
"I'd enforce uniqueness of the idempotency key at the database level, not just check it in application code."
:::

**Why?** This is unsafe:

```python
if not exists(key):
    perform_transfer()
    save(key)
```

Two concurrent requests can both see the key as absent.

**Fix**: `idempotency_key UNIQUE` and persist request/result atomically.

## 7. External Bank Timeout — Ambiguous Outcome

:::info Interviewer asks
"Now assume your transfer service calls an external bank/payment service. The request times out. You don't know whether the bank actually processed the transfer or not. What would you do?"
:::

**Saying "I don't know" is better than inventing an answer.** This is one of the harder distributed-systems problems.

### The Situation

```
Your service → Bank API → Transfer ₹500
```

Bank processes it ✅, but HTTP response times out:

```
Bank → response
          X
       timeout
```

Your service asks: **"Did the transfer happen or not?"**

You **cannot safely assume failure**. This is called an **ambiguous outcome**.

### What To Do

**Step 1: Use Idempotency / Reference ID for External Transfer**

```
transaction_id = TX123

Bank.transfer(amount=500, reference_id="TX123")
```

If request times out → **don't blindly send another transfer**.

**Step 2: Query the Bank**

```
GET /transfer/TX123
```

Possible results:

| Status | Action |
|---|---|
| SUCCESS | Mark our transaction SUCCESS |
| FAILED | Mark FAILED |
| PENDING | Keep checking / reconcile later |

**Step 3: If Bank Doesn't Support Idempotency → Reconciliation**

```
TRANSFER_PENDING
       ↓
Bank timeout
       ↓
Reconciliation worker
       ↓
Query bank
       ↓
Update our DB
```

**Golden rule for payment systems**:

> **Never retry an uncertain financial operation blindly.**

:::tip Say this
"If the external payment service times out, I can't assume the transaction failed because it may already have succeeded. I'd use a unique transaction/reference ID with the external provider and query the transaction status before retrying. If the provider supports idempotency, I'd reuse the same idempotency key. Otherwise, I'd mark the transaction as pending and use a reconciliation process to determine the final state."
:::

## 8. Master Interview Answer (Put It All Together)

Use this when asked to review the naive transfer code:

:::tip Say this
"First I'd validate that both users exist, the amount is positive, the sender isn't the receiver, and the sender has sufficient balance. The biggest issue is that the current implementation can leave the system inconsistent if one database update succeeds and another fails. I'd make the debit, credit, and transaction-record creation atomic using a database transaction. I'd also handle concurrent transfers using row-level locking or an atomic balance update. Finally, I'd make the transfer API idempotent so retries don't result in duplicate transfers. Notifications should happen asynchronously after the transaction commits, so a notification failure doesn't roll back a successful transfer."
:::

**This is much stronger than "I'll add try-catch."**

## 9. The Fixed Code

One way to write it, with every fix from above in place:

```python
import json
from decimal import Decimal

MAX_TRANSFER = Decimal("100000")

def transfer(sender_id, receiver_id, amount: Decimal, idempotency_key: str):
    # 1. Validate input before touching the database
    if sender_id == receiver_id:
        return {"error": "Cannot transfer to yourself"}
    if amount <= 0 or amount > MAX_TRANSFER:
        return {"error": "Invalid amount"}

    with db.transaction():                       # BEGIN … COMMIT / ROLLBACK
        # 2. Idempotency: a UNIQUE key; a retry returns the first result
        existing = db.query_one(
            "SELECT result FROM idempotency_keys WHERE key = %s", idempotency_key)
        if existing:
            return existing.result

        # 3. Atomic debit: the balance check and the update are one statement
        debited = db.execute(
            "UPDATE accounts SET balance = balance - %s "
            "WHERE id = %s AND balance >= %s AND status = 'ACTIVE'",
            amount, sender_id, amount)
        if debited.rowcount == 0:
            return {"error": "Insufficient balance or inactive account"}

        credited = db.execute(
            "UPDATE accounts SET balance = balance + %s "
            "WHERE id = %s AND status = 'ACTIVE'",
            amount, receiver_id)
        if credited.rowcount == 0:
            raise TransferError("Receiver not found or inactive")   # → ROLLBACK

        # 4. The record is part of the same atomic unit
        tx_id = db.insert(
            "INSERT INTO transactions (sender_id, receiver_id, amount, status) "
            "VALUES (%s, %s, %s, 'SUCCESS') RETURNING id",
            sender_id, receiver_id, amount)

        result = {"status": "success", "transaction_id": tx_id}
        db.execute(
            "INSERT INTO idempotency_keys (key, result) VALUES (%s, %s)",
            idempotency_key, json.dumps(result))       # UNIQUE(key)

        # 5. Notification as an outbox event, committed with the transfer
        db.execute(
            "INSERT INTO outbox (type, payload) VALUES ('TRANSFER_COMPLETED', %s)",
            json.dumps({"transaction_id": tx_id, "receiver_id": receiver_id}))

    return result   # a worker publishes the outbox event and sends the notification
```

If two retries with the same key race each other, both may pass the `SELECT`, but the second one's `INSERT` hits the `UNIQUE` constraint and its whole transaction rolls back — the database, not the `if`, guarantees one transfer.

**What changed:** validation up front; one DB transaction; an atomic conditional debit instead of read-then-write; the idempotency key stored in the same transaction; the notification turned into an outbox event so it can't fail the transfer. `Decimal`, not `float`, for money.

## 10. The Full Learning Escalation

What started as a simple Python question expands into:

```
Validation
    ↓
Concurrency
    ↓
Database transaction
    ↓
Idempotency
    ↓
External service timeout
    ↓
Reconciliation
    ↓
Async processing
```

This is the kind of thinking expected in system design interviews (e.g., Scaler round).

## 11. Next Challenge — HLD

:::info Interviewer asks
"Okay. Now design the HLD for this money-transfer system. Draw the major components and explain the flow."
:::

Give your first HLD attempt (even if rough) — components to think about:

- Transfer API / service
- User/account DB (with row locking)
- Transaction ledger
- Idempotency store (unique keys)
- Message queue / event bus (notifications, async jobs)
- Reconciliation worker (external bank timeouts)
- External payment/bank gateway

Worked HLDs for this: [Digital Wallet](/learn/system-design/problem-breakdowns/digital-wallet) and [Payment System](/learn/system-design/problem-breakdowns/payment-system). The failure cases in depth: [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios).

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Same request retried | Idempotency key |
| Two different requests race | Locking / atomic DB update |
| Debit + credit must stay consistent | DB transaction |
| Notification fails | Async queue/event + retry |
| External API timeout | Reference ID + status query + reconciliation |
