---
title: Seat Booking
subtitle: A booking function that checks a seat, charges the card, then marks it booked. Two people can pay for the same seat — find out why and fix it.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix a Double-Booking Seat Reservation Function
description: A code-review interview question — a seat booking function with a check-then-act race, payment before reservation, and long locks, and how to fix it with conditional updates and holds.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
Check-then-act races, conditional updates, temporary holds with expiry, never holding a lock across a network call, idempotent payments.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| Two users book the same seat | Check status again right before saving | **Conditional update: `WHERE status = 'AVAILABLE'`** |
| User pays, then the seat turns out to be taken | Refund later | **Reserve (hold) first, pay second** |
| Holding a DB lock while the card is charged | `SELECT … FOR UPDATE` around everything | **Short transaction for the hold; payment outside it** |
| User abandons checkout | Seat stays blocked forever | **Hold with `expires_at`; expired holds count as free** |
| Payment retried after a timeout | Charge again | **Idempotency key = booking id** |

**Mental model (decision tree)**

```
Many users want the same row?
        ↓
  Conditional update (compare-and-set)

Slow external step in the middle?
        ↓
  Hold → external call → confirm  (no lock across the call)

User might never come back?
        ↓
  Hold expires automatically

Money call might be retried?
        ↓
  Idempotency key
```

## 1. The Starting Point

```python
def book_seat(user_id, show_id, seat_id):
    seat = db.query_one(
        "SELECT * FROM seats WHERE show_id = %s AND seat_id = %s", show_id, seat_id)

    if seat.status != "AVAILABLE":
        return {"error": "Seat already taken"}

    charge = payment_gateway.charge(user_id, seat.price)    # ~2 seconds
    if not charge.success:
        return {"error": "Payment failed"}

    db.execute(
        "UPDATE seats SET status = 'BOOKED', user_id = %s "
        "WHERE show_id = %s AND seat_id = %s",
        user_id, show_id, seat_id)

    send_ticket_email(user_id, show_id, seat_id)
    return {"status": "booked"}
```

**Flow**

```
read seat → is it AVAILABLE?
        ↓
charge card (2 s)
        ↓
mark BOOKED
        ↓
send email
```

## 2. What Most Candidates Catch ✅

### 2.1 The Seat Might Not Exist

`seat` can be `None` for a bad `seat_id`, and `seat.status` then crashes. Validate it and return a 404.

### 2.2 The Email Shouldn't Block the Response

Sending the email inline makes booking slower and can fail a booking that already succeeded. Send it asynchronously after the booking is confirmed.

## 3. What Most Candidates Miss ⚠️

### 3.1 Check-Then-Act Race → Double Booking

**Scenario**: Alice and Bob click seat A7 at the same moment.

```
Alice: SELECT → AVAILABLE ✅          Bob: SELECT → AVAILABLE ✅
Alice: charge ₹500 ✅                  Bob: charge ₹500 ✅
Alice: UPDATE → BOOKED (Alice)        Bob: UPDATE → BOOKED (Bob)  ← overwrites Alice
```

Both paid. Bob owns the seat. Alice has a receipt and no seat.

**Fix**: Make "is it free?" and "take it" a single atomic statement — a conditional update.

### 3.2 Charging Before Reserving

Even without a race, the seat can be taken *during* the 2-second charge. Every lost race becomes a refund, a support ticket and an angry customer.

**Fix**: Reserve first (a short **hold**), then charge, then confirm.

### 3.3 The "Obvious" Fix Makes It Worse

Wrapping everything in one transaction with `SELECT … FOR UPDATE` stops the double booking — but now the seat row is **locked for the whole card charge**. A slow gateway holds locks for seconds; a popular show queues hundreds of requests behind one row; connection pools run dry.

**Fix**: Never hold a database lock across a network call. Keep transactions short.

### 3.4 Abandoned Checkouts

If you add holds, a user who closes the tab leaves the seat held forever.

**Fix**: Holds have an `expires_at` (e.g. 10 minutes). An expired hold is treated as available.

### 3.5 Payment Retries

If the charge times out and the code retries, the user can be charged twice.

**Fix**: Pass an idempotency key (the booking/hold id) to the payment gateway.

## 4. Two Users, One Seat

:::info Interviewer asks
"Two users click the same seat at exactly the same time. Walk me through what your code does."
:::

### ⚠️ Common Mistake

"I'll check the status again just before the update." A second check narrows the window but doesn't close it — the two requests can still interleave between the check and the write.

### ✅ Correct Answer — Compare-and-Set in the Database

```sql
UPDATE seats
SET status = 'HELD', held_by = %(user)s, hold_expires_at = now() + interval '10 minutes'
WHERE show_id = %(show)s AND seat_id = %(seat)s
  AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at < now()));
```

The database evaluates the condition and the write as one step. Exactly one request gets `rowcount = 1`; the other gets `0` and is told the seat is taken — before anyone is charged.

:::tip Say this
"I'd turn the check and the write into one conditional update, so the database decides who wins. The loser gets zero rows updated and sees 'seat taken' before paying."
:::

