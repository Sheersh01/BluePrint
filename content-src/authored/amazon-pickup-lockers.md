---
title: Amazon Pickup Lockers
seoTitle: Design the Software Behind Amazon Pickup Lockers
description: Design the software for parcel pickup lockers — choosing a locker at checkout, reserving a compartment by size, courier drop-off, pickup codes, offline-capable locker controllers, and expiry returns.
tags: Dealing with Contention, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🔐 What are Pickup Lockers?
Pickup lockers (Amazon Hub Locker, InPost) are banks of compartments in shops and stations where couriers drop parcels and customers collect them with a code. The software chooses a locker at checkout, makes sure a compartment of the right size will be free on the delivery day, lets the courier and customer open the right door, and returns uncollected parcels.
:::

### Functional Requirements

**Core Requirements**

1. At checkout, customers should be able to pick a nearby locker that can take their package on the expected delivery date.
2. Couriers should be able to drop parcels into an assigned compartment.
3. Customers should receive a pickup code and open the compartment with it.
4. Parcels not collected within ~3 days should be flagged for return, freeing the compartment.

**Below the line (out of scope):**

- Returns dropped off by customers (mentioned briefly).
- Locker hardware design and installation.
- Routing couriers.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Never assign two parcels to one compartment at the same time.
2. Lockers must keep working (drop-off and pickup) if their network connection drops.
3. Pickup codes must be secure: unguessable, single-use, valid only for that compartment.
4. Scale to ~50k locker sites, ~5M compartments and millions of parcels per day.
5. Locker selection at checkout in < 300 ms.

**Below the line (out of scope):**

- Real-time video monitoring.

```sketch Locker Requirements
Functional
- pick locker at checkout
- courier drop-off
- pickup with code
- expire + return

Non-functional
- one parcel per compartment
- works offline
- secure single-use codes
- 50k sites, 5M compartments
- selection < 300ms
```

## The Set Up

### Defining the Core Entities

1. **Locker site**: location, hours, compartments, connectivity status.
2. **Compartment**: site, size class (S/M/L), status (`free`, `reserved`, `occupied`, `out_of_service`).
3. **Capacity reservation**: site, size, delivery date, order — a claim on capacity before a specific door is chosen.
4. **Parcel**: order, dimensions, assigned compartment, pickup code hash, deadline.

### API or System Interface

```
GET  /lockers?lat=&lng=&size=M&date=2026-11-14 -> available sites
POST /locker-reservations { siteId, size, date, orderId }
(courier app) POST /sites/:id/dropoffs { parcelId } -> opens a compartment
(locker) POST /sites/:id/pickups { code } -> opens compartment
(locker -> cloud) events: door_opened, parcel_placed, parcel_collected
```

## High-Level Design

### 1) Choosing a locker at checkout

The **Locker Service** finds sites near the customer (geo index), and for each checks **capacity per size class per day**: compartments of that size minus parcels expected to occupy them that day (including parcels still waiting from earlier days). The customer picks one, and a **capacity reservation** is created for the expected delivery date.

### 2) Courier drop-off

