---
title: Parking Lot
seoTitle: Design a Parking Lot Management System
description: Design a parking lot management system — spot types and allocation, entry and exit gates, tickets and fees, live occupancy display, multi-level garages, and keeping counts correct with concurrent gates.
tags: Dealing with Contention
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🚙 What is a Parking Lot Management System?
A parking lot system runs a multi-level garage: it issues a ticket (or reads the plate) when a vehicle enters, guides it to a suitable spot, shows how many spots are free on each level, and charges the right fee on exit. It's a classic interview question that can be asked as **object-oriented design** (classes and responsibilities) or as a small **distributed system** (many gates, one source of truth). This breakdown covers both.
:::

### Functional Requirements

**Core Requirements**

1. Vehicles of different types (motorcycle, car, van, EV) enter through one of several gates and get a ticket.
2. The system assigns a suitable spot (compact, regular, large, EV charging, accessible).
3. Displays show free spots per level and type in real time.
4. On exit, the system computes the fee from duration and rates, takes payment, and opens the gate.
5. The lot should never admit a vehicle when no suitable spot is free.

**Below the line (out of scope):**

- Monthly permits and reservations (mentioned briefly).
- City street parking (see Parking Payment).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Gates respond in < 1 second; queues at entry are unacceptable.
2. Spot counts are correct even with several gates operating at once.
3. The lot works if the internet connection or central servers are down.
4. Fees are calculated correctly and every transaction is auditable.

**Below the line (out of scope):**

- Scale beyond a single site (a chain is many independent sites).

```sketch Parking Lot Requirements
Functional
- entry ticket per vehicle type
- assign suitable spot
- live free-spot displays
- fee + payment at exit
- never admit when full

Non-functional
- gates < 1s
- correct counts, concurrent gates
- works offline
- correct, auditable fees
```

## The Set Up

### Defining the Core Entities

1. **ParkingLot**: levels, gates, rate card.
2. **Level**: spots, display board.
3. **Spot**: ID, type, level, status (free, occupied, out of service).
4. **Vehicle**: plate, type.
5. **Ticket**: ID, vehicle, spot, entry time, exit time, fee, payment status.
6. **RateCard**: pricing rules (first hour, hourly, daily cap, by vehicle type).

In object-oriented terms: `ParkingLot` owns `Level`s and `Gate`s; `Level` owns `Spot`s; a `SpotAllocator` strategy chooses spots; a `FeeCalculator` applies the `RateCard`; `EntryGate` and `ExitGate` coordinate them.

### API or System Interface

```
POST /entries { gateId, plate, vehicleType } -> { ticketId, spotId, level } | { full: true }
POST /exits { gateId, ticketId | plate } -> { fee }
POST /payments { ticketId, amount, method }
GET  /levels/:id/availability -> { compact: 12, regular: 40, ev: 3 }
(spot sensors) POST /spots/:id/occupancy { occupied }
```

## High-Level Design

### 1) Entry and spot assignment

The entry gate reads the plate (camera) or takes the vehicle type, asks the **Lot Controller** for a spot, prints a ticket and opens the barrier. The allocator picks the **smallest suitable spot**, preferring levels near the entrance, and marks it reserved for that ticket.

### 2) Live availability

Counts per level and type are updated on every assignment and release, and pushed to **display boards** at the entrance and each level. Optional **spot sensors** confirm actual occupancy, catching drivers who park somewhere other than their assigned spot.

```diagram Gates and controller
node entry 0,0 box "Entry Gates"
node exit 0,2 box "Exit Gates"
node ctrl 1.6,1 box "Lot Controller|allocator + fees"
node db 3.2,1 circle "Local DB|spots + tickets"
node boards 3.2,-0.3 box "Display Boards"
node sensors 3.2,2.3 box "Spot Sensors"
edge entry <-> ctrl
edge exit <-> ctrl
edge ctrl <-> db
edge ctrl -> boards
edge sensors -> ctrl
```

### 3) Exit and payment

