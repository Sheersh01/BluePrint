---
title: Parking Payment
seoTitle: Design a Parking Payment System like ParkMobile
description: Design a city parking payment system — zone-based rates, starting and extending sessions from a phone, enforcement lookups by licence plate, garages with gate cameras, and handling offline meters.
tags: Dealing with Contention, Real-time Updates
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🅿️ What is a Parking Payment System?
A parking payment system (ParkMobile, PayByPhone, or a city's own app) lets drivers pay for street parking or garages from their phone instead of a meter. Drivers pick a zone, enter their plate and duration, and can extend remotely. Enforcement officers check whether a plate has paid. Garages may also use cameras that read plates at the entry and exit gates.
:::

### Functional Requirements

**Core Requirements**

1. Drivers should be able to start a parking session for a zone, plate and duration, and pay.
2. Drivers should be reminded before expiry and be able to extend (up to the zone's maximum).
3. Enforcement officers should check whether a plate has a valid session in a zone.
4. Garages should support pay-on-exit: entry and exit by plate recognition, charged by time spent.

**Below the line (out of scope):**

- Permit and residential parking management.
- Dynamic pricing (mentioned briefly).
- Issuing and paying fines.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Starting or extending a session takes a few seconds, even on poor mobile connections.
2. Enforcement lookups return in < 500 ms and must be accurate — a wrongful ticket is a serious failure.
3. Payments are charged exactly once per session or extension.
4. Garage gates must open even if the cloud is briefly unreachable.
5. Scale to a large city: ~1M sessions per day, with busy weekday-morning peaks.

**Below the line (out of scope):**

- Global multi-currency operation.

```sketch Parking Requirements
Functional
- start session: zone, plate, duration
- reminders + extend
- enforcement plate lookup
- garage pay-on-exit

Non-functional
- fast on poor connections
- accurate lookups < 500ms
- charge exactly once
- gates work offline
- 1M sessions / day
```

## The Set Up

### Defining the Core Entities

1. **Zone**: ID, geometry, rate schedule (by time of day), maximum stay.
2. **Vehicle**: plate number and region, owner account.
3. **Session**: zone, plate, start, end, amount, payment status.
4. **Garage visit**: garage, plate, entry time, exit time, amount.

### API or System Interface

```
GET  /zones?lat=&lng= -> nearby zones + current rate
POST /sessions { zoneId, plate, minutes, paymentMethodId, idempotencyKey } -> session
POST /sessions/:id/extend { minutes, idempotencyKey }
GET  /enforcement/check?zone=&plate= -> { valid, expiresAt }
(garage) POST /garages/:id/entries { plate, ts }   POST /garages/:id/exits { plate, ts }
```

## High-Level Design

### 1) Starting a session

The app finds the zone from GPS (or a zone number on the sign), shows the rate, and posts the session. The **Session Service** computes the price from the zone's **rate schedule**, charges the card (using the idempotency key), and stores the session. Session state is the source of truth for enforcement.

### 2) Reminders and extensions

A **scheduler** queues a reminder 10-15 minutes before each session ends (a delayed message or a time-indexed table scanned each minute). Extending checks the zone's maximum stay, charges the difference, and updates `end` in a transaction.

### 3) Enforcement lookups

Officers' handheld devices (or patrol cars with plate cameras) query by **zone and plate**. Active sessions are kept in a fast store keyed by `(zoneId, normalisedPlate)` with a TTL equal to the session end, so a lookup is a single key read.

```diagram Sessions and enforcement
node app 0,1 box "Driver App"
node svc 1.6,1 box "Session Service"
node db 3.2,1 circle "Sessions DB"
node active 3.2,-0.3 circle "Active Sessions|zone + plate"
node officer 4.8,-0.3 box "Enforcement Device"
node pay 1.6,2.3 box "Payment Processor"
edge app <-> svc
edge svc <-> db
edge svc -> active
edge officer <-> active "check plate"
edge svc <-> pay
```

### 4) Garages

Gate cameras read plates (**ALPR**) at entry and exit. A **garage controller** on site records the entry, opens the gate, and on exit computes the fee and charges the account linked to the plate (or prompts for payment at a kiosk).

## Potential Deep Dives

### 1) How do we make enforcement accurate?

:::solution bad Query the main database by plate
#### Approach

Officers' lookups query the sessions table with a time-range filter.

#### Challenges

Slow under load, and plates are entered inconsistently ("AB 123", "AB-123", "A8123") leading to false negatives — and wrongful tickets.
:::

:::solution good Normalised plates in a key-value store
#### Approach

Normalise plates (uppercase, strip spaces and dashes) on write and read, and keep active sessions in a key-value store with TTLs.

#### Challenges

Camera reads still confuse similar characters (O/0, B/8, I/1).
:::

:::solution great Normalised + fuzzy match + grace periods
#### Approach

Store a **canonical form** that maps easily confused characters to the same symbol for lookups, and return near matches for the officer to confirm visually. Apply a short **grace period** after expiry, and record the lookup result with a timestamp so disputes can be resolved. If the officer's device is offline, it syncs a **zone snapshot** of active sessions before each patrol and refreshes when connected.

#### Challenges

Fuzzy matches increase false positives slightly, so they require human confirmation.
:::

### 2) How do we keep garage gates working when the network drops?

The on-site **garage controller** keeps a local database of entries and a cached list of registered plates with valid payment methods. Gates open based on local decisions; events queue locally and sync to the cloud when connectivity returns, where charges are processed idempotently by visit ID.

:::tip
Call out that edge autonomy is essential wherever physical access is involved: a car stuck at an exit gate because of a cloud outage is a real-world failure.
:::

### 3) How do we handle weekday-morning peaks?

Most sessions start between 7 and 10 a.m. The session API is stateless and autoscaled; payment calls are the slowest part, so the app shows the session as **pending** and confirms within seconds. Enforcement data is written to the active-session store as soon as payment is authorised, so a driver who just paid is never ticketed.

### Final Design

```diagram Final Design
node app 0,1 box "Driver App"
node gw 1.4,1 box "API Gateway"
node svc 2.8,1 box "Session Service|rates · extend"
node db 4.2,1 circle "Sessions DB"
node active 4.2,-0.3 circle "Active Sessions"
node officer 5.6,-0.3 box "Enforcement"
node sched 2.8,-0.3 box "Reminder Scheduler"
node pay 2.8,2.3 box "Payments"
node garage 5.6,2.3 box "Garage Controllers|local + sync"
edge app <-> gw
edge gw <-> svc
edge svc <-> db
edge svc -> active
edge officer <-> active
edge svc -> sched
edge sched -> app "reminders"
edge svc <-> pay
edge garage <-> db "sync visits"
```

```quiz
[
  {
    "question": "Why normalise licence plates?",
    "options": ["To save space", "So inconsistently typed plates still match during enforcement", "For encryption", "To support colours"],
    "answer": 1,
    "explanation": "A missed match can produce a wrongful ticket."
  },
  {
    "question": "Where should active sessions live for enforcement?",
    "options": ["Only in the main SQL table", "In a key-value store keyed by zone and plate with TTLs", "On the driver's phone", "In email"],
    "answer": 1,
    "explanation": "Single-key lookups are fast and expire automatically."
  },
  {
    "question": "Why does a garage controller make gate decisions locally?",
    "options": ["It's cheaper", "Gates must keep working when the cloud is unreachable", "To avoid payment", "Cameras require it"],
    "answer": 1,
    "explanation": "Edge autonomy keeps physical access working."
  },
  {
    "question": "What prevents an extension being charged twice on retry?",
    "options": ["Longer timeouts", "An idempotency key per extension request", "Rate limiting", "Manual review"],
    "answer": 1,
    "explanation": "Retries return the original result."
  }
]
```
