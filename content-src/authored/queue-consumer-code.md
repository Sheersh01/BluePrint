---
title: Order Event Consumer
subtitle: A queue worker that records orders and awards loyalty points. It loses orders on crashes and double-awards points on retries.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix a Message Queue Consumer
description: A code-review interview question — a Python queue consumer that acknowledges too early, isn't idempotent, mixes database writes with an external call and swallows errors, and how to fix it.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
When to acknowledge, at-least-once delivery, idempotent consumers, transactions, side effects outside the transaction, poison messages and dead-letter queues.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| Message lost if the worker crashes | Add more replicas | **Acknowledge after the work is committed** |
| Redelivered message processed twice | Hope it doesn't happen | **Idempotent consumer: processed-message table, same transaction** |
| Order saved but points not | try/except | **One DB transaction for both writes** |
| Email call fails after DB writes | Retry the whole handler | **Outbox / separate consumer for side effects** |
| One bad message fails forever | Infinite retries | **Retry limit → dead-letter queue** |
| Errors printed and forgotten | `print` | **Structured logs, metrics, alerts on DLQ size** |

**Mental model (decision tree)**

```
When do I ack?
        ↓
  After commit (at-least-once)

At-least-once means duplicates?
        ↓
  Idempotent processing (dedupe key in the same transaction)

Several writes must agree?
        ↓
  One DB transaction

External call in the handler?
        ↓
  Move it out (outbox / its own consumer)

Message keeps failing?
        ↓
  Retry N times → DLQ
```

## 1. The Starting Point

```python
import json
import requests

def handle_message(msg):
    queue.ack(msg)                                   # done with it
    order = json.loads(msg.body)

    db.execute("INSERT INTO orders (id, user_id, total) VALUES (%s, %s, %s)",
               order["id"], order["user_id"], order["total"])
    db.execute("UPDATE users SET points = points + %s WHERE id = %s",
               int(order["total"] // 10), order["user_id"])

    requests.post("https://email.example.com/send",
                  json={"to": order["email"], "template": "order_confirmed"})


while True:
    msg = queue.receive()
    try:
        handle_message(msg)
    except Exception as e:
        print("error", e)
```

## 2. What Most Candidates Catch ✅

### 2.1 Errors Are Just Printed

`print("error", e)` goes nowhere useful in production: no alert, no metric, no message id to trace.

**Fix**: Structured logging with the message id, a failure metric, and alerts.

### 2.2 The Email Call Has No Timeout

`requests.post` with no timeout can hang the worker forever, which stops the whole consumer.

## 3. What Most Candidates Miss ⚠️

### 3.1 Acknowledging First Loses Messages

```
ack ✅ → INSERT order → worker crashes ❌
→ the broker thinks it's done; the order never existed
```

**Fix**: Acknowledge only **after** the work is committed. That makes delivery at-least-once: a crash before the ack means the message is redelivered.

### 3.2 At-Least-Once Means Duplicates

Once you ack after the work, a crash between commit and ack redelivers the message:

```
INSERT order ✅ → UPDATE points ✅ → crash before ack ❌
→ redelivered → INSERT fails (duplicate id) … or worse, points are added twice
```

**Fix**: An idempotent consumer — record the message (or order) id in a `processed_messages` table with a unique key, in the **same transaction** as the writes. If it's already there, skip.

### 3.3 Two Writes, No Transaction

If the points update fails after the order insert, you have an order with no points — and a retry will hit the duplicate order id.

**Fix**: Both writes (plus the dedupe record) in one transaction.

### 3.4 An External Call Inside the Handler

If the email service is down, the handler fails *after* the database writes. On retry, the writes happen again (without idempotency) — so a flaky email provider double-awards points.

**Fix**: Don't make a third party part of the unit of work. Write an outbox row ("send confirmation email") in the same transaction; a separate worker sends it, with its own retries.

### 3.5 Poison Messages

A malformed message (`json.loads` fails, a missing field) fails every time. Depending on the broker, it's either retried forever — blocking or burning capacity — or (here, because of the early ack) silently dropped.

**Fix**: Validate the payload; after N failed attempts move the message to a **dead-letter queue** and alert.

### 3.6 Money as a Float

`order["total"]` arrives as a JSON number and is used as a float. `0.1 + 0.2 != 0.3` — fine for points maybe, not for totals.

**Fix**: Send money as a string or integer minor units; use `Decimal`.

## 4. When to Acknowledge

:::info Interviewer asks
"Your worker crashes halfway through a message. What happens to that order?"
:::

### ⚠️ Common Mistake

"Ack early so the message isn't processed twice." That trades duplicates for **data loss** — and losing an order is far worse.

### ✅ Correct Answer