At exit, the ticket or plate is read; the **FeeCalculator** applies the rate card to the duration (with daily caps and grace periods), the driver pays at the gate or a pay station, the ticket is closed, the spot freed and the barrier opens.

## Potential Deep Dives

### 1) How do we keep counts correct with several gates?

:::solution bad Each gate keeps its own count
#### Approach

Every gate tracks free spots locally.

#### Challenges

Two gates admit the last car each; counts drift apart.
:::

:::solution good Central controller with a lock
#### Approach

Gates ask a single controller, which assigns spots under a lock or database transaction.

#### Challenges

Correct, but if the controller is down, no gate can admit anyone.
:::

:::solution great Atomic spot assignment + local high availability
#### Approach

The controller assigns spots with an **atomic conditional update** (`UPDATE spots SET status='reserved', ticket=? WHERE id=? AND status='free'`), so concurrent gates never get the same spot, and counts are derived from spot states. The controller runs as a **primary/standby pair on site** (not in the cloud), so internet outages don't matter. If both fail, gates fall back to **ticket-only mode** (issuing tickets without spot assignment) while the display shows a conservative count, and reconcile afterwards.

#### Challenges

Fallback mode needs a safety margin so the lot doesn't overfill.
:::

### 2) How should the allocator choose spots?

Use a **strategy** interface so the policy can change: smallest suitable spot (keeps large spots for large vehicles), nearest to the entrance or lifts, EV spots only for EVs while others are available, accessible spots only on request. Keep per-type **free lists** (e.g. a priority queue per level ordered by distance) so allocation is O(log n) instead of scanning every spot.

:::tip
In an object-oriented interview, show extensibility: adding a new vehicle type or pricing rule should mean adding a class or config entry, not editing every `if` statement.
:::

### 3) How do we calculate fees correctly?

The `FeeCalculator` takes the ticket times and the rate card and returns an itemised fee. Rules are data (first hour, each extra hour rounded up, daily maximum, overnight rates, lost-ticket fee), not hard-coded. Times come from the controller's clock, not the gate, to avoid clock skew. Every calculation and payment is stored with the ticket for audits and disputes.

### Final Design

```diagram Final Design
node entry 0,0 box "Entry Gates|ALPR + ticket"
node exit 0,2 box "Exit Gates|pay + barrier"
node ctrl 1.6,1 box "Lot Controller|primary + standby"
node alloc 3.2,0 box "Spot Allocator|free lists per type"
node fee 3.2,2 box "Fee Calculator|rate card"
node db 4.8,1 circle "Spots + Tickets"
node boards 4.8,-0.3 box "Displays"
node cloud 4.8,2.3 box "Cloud Sync|reports"
edge entry <-> ctrl
edge exit <-> ctrl
edge ctrl <-> alloc
edge ctrl <-> fee
edge ctrl <-> db
edge db -> boards
edge db -> cloud "async"
```

```quiz
[
  {
    "question": "How do we stop two gates assigning the same spot?",
    "options": ["Each gate counts separately", "An atomic conditional update that only claims a free spot", "Drivers choose", "Display boards"],
    "answer": 1,
    "explanation": "Only one assignment can succeed for each spot."
  },
  {
    "question": "Why run the lot controller on site?",
    "options": ["It's cheaper", "So gates keep working when the internet is down", "Cloud servers can't count", "For security cameras"],
    "answer": 1,
    "explanation": "Physical operations must not depend on connectivity."
  },
  {
    "question": "Why allocate the smallest suitable spot?",
    "options": ["Drivers prefer it", "To keep larger spots free for vehicles that need them", "It's random", "It's closer"],
    "answer": 1,
    "explanation": "It maximises the number of vehicles the lot can hold."
  },
  {
    "question": "Where should pricing rules live?",
    "options": ["Hard-coded in gate firmware", "In a configurable rate card applied by a fee calculator", "On the ticket", "In the display board"],
    "answer": 1,
    "explanation": "Data-driven rules can change without code changes."
  }
]
```
