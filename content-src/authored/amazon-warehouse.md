---
title: Amazon Warehouse
seoTitle: Design an Amazon Warehouse (Fulfilment Centre) Management System
description: Design the software that runs a fulfilment centre — receiving and stowing inventory, batching orders into pick waves, directing pickers or robots, packing and shipping by cutoff times, and staying correct when scans go wrong.
tags: Dealing with Contention, Multi-step Processes, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🏭 What is a Warehouse Management System?
A warehouse management system (WMS) runs a fulfilment centre: it tells workers and robots where to put arriving stock, which items to pick for which orders, in what order, and how to pack and ship them before the carrier truck leaves. Amazon's centres hold millions of items in randomised ("chaotic") storage and ship hundreds of thousands of orders a day.
:::

### Functional Requirements

**Core Requirements**

1. Receive inbound shipments and direct workers to **stow** items into storage bins.
2. Accept customer orders and plan **picks**: which bin each item comes from.
3. Direct pickers (or robots) along efficient paths and confirm each pick by scanning.
4. Pack orders, label them and sort them to the right outbound truck before its cutoff time.
5. Keep bin-level inventory accurate.

**Below the line (out of scope):**

- Network-level decisions about which warehouse fulfils an order.
- Labour scheduling and payroll.
- Robot motion planning internals.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Meet carrier cutoffs: orders must be shipped on time — this drives prioritisation.
2. Scan-to-instruction latency < 300 ms on handheld devices, so workers never wait.
3. Inventory accuracy: picks must never be sent to an empty bin.
4. The warehouse must keep operating if the link to central cloud services fails.
5. Scale to ~500k items picked per day per site, thousands of devices.

**Below the line (out of scope):**

- Cross-warehouse consistency (each site is largely independent).

```sketch Warehouse Requirements
Functional
- receive + stow
- plan picks
- direct pickers / robots
- pack + ship by cutoff
- bin-level inventory

Non-functional
- meet carrier cutoffs
- scan -> next task < 300ms
- no picks to empty bins
- keep running if cloud link fails
- 500k picks / day per site
```

## The Set Up

### Defining the Core Entities

1. **Bin**: location in the building (zone, aisle, shelf), capacity, contents.
2. **Inventory record**: SKU, bin, quantity, and quantity allocated to picks.
3. **Order / shipment**: items, ship-by time, carrier, priority.
4. **Task**: a unit of work for a worker or robot — stow, pick, pack, count — with status.
5. **Wave / batch**: a group of picks released together.

### API or System Interface

```
(handheld) POST /scans { deviceId, barcode, context } -> nextInstruction
GET  /tasks/next?worker=&zone=
POST /tasks/:id/complete { scannedBin, scannedItem, qty }
POST /tasks/:id/exception { type: empty_bin|damaged|wrong_item }
(cloud) orders in; shipment confirmations out
```

## High-Level Design

### 1) Receiving and stowing

Inbound items are scanned at the dock. The WMS suggests a **bin** for each item using rules: free space, item size, and **chaotic storage** (spreading copies of a SKU across many bins near pickers rather than one big location). The worker scans the bin when stowing, and inventory is updated.

### 2) Planning picks

Orders arrive from the cloud order system. A **wave planner** runs every few minutes: it groups orders by carrier cutoff and zone, chooses a bin for each item (nearest bin with unallocated stock), and creates pick **tasks**, allocating that inventory so two pickers aren't sent for the same unit.

```diagram Planning and picking
node orders 0,1 box "Cloud Orders"
node planner 1.6,1 box "Wave Planner|cutoff priority"
node inv 3.2,-0.3 circle "Bin Inventory"
node tasks 3.2,1 box "Task Service"
node hand 4.8,1 box "Handhelds / Robots"
edge orders -> planner
edge planner <-> inv "allocate"
edge planner -> tasks "pick tasks"
edge tasks <-> hand "next task / scan"
```

### 3) Directing pickers

Each picker's handheld asks for the next task; the **Task Service** gives them a pick path through their zone (sorted to minimise walking), and each pick is confirmed by **scanning** the bin and item. In robotic sites, robots bring shelves to stationary pickers instead.