When the courier arrives, their app (or the locker's screen after scanning the parcel) asks the site for a compartment. The **locker controller** on site assigns a free compartment of the right size — using the smallest that fits — opens the door, and records `parcel_placed` when the door closes and the sensor detects contents.

```diagram Drop-off and pickup
node courier 0,0 box "Courier App"
node ctrl 1.6,1 box "Locker Controller|local state"
node cloud 3.2,1 box "Locker Service"
node db 4.8,1 circle "Parcels DB"
node cust 0,2 box "Customer"
edge courier -> ctrl "scan parcel"
edge cust -> ctrl "pickup code"
edge ctrl <-> cloud "sync events"
edge cloud <-> db
```

### 3) Pickup codes

Once the parcel is placed, the cloud generates a random **pickup code** (or a QR in the app), sends it to the customer, and pushes the code's **hash** to the locker controller. At the locker, the customer enters the code; the controller checks it locally, opens the door, and marks the code used.

### 4) Expiry

A scheduled job finds parcels past their pickup deadline, sends reminders before that, then flags them for the next courier visit to collect for return. The compartment is freed when the return is picked up.

## Potential Deep Dives

### 1) How do we avoid overbooking a locker?

:::solution bad Assign a specific compartment at checkout
#### Approach

Reserve compartment #12 for the order days in advance.

#### Challenges

Deliveries slip, earlier parcels aren't collected, and compartments sit reserved but empty, wasting capacity.
:::

:::solution good Capacity counting per day
#### Approach

At checkout, reserve **capacity** (one M slot on Thursday) rather than a door, using a conditional increment on a `(site, size, date)` counter. The specific door is chosen at drop-off.

#### Challenges

Uncollected parcels and late deliveries can still leave no free compartment when the courier arrives.
:::

:::solution great Capacity counting with a forecast buffer and overflow
#### Approach

Count capacity per `(site, size, date)` including parcels predicted to still be inside (based on collection-time history), and keep a small **buffer** per site. A parcel that doesn't fit may use a **larger free compartment**. If the locker is still full on arrival, the courier is redirected to the nearest site with space and the customer is notified, or the parcel returns to the delivery station for the next day.

#### Challenges

Forecasts need per-site history; new sites start with conservative buffers.
:::

### 2) How do lockers work offline?

The **locker controller** keeps local state: compartments, expected parcels with their code hashes, and an event queue. Drop-offs and pickups are decided locally, so a network outage doesn't stop either. Events sync to the cloud when connectivity returns, with sequence numbers so nothing is lost or applied twice. Codes generated while the locker is offline can't be pushed, so the app falls back to a **signed QR code** that the controller can verify with a public key without contacting the cloud.

:::tip
Mention the source-of-truth rule: the controller is authoritative for physical door and occupancy state; the cloud is authoritative for orders and codes. Conflicts are resolved by that rule.
:::

### 3) How do we keep codes secure?

Codes are random (not derived from order IDs), single-use, tied to one compartment, and stored only as hashes on the locker. The controller **rate-limits** attempts and locks the keypad after several wrong codes. Couriers authenticate with their own credentials, and every door opening is logged with who opened it.

### Final Design

```diagram Final Design
node shop 0,1 box "Checkout"
node svc 1.5,1 box "Locker Service|selection + capacity"
node geo 1.5,-0.3 circle "Site Geo Index"
node db 3,1 circle "Locker DB"
node sync 4.5,1 box "Device Sync Service"
node ctrl 6,1 box "Locker Controllers|offline-capable"
node notify 3,2.3 box "Notifications|codes + reminders"
node jobs 4.5,2.3 box "Expiry Jobs"
edge shop <-> svc
edge svc <-> geo
edge svc <-> db
edge db <-> sync
edge sync <-> ctrl "codes / events"
edge db -> notify
edge jobs <-> db
```

```quiz
[
  {
    "question": "Why reserve capacity rather than a specific compartment at checkout?",
    "options": ["It's cheaper", "Deliveries and pickups are unpredictable; choosing the door at drop-off uses space better", "Customers prefer it", "Compartments have no IDs"],
    "answer": 1,
    "explanation": "Specific reservations waste compartments when plans change."
  },
  {
    "question": "How do lockers keep working without network access?",
    "options": ["They don't", "A local controller holds state and code hashes and syncs events later", "Customers call support", "Doors stay open"],
    "answer": 1,
    "explanation": "Physical access must not depend on connectivity."
  },
  {
    "question": "Why store only code hashes on the locker?",
    "options": ["Hashes are shorter", "A compromised device doesn't reveal usable codes", "Faster typing", "Required by couriers"],
    "answer": 1,
    "explanation": "The controller can verify a code without storing it in plain text."
  },
  {
    "question": "What happens if the locker is full when the courier arrives?",
    "options": ["Leave the parcel outside", "Use a larger free compartment or redirect to a nearby site and notify the customer", "Cancel the order", "Force a door open"],
    "answer": 1,
    "explanation": "Overflow handling keeps the delivery promise where possible."
  }
]
```
