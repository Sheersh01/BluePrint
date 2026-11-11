---
title: Hotel Booking
seoTitle: Design a Hotel Reservation System Like Booking.com
description: Design a hotel booking system — searching availability by date range, holding rooms during checkout, preventing double booking, and overbooking policies.
tags: Dealing with Contention, Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Amazon, Square, Booking.com | 0
---

## Understanding the Problem

:::definition 🏨 What is a Hotel Booking System?
A hotel booking system (like Booking.com or a hotel chain's site) lets guests search for available rooms by location and dates, reserve one, and pay — while hotels manage their inventory.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to search hotels by location and date range and see available room types with prices.
2. Users should be able to reserve a room type for a date range.
3. Users should be able to cancel a reservation.
4. Hotels should be able to update room inventory and rates.

**Below the line (out of scope):**

- Reviews and loyalty programs.
- Dynamic pricing algorithms.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No double booking — never confirm more rooms than exist (unless overbooking is explicitly allowed).
2. Search is highly available and fast (< 500ms); availability may be slightly stale in search results.
3. Booking is strongly consistent.
4. Scale to 1M+ hotels and peaks of thousands of bookings per second.

**Below the line (out of scope):**

- Channel manager integrations.

```sketch Hotel Booking Requirements
Functional
- search by location + dates
- reserve room type
- cancel
- hotels manage inventory

Non-functional
- no double booking
- fast, available search
- consistent booking
- 1M hotels
```

## The Set Up

### Defining the Core Entities

1. **Hotel**: location, details.
2. **Room type**: e.g. "Deluxe King", with a total count.
3. **Inventory**: per room type **per night** — total and reserved counts.
4. **Reservation**: guest, room type, check-in/out dates, status, price.

:::tip
Guests book a room *type*, not a specific room number. Model inventory as counts per room type per night — room numbers are assigned at check-in.
:::

### API or System Interface

```
GET  /hotels?lat&lng&checkIn&checkOut&guests -> Hotel[] (with available room types)
POST /reservations { "roomTypeId", "checkIn", "checkOut", "idempotencyKey" } -> Reservation (HELD)
POST /reservations/:id/confirm { "paymentToken" } -> Reservation (CONFIRMED)
DELETE /reservations/:id
```

## High-Level Design

### 1) Users should be able to search

Hotel details and locations are indexed in a search engine (geo + filters). Availability for a date range comes from the Inventory table; for search we read a **cached availability summary** that tolerates slight staleness, and we always re-check during booking.

```diagram Search and reserve
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node search 2.5,0.2 box "Search Service"
node es 3.8,0.2 circle "Elasticsearch|+ avail cache"
node res 2.5,1.8 box "Reservation Service"
node db 3.8,1.8 circle "Postgres|inventory"
note 4.3,1.8 "Inventory|- roomTypeId|- date|- total|- reserved"
edge client <-> gw
edge gw <-> search "search"
edge gw <-> res "reserve"
edge search <-> es
edge res <-> db
```

### 2) Users should be able to reserve a room

A stay covers several nights, so a reservation must decrement inventory for **every night** in the range atomically. The Reservation Service does this in one transaction and creates a reservation in `HELD` state with a short expiry while the guest pays.

### 3) Users should be able to cancel

Cancellation marks the reservation cancelled and increments the reserved counts back for each night, in one transaction.

### 4) Hotels should update inventory

Hotel staff update totals and rates; changes write to the Inventory table and invalidate the availability cache for that hotel.

## Potential Deep Dives

### 1) How do we prevent double booking?

:::solution bad Check availability, then insert
#### Approach

Query free rooms for each night, then insert the reservation.

#### Challenges

Concurrent bookings both see the last room free and both succeed.
:::

:::solution good Lock inventory rows for the stay
#### Approach

In a transaction, `SELECT ... FOR UPDATE` the inventory rows for each night (in date order, to avoid deadlocks), verify `reserved < total`, increment, insert the reservation, commit.

#### Challenges

Correct; contention is limited to the same room type and nights, which is usually fine.
:::

:::solution great Conditional updates per night
#### Approach

```
UPDATE inventory SET reserved = reserved + 1
WHERE room_type_id = ? AND date BETWEEN ? AND ? AND reserved < total;
-- succeed only if rows_updated == number_of_nights, else roll back
```

All nights update together or the transaction rolls back. A `CHECK (reserved <= total)` constraint is the final safety net. To allow controlled overbooking, compare against `total * 1.1` instead.

#### Challenges

Must handle the partial-update case by rolling back; idempotency keys stop retries from double-reserving.
:::

### 2) How do we hold a room while the guest pays?

Create the reservation as `HELD` with `expiresAt = now + 10 min`, already counted in `reserved`. Confirming payment flips it to `CONFIRMED`. A scheduled job (or delayed message) releases expired holds by decrementing `reserved`. This avoids holding database locks during user think-time.

### 3) How do we keep search fast without stale bookings?

Search reads a precomputed availability index (per hotel, room type and date) that is updated asynchronously from inventory changes via change data capture. Small staleness in search is acceptable; the booking path always checks the source of truth and returns a clear "just sold out" message if needed.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node gw 1.2,1.2 box "API Gateway"
node search 2.5,0.2 box "Search Service"
node es 3.8,0.2 circle "Search Index|+ availability"
node res 2.5,1.2 box "Reservation Service|- conditional updates|- holds"
node pay 2.5,2.4 box "Payment Service"
node db 3.8,1.6 circle "Postgres|inventory"
node expire 5,1.6 box "Hold Expiry Job"
edge client <-> gw
edge gw <-> search
edge gw <-> res
edge res <-> pay
edge search <-> es
edge res <-> db
edge db -> es "CDC"
edge expire <-> db
```

```quiz
[
  {
    "question": "Why model inventory per room type per night?",
    "options": ["It's easier to display", "Guests book types for date ranges; each night's availability is independent", "Room numbers are secret", "To reduce rows"],
    "answer": 1,
    "explanation": "Counting per night lets multi-night stays check every night."
  },
  {
    "question": "How do you make a 3-night reservation atomic?",
    "options": ["Reserve each night separately without a transaction", "Update all three nights in one transaction and roll back unless all succeed", "Reserve only the first night", "Use the cache"],
    "answer": 1,
    "explanation": "Either every night is reserved or none is."
  },
  {
    "question": "Why use a HELD reservation with an expiry during payment?",
    "options": ["To charge twice", "To reserve inventory without holding database locks during user think-time", "To skip payment", "For search"],
    "answer": 1,
    "explanation": "Expired holds are released by a background job."
  },
  {
    "question": "Why can search show slightly stale availability?",
    "options": ["Users don't care", "Booking always re-checks the source of truth", "Search is never cached", "Inventory never changes"],
    "answer": 1,
    "explanation": "Staleness in search is safe because the booking path is consistent."
  }
]
```