Ack after the database transaction commits. Accept that duplicates will happen and make processing idempotent.

:::tip Say this
"I'd acknowledge only after the work is committed, which gives at-least-once delivery — nothing is lost if the worker crashes. Then I'd make the handler idempotent by recording the message id in the same transaction, so a redelivered message is skipped."
:::

## 5. Exactly-Once?

:::info Interviewer asks
"Can't we just use exactly-once delivery?"
:::

Brokers can't guarantee that your *side effects* happen exactly once — a crash between "work done" and "ack" always exists somewhere. In practice "exactly once" means **at-least-once delivery + idempotent processing**. Kafka's exactly-once transactions cover reads and writes *within Kafka*, not your database or an email API.

## 6. The Email Provider Is Down

:::info Interviewer asks
"The email provider is down for an hour. What happens to orders?"
:::

With the original code, every message fails after its DB writes, and retries repeat them. With the fix, orders and points commit normally; the outbox accumulates email jobs, and the email worker retries them with backoff until the provider is back. Orders never depend on email.

## 7. Master Interview Answer

:::tip Say this
"It acks before doing the work, so a crash loses the order. Once you ack after the work, delivery is at-least-once, so the handler has to be idempotent — and it isn't: a redelivery double-awards points. The two writes aren't in a transaction, the email call sits inside the unit of work with no timeout, so a flaky provider causes partial failures and duplicate writes on retry, and errors are only printed. I'd ack after commit, put the order insert, the points update and a processed-message record in one transaction, move the email to an outbox handled by its own worker, validate messages and send repeated failures to a dead-letter queue, and use Decimal for money."
:::

## 8. The Fixed Code

```python
import json
import logging
from decimal import Decimal

log = logging.getLogger("order-consumer")
MAX_ATTEMPTS = 5

def handle_message(msg):
    order = parse_order(msg.body)       # raises InvalidMessage if malformed

    with db.transaction():
        # Idempotency: the message id is UNIQUE; a duplicate means "already done"
        inserted = db.execute(
            "INSERT INTO processed_messages (message_id) VALUES (%s) "
            "ON CONFLICT DO NOTHING", msg.id)
        if inserted.rowcount == 0:
            return                                    # redelivery — nothing to do

        db.execute(
            "INSERT INTO orders (id, user_id, total) VALUES (%s, %s, %s)",
            order.id, order.user_id, order.total)
        db.execute(
            "UPDATE users SET points = points + %s WHERE id = %s",
            int(order.total // 10), order.user_id)

        # Side effect recorded, not performed — a separate worker sends it
        db.execute(
            "INSERT INTO outbox (type, payload) VALUES ('ORDER_CONFIRMED_EMAIL', %s)",
            json.dumps({"order_id": order.id, "email": order.email}))


def parse_order(body):
    data = json.loads(body)
    return Order(id=data["id"], user_id=data["user_id"],
                 total=Decimal(str(data["total"])), email=data["email"])


def run():
    while True:
        msg = queue.receive()
        try:
            handle_message(msg)
            queue.ack(msg)                            # only after commit
        except InvalidMessage:
            log.error("invalid message", extra={"message_id": msg.id})
            queue.dead_letter(msg)                    # never going to succeed
        except Exception:
            log.exception("processing failed", extra={"message_id": msg.id})
            if msg.delivery_count >= MAX_ATTEMPTS:
                queue.dead_letter(msg)                # alert on DLQ depth
            else:
                queue.nack(msg, delay_s=2 ** msg.delivery_count)   # backoff
```

**What changed:** ack after commit; a processed-messages table for idempotency in the same transaction; both writes in one transaction; the email moved to an outbox; validation, retries with backoff and a dead-letter queue; structured logs; `Decimal` for money.

## 9. The Full Learning Escalation

```
Logging
    ↓
Ack timing (lost vs duplicated)
    ↓
Idempotent consumers
    ↓
Transactions
    ↓
Side effects via outbox
    ↓
Poison messages / DLQ
    ↓
Ordering & scaling consumers
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design the pipeline that processes every order event for the whole store — in order per order, without losing or duplicating any."
:::

See [Order Event Processing](/learn/system-design/problem-breakdowns/order-event-processing), [Queue & Messaging Failures](/learn/system-design/tips/messaging-failure-scenarios) and [Message Queue](/learn/system-design/problem-breakdowns/message-queue).

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Lost on crash | Ack after commit |
| Duplicates on redelivery | Processed-message table (UNIQUE) in the same transaction |
| Partial writes | One DB transaction |
| External call in the handler | Outbox + separate worker |
| Poison message | Validate; retry limit → DLQ |
| Silent failures | Structured logs, metrics, DLQ alerts |
| Float money | Decimal / minor units |