## 5. Why Not One Big Transaction?

:::info Interviewer asks
"Why not just put the whole function in a transaction with SELECT FOR UPDATE?"
:::

Because the payment call sits in the middle. A row lock held for the length of an external HTTP call means:

```
lock seat ──── charge card (2 s … or 30 s if the gateway is slow) ──── unlock
               ↑ every other request for this seat waits here
```

Throughput on hot seats collapses, and a hung gateway can hold locks until timeouts fire.

:::tip Say this
"I keep database transactions short and never hold a lock across a network call. The hold is one quick transaction, the payment happens outside any transaction, and confirming is another quick conditional update."
:::

## 6. The Hold Expires While the User Is Paying

:::info Interviewer asks
"The user's card was charged successfully, but their 10-minute hold expired a second earlier and someone else grabbed the seat. What now?"
:::

Confirm with a condition, and handle the case where it fails:

```sql
UPDATE seats SET status = 'BOOKED'
WHERE show_id = %s AND seat_id = %s AND held_by = %s AND status = 'HELD';
```

If it updates 0 rows, the hold was lost: **refund the charge** (a compensating action) and tell the user. To make this rare, give the payment page a visible countdown and make the hold slightly longer than the payment page's own timeout.

## 7. Master Interview Answer

:::tip Say this
"The core bug is check-then-act: two users can both see the seat as available and both pay. I'd make reserving atomic with a conditional update that only succeeds if the seat is still free, and I'd reserve before charging, as a hold with an expiry so abandoned checkouts free the seat. The payment happens outside any database transaction, with the booking id as an idempotency key, and confirming is another conditional update that checks the hold is still ours — if it isn't, we refund. The ticket email goes out asynchronously after confirmation."
:::

## 8. The Fixed Code

```python
HOLD_MINUTES = 10

def book_seat(user_id, show_id, seat_id):
    booking_id = new_id()

    # 1. Hold: one short, atomic statement decides who gets the seat
    held = db.execute(
        "UPDATE seats SET status = 'HELD', held_by = %s, booking_id = %s, "
        "       hold_expires_at = now() + make_interval(mins => %s) "
        "WHERE show_id = %s AND seat_id = %s "
        "  AND (status = 'AVAILABLE' "
        "       OR (status = 'HELD' AND hold_expires_at < now()))",
        user_id, booking_id, HOLD_MINUTES, show_id, seat_id)
    if held.rowcount == 0:
        return {"error": "Seat is not available"}

    price = db.query_one(
        "SELECT price FROM seats WHERE show_id = %s AND seat_id = %s",
        show_id, seat_id).price

    # 2. Pay outside any transaction; the booking id makes retries safe
    charge = payment_gateway.charge(user_id, price, idempotency_key=booking_id)
    if not charge.success:
        release_hold(show_id, seat_id, booking_id)
        return {"error": "Payment failed"}

    # 3. Confirm only if the hold is still ours
    confirmed = db.execute(
        "UPDATE seats SET status = 'BOOKED' "
        "WHERE show_id = %s AND seat_id = %s AND booking_id = %s AND status = 'HELD'",
        show_id, seat_id, booking_id)
    if confirmed.rowcount == 0:
        payment_gateway.refund(charge.id, idempotency_key=f"refund-{booking_id}")
        return {"error": "Your hold expired — you have been refunded"}

    # 4. Side effects after the booking is safe
    events.publish("BookingConfirmed", {"booking_id": booking_id, "user_id": user_id})
    return {"status": "booked", "booking_id": booking_id}


def release_hold(show_id, seat_id, booking_id):
    db.execute(
        "UPDATE seats SET status = 'AVAILABLE', held_by = NULL, booking_id = NULL "
        "WHERE show_id = %s AND seat_id = %s AND booking_id = %s AND status = 'HELD'",
        show_id, seat_id, booking_id)
```

**What changed:** hold first with a compare-and-set; no lock across the payment; idempotency key on the charge; conditional confirm with a refund path; the email moved to an event.

## 9. The Full Learning Escalation

```
Null checks
    ↓
Check-then-act race
    ↓
Conditional update (compare-and-set)
    ↓
Hold → pay → confirm
    ↓
Hold expiry
    ↓
Idempotent payments + refunds
    ↓
Async side effects
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Now 1 million people try to buy tickets for a concert the moment sales open. Design it."
:::

That's [Ticketmaster](/learn/system-design/problem-breakdowns/ticketmaster) — the same hold-then-confirm idea plus a virtual waiting room and a seat map that updates in real time. See also [Dealing with Contention](/learn/system-design/patterns/dealing-with-contention) and [Flash Sale](/learn/system-design/problem-breakdowns/flash-sale).

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Two users take the same seat | Conditional update / compare-and-set |
| Paid but seat lost | Hold before paying |
| Locks held during payment | Short transactions; no lock across network calls |
| Abandoned checkout | Hold with expiry |
| Hold expired during payment | Conditional confirm + refund |
| Charge retried | Idempotency key |
| Email failure | Async event after confirmation |
