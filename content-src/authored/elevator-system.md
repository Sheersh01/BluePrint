---
title: Elevator System
seoTitle: Design an Elevator (Smart Elevator) System
description: Design an elevator control system — modelling cars, hall and car calls, dispatching requests to cars, the SCAN/LOOK scheduling algorithm, destination dispatch for smart elevators, safety states and monitoring.
tags: Dealing with Contention, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🛗 What is an Elevator System?
An elevator system controls a bank of elevator cars in a building. People press **hall call** buttons (up/down) on each floor and **car call** buttons inside cars; the controller decides which car serves each call and in what order each car stops. A **smart elevator** uses **destination dispatch**: people enter their destination floor in the lobby, and the system groups passengers going to nearby floors into the same car. It's a popular object-oriented and real-time design question.
:::

### Functional Requirements

**Core Requirements**

1. Passengers should be able to request a car from any floor (up or down) or enter a destination (smart mode).
2. Passengers inside a car should be able to select destination floors.
3. The controller should assign each hall call to a car and decide each car's stop order.
4. Cars should handle door control, overload, emergency stop and out-of-service states.
5. Building staff should see the status of every car and fault alerts.

**Below the line (out of scope):**

- Motor control and physical safety circuits (handled by certified hardware).
- Fire service mode details.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Safety first: software never overrides hardware safety interlocks; failures fail safe.
2. Low average wait and travel time, with no request starving.
3. Responsive: button presses acknowledged instantly; dispatch decisions in milliseconds.
4. Each car keeps working if the group controller fails.
5. Energy efficiency (avoid needless trips).

**Below the line (out of scope):**

- Cloud dependency for core operation.

```sketch Elevator Requirements
Functional
- hall calls / destination entry
- car calls
- assign calls + order stops
- doors, overload, emergency states
- monitoring + alerts

Non-functional
- safety first, fail safe
- low wait, no starvation
- instant acknowledgement
- cars work if group controller fails
- energy efficient
```

## The Set Up

### Defining the Core Entities

1. **ElevatorCar**: ID, current floor, direction, state (idle, moving, doors open, maintenance), load, stop queue.
2. **Request**: hall call (floor + direction) or car call (car + floor), or destination request (from floor, to floor).
3. **Floor**: buttons and displays.
4. **GroupController**: assigns hall calls to cars using a dispatch strategy.
5. **CarController**: runs a single car's state machine and stop order.

Object-oriented sketch: `GroupController` holds `ElevatorCar`s and a `DispatchStrategy` (interface: `assign(request, cars)`); each `ElevatorCar` has a `CarController` with a state machine and a `StopScheduler`.

### API or System Interface

```
(floor panel)  hallCall(floor, direction)            -> assigned car shown (smart mode)
(lobby kiosk)  destinationCall(fromFloor, toFloor)   -> "Go to car C"
(car panel)    carCall(carId, floor)
(car -> group) status(carId, floor, direction, state, load)   (every ~100 ms)
(monitoring)   GET /cars -> statuses, faults
```

## High-Level Design

### 1) Car controllers

Each car runs its own **CarController**: a state machine (`IDLE → MOVING_UP/DOWN → DOORS_OPENING → DOORS_OPEN → DOORS_CLOSING`) plus a set of target floors. It moves toward targets, stops when reaching one, opens doors, and continues. Safety inputs (door sensors, overload, emergency stop) are handled by hardware interlocks, and the controller simply moves to a safe state.

### 2) Group controller and dispatch

When a hall call arrives, the **GroupController** asks the `DispatchStrategy` to choose a car, using each car's position, direction, load and existing stops, and adds the floor to that car's targets.

```diagram Controllers
node hall 0,0 box "Hall Buttons|+ kiosks"
node group 1.6,1 box "Group Controller|dispatch strategy"
node car1 3.2,0 box "Car Controller A"
node car2 3.2,2 box "Car Controller B"
node cabin 4.8,1 box "Car Buttons"
node mon 0,2 box "Monitoring"
edge hall -> group "hall / destination calls"
edge group <-> car1 "assign / status"
edge group -> car2
edge cabin -> car1 "car calls"
edge group -> mon
```