### 4) Packing and shipping

Picked items go to packing, where the system recommends a box size and prints a label. Packages are sorted to the outbound door for their carrier and confirmed when loaded, which sends a **shipment confirmation** to the cloud.

## Potential Deep Dives

### 1) How do we keep bin inventory accurate?

:::solution bad Trust the system count
#### Approach

Assume quantities are right and send pickers wherever the system says stock exists.

#### Challenges

Mis-stows, damage and theft mean pickers regularly find empty bins, delaying orders.
:::

:::solution good Scan everything
#### Approach

Require scans of both bin and item at every stow and pick, rejecting mismatches immediately.

#### Challenges

Errors still accumulate, and an "empty bin" exception blocks the order until someone investigates.
:::

:::solution great Scans + exception workflows + continuous counting
#### Approach

Scan-verify every movement, and when a picker reports an **empty or short bin**, immediately **re-allocate** the item to another bin and create a **count task** for the problem bin. Run **cycle counts** continuously, targeting bins with recent exceptions or high value. Inventory changes are written as an **append-only movement log** per bin, so discrepancies can be traced.

#### Challenges

Count tasks consume labour, so prioritise them by expected impact.
:::

### 2) How do we prioritise work to meet cutoffs?

Each order has a **ship-by time** derived from its carrier truck's departure. The wave planner releases work in priority order (earliest cutoff first), balancing zones so no area is overloaded. A dashboard tracks **at-risk orders**: work remaining versus time to cutoff, and supervisors move labour accordingly. Late-arriving urgent orders can be inserted into active waves.

:::tip
Point out the trade-off between big waves (efficient walking routes) and small, continuous releases (faster reaction to new orders and cutoffs).
:::

### 3) How do we keep working when the cloud link drops?

The WMS runs **on site**: a local cluster with the site's database, task service and device gateway. Orders and inventory needed for the next hours are already local, so picking and packing continue during an outage. Shipment confirmations and inventory events queue locally and sync when the link returns. Handheld devices talk to local servers over Wi-Fi for fast responses.

### Final Design

```diagram Final Design
node cloud 0,1 box "Cloud Order System"
node sync 1.5,1 box "Site Sync|queues both ways"
node planner 3,-0.3 box "Wave Planner"
node db 3,1 circle "Site DB|bins · movements"
node tasks 4.5,1 box "Task Service"
node gw 6,1 box "Device Gateway"
node devices 7.5,1 box "Handhelds + Robots"
node pack 4.5,2.3 box "Pack + Sort"
node counts 3,2.3 box "Cycle Count Planner"
edge cloud <-> sync
edge sync <-> db
edge planner <-> db
edge planner -> tasks
edge tasks <-> db
edge tasks <-> gw
edge gw <-> devices
edge tasks -> pack
edge counts <-> db
```

```quiz
[
  {
    "question": "What is chaotic storage?",
    "options": ["Random mess", "Spreading copies of a SKU across many bins wherever space allows, tracked precisely by the system", "Storing by colour", "No storage system"],
    "answer": 1,
    "explanation": "It increases space use and puts items near more pickers."
  },
  {
    "question": "Why allocate inventory when creating pick tasks?",
    "options": ["For billing", "So two pickers aren't sent for the same unit", "To reduce scans", "Regulations"],
    "answer": 1,
    "explanation": "Allocation reserves specific units for specific tasks."
  },
  {
    "question": "What happens when a picker reports an empty bin?",
    "options": ["The order is cancelled", "The item is re-allocated to another bin and a count task is created", "Nothing", "The picker searches the building"],
    "answer": 1,
    "explanation": "The order keeps moving while the discrepancy is investigated."
  },
  {
    "question": "Why does the WMS run on site?",
    "options": ["Cheaper licences", "So the warehouse keeps working if the cloud link fails, with fast device responses", "Security theatre", "Robots can't use the internet"],
    "answer": 1,
    "explanation": "Operations can't stop because of a WAN outage."
  }
]
```
