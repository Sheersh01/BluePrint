---
title: Restaurant Booking
seoTitle: Design a Restaurant Booking System like OpenTable
description: Design a restaurant reservation system like OpenTable — table inventory and seating rules, searching availability by party size and time, holding and confirming bookings without double booking, no-shows, and waitlists.
tags: Dealing with Contention, Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🍽️ What is a Restaurant Booking System?
A restaurant booking system (OpenTable, Resy) lets diners find restaurants with a free table for their party size at a given time, and book it instantly. Unlike hotel rooms, restaurant capacity is about **tables and time**: a table for four is free from 7:00 to 8:30, can sometimes be combined with another for a party of six, and turns over several times a night. Restaurants also run their own floor plan and walk-ins through the same system.
:::

### Functional Requirements

**Core Requirements**

1. Diners should search restaurants by location, date, time and party size, and see available time slots.
2. Diners should book a slot, receive confirmation, and modify or cancel it.
3. Restaurants should configure tables, seating rules, turn times and opening hours, and manage walk-ins.
4. Diners should be able to join a waitlist for a full slot and be notified if it opens.
5. No-shows should be tracked, with optional deposits or card guarantees for busy restaurants.

**Below the line (out of scope):**

- Payments for the meal itself.
- Reviews.
- Delivery.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No double booking of a table.
2. Availability search in < 500 ms across many restaurants.
3. Handle "drops" — popular restaurants releasing reservations at a set time draw thousands of simultaneous attempts.
4. Restaurant tablets must keep working with flaky Wi-Fi.
5. Scale to ~50k restaurants and ~1M bookings per day.

**Below the line (out of scope):**

- Perfectly optimal seating assignment.

```sketch Restaurant Booking Requirements
Functional
- search by place, time, party size
- book, modify, cancel
- restaurant tables + rules + walk-ins
- waitlist
- no-shows + deposits

Non-functional
- no double booking
- search < 500ms
- reservation drops
- tablets work offline
- 50k restaurants
```

## The Set Up

### Defining the Core Entities

1. **Restaurant**: location, hours, booking window, policies.
2. **Table**: ID, capacity range (2-4), combinable with which tables, area.
3. **Shift / turn time**: how long a party of a given size typically stays (90 min for 2, 120 min for 6).
4. **Reservation**: restaurant, time, party size, assigned table(s), status, diner.
5. **Waitlist entry**: restaurant, desired time window, party size, diner.

### API or System Interface

```
GET  /availability?lat=&lng=&date=&time=19:00&party=4 -> [{ restaurant, slots: ["18:45","19:15"] }]
POST /reservations/holds { restaurantId, time, party } -> { holdId, expiresAt }
POST /reservations { holdId, diner, cardToken? } -> confirmation
PATCH /reservations/:id { time | party }    DELETE /reservations/:id
POST /waitlist { restaurantId, date, window, party }
```

## High-Level Design

### 1) Modelling availability

For each restaurant, the **Inventory Service** knows tables and existing reservations. A slot (say 19:00 for 4) is available if some table — or allowed combination — fitting 4 people is free from 19:00 to 19:00 + turn time. Computing this for one restaurant is quick in memory.

### 2) Searching across restaurants

Searching thousands of restaurants on demand would be slow, so availability is **precomputed** per restaurant per day per party size into a compact structure (bitmaps of 15-minute slots), updated whenever a booking changes. Search finds nearby restaurants via a geo index and filters by these bitmaps.

```diagram Search and booking
node diner 0,1 box "Diner App"
node search 1.6,-0.3 box "Search Service"
node avail 3.2,-0.3 circle "Availability|bitmaps"
node book 1.6,1 box "Booking Service"
node inv 3.2,1 box "Inventory Service|per restaurant"
node db 4.8,1 circle "Reservations DB"
edge diner <-> search
edge search <-> avail
edge diner <-> book
edge book <-> inv "hold / confirm"
edge inv <-> db
edge inv -> avail "update"
```

### 3) Booking

Booking is two steps: a short **hold** (a few minutes, while the diner confirms details or enters a card), then **confirmation**. The Inventory Service assigns the hold to a specific table using a conditional write; the hold expires automatically if not confirmed.

### 4) Waitlist and no-shows