### 3) Stop ordering within a car

Each car orders its stops with the **LOOK** algorithm (a variant of SCAN, the "elevator algorithm"): keep moving in the current direction, serving every target on the way, until there are no more targets ahead; then reverse. This prevents bouncing back and forth and guarantees every request is served on the next sweep.

### 4) Monitoring

Cars report status to the group controller, which forwards it to a **building monitoring** service for dashboards, alerts (door faults, stuck cars) and maintenance scheduling.

## Potential Deep Dives

### 1) Which dispatch strategy?

:::solution bad Nearest car
#### Approach

Assign each hall call to the closest car.

#### Challenges

A close car heading the other way may take ages to come back; cars bunch together; some requests wait very long.
:::

:::solution good Nearest car moving in the right direction
#### Approach

Prefer cars already moving toward the floor in the requested direction; otherwise idle cars; otherwise the car that will reverse soonest.

#### Challenges

Ignores load and the cost to passengers already in the car.
:::

:::solution great Cost-based assignment with re-evaluation
#### Approach

For each candidate car, estimate the **total added cost** of taking the call: the new passenger's waiting time plus the extra delay for passengers already aboard, using travel time, door time per stop and load. Assign to the lowest-cost car, and **re-evaluate** unconfirmed assignments as conditions change. Apply **traffic-pattern modes**: in the morning up-peak, park idle cars at the lobby; at lunch, spread them across floors.

#### Challenges

Estimates need a model of travel and door times; display the assigned car only once the choice is stable.
:::

### 2) How does destination dispatch help?

With destination entry, the system knows where each passenger is going before choosing a car, so it can **group** people heading to nearby floors into the same car. Each car makes fewer stops, travel time drops, and the building moves more people per hour at peak. The cost is that passengers must follow the kiosk's assignment ("Go to car C"), and the lobby kiosks become the main interface.

:::tip
Address failure isolation: if the group controller fails, each car falls back to serving its own car calls and a default hall-call pattern, so people aren't trapped and service continues degraded.
:::

### 3) How do we prevent starvation?

LOOK guarantees each car eventually reaches every target, but a hall call could be repeatedly reassigned. Track each request's **age** and add a growing penalty to the cost function so old requests win; if a request exceeds a maximum wait, force-assign it to the next available car.

### Final Design

```diagram Final Design
node kiosk 0,0 box "Floor Panels|+ destination kiosks"
node group 1.6,1 box "Group Controller|cost-based dispatch"
node standby 1.6,-0.3 box "Standby Controller"
node carA 3.2,0 box "Car A|LOOK scheduler"
node carB 3.2,1 box "Car B"
node carC 3.2,2 box "Car C"
node safety 4.8,1 box "Hardware Safety|interlocks"
node mon 0,2 box "Building Monitoring"
edge kiosk -> group
edge group <-> standby "heartbeat"
edge group -> carA
edge group -> carB
edge group -> carC
edge carB <-> safety
edge group -> mon
```

```quiz
[
  {
    "question": "What does the LOOK algorithm do?",
    "options": ["Serves the nearest floor first", "Keeps moving in one direction serving stops until none remain ahead, then reverses", "Random order", "Always returns to the lobby"],
    "answer": 1,
    "explanation": "It avoids bouncing and guarantees service on the next sweep."
  },
  {
    "question": "Why can 'nearest car' dispatch perform badly?",
    "options": ["It's too complex", "A nearby car may be heading away and take a long time to return", "Cars are always full", "It ignores floors"],
    "answer": 1,
    "explanation": "Direction and existing stops matter more than distance alone."
  },
  {
    "question": "How does destination dispatch improve throughput?",
    "options": ["Cars move faster", "It groups passengers going to nearby floors into the same car, reducing stops", "It removes buttons", "It uses fewer cars"],
    "answer": 1,
    "explanation": "Fewer stops per trip means more people moved per hour."
  },
  {
    "question": "What happens if the group controller fails?",
    "options": ["All cars stop", "Cars fall back to serving their own calls in a degraded mode", "Doors stay open", "The building is evacuated"],
    "answer": 1,
    "explanation": "Each car controller can operate independently."
  }
]
```