When a reservation is cancelled, the freed slot is offered to matching **waitlist** entries in order — notify the first, hold the slot for them for a few minutes, then move to the next. For busy restaurants, a **card guarantee** charges a no-show fee; repeated no-shows lower a diner's standing.

## Potential Deep Dives

### 1) How do we prevent double booking?

:::solution bad Check then insert
#### Approach

Check that a table is free, then insert the reservation.

#### Challenges

Two diners booking the last 8 p.m. table at once both succeed.
:::

:::solution good Lock the table for the time range
#### Approach

In a transaction, lock the table's row and check for overlapping reservations before inserting.

#### Challenges

Correct, but table assignment across combinations makes locking complex, and drops create heavy lock contention.
:::

:::solution great Per-restaurant serialised inventory + holds
#### Approach

Treat each restaurant's inventory as a single unit owned by one **partition** (by restaurant ID). Booking requests for a restaurant are processed **sequentially** by that partition's worker (or with a version check on the restaurant's day document), which picks a table and writes the hold — no cross-request races. Holds expire, so abandoned attempts free capacity. A database **exclusion constraint** on `(table, time range)` is the final safety net.

#### Challenges

A single hot restaurant's partition becomes a queue during drops — which is acceptable, since there are only a few dozen tables to hand out anyway.
:::

### 2) How do we handle reservation drops?

When a famous restaurant releases next month's tables at 10:00, thousands of people try at once for perhaps 60 slots. Put a **virtual queue** in front of that restaurant: requests arriving at the drop are ordered (randomised within the first second for fairness) and processed in turn by the restaurant's partition, while others see "checking availability…". Rate-limit per account and detect bots, which are the main cause of unfair drops.

:::tip
Mention that availability shown in search can be slightly stale; the hold step is authoritative, and the UI should handle "just taken" gracefully by suggesting nearby times.
:::

### 3) How do restaurant tablets stay in sync?

Restaurants manage the floor from a tablet app: seating walk-ins, moving parties, marking tables free. The tablet keeps a **local copy** of the day's reservations and floor state, applies changes immediately, and syncs with the server; online bookings arrive as pushes. Conflicts (a walk-in seated at a table just booked online) are surfaced to the host to resolve, since the host's real-world decision wins.

### Final Design

```diagram Final Design
node diner 0,1 box "Diners"
node gw 1.4,1 box "API Gateway|+ drop queues"
node search 2.8,-0.3 box "Search"
node avail 4.2,-0.3 circle "Availability Index"
node book 2.8,1 box "Booking Service"
node inv 4.2,1 box "Inventory Workers|per restaurant"
node db 5.6,1 circle "Reservations DB"
node wait 4.2,2.3 box "Waitlist + Notifications"
node tablet 5.6,2.3 box "Restaurant Tablets"
edge diner <-> gw
edge gw <-> search
edge search <-> avail
edge gw <-> book
edge book <-> inv
edge inv <-> db
edge inv -> avail
edge inv -> wait "slot freed"
edge tablet <-> db "sync"
```

```quiz
[
  {
    "question": "What makes restaurant inventory different from hotel rooms?",
    "options": ["It's simpler", "Tables are booked for short time ranges, turn over, and can be combined for larger parties", "Restaurants have no capacity", "Tables are booked by month"],
    "answer": 1,
    "explanation": "Availability depends on party size, time and turn time."
  },
  {
    "question": "Why precompute availability bitmaps?",
    "options": ["To hide tables", "So search across many restaurants is fast without computing seating on every query", "For payments", "Regulations"],
    "answer": 1,
    "explanation": "Bitmaps make filtering by time and party size cheap."
  },
  {
    "question": "How do we prevent double booking during a drop?",
    "options": ["Show fewer tables", "Process each restaurant's bookings sequentially with holds and a DB constraint as backstop", "Let everyone book and cancel later", "Cache bookings"],
    "answer": 1,
    "explanation": "Serialising per restaurant removes races."
  },
  {
    "question": "What happens when a reservation is cancelled and there's a waitlist?",
    "options": ["Nothing", "The slot is offered to waitlisted diners in order with a short hold", "It's deleted", "The restaurant closes early"],
    "answer": 1,
    "explanation": "Time-limited offers move down the list if not accepted."
  }
]
```
