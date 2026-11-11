---
title: Autonomous Vehicle Platform
seoTitle: Design the Cloud Platform for Autonomous Vehicles
description: Design the cloud platform behind an autonomous vehicle fleet — ingesting petabytes of sensor logs, finding interesting scenarios, simulation at scale, safe over-the-air model rollouts, fleet telemetry and remote assistance.
tags: Handling Large Blobs, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🚗 What is an Autonomous Vehicle Platform?
A self-driving car makes its driving decisions on board, in real time. The cloud platform behind the fleet does everything else: collects the huge sensor logs from every car, finds the rare situations worth learning from, replays them in simulation to test new software, rolls out updates safely, and lets remote operators help a car that's stuck. Waymo, Cruise and Tesla all build platforms like this.
:::

### Functional Requirements

**Core Requirements**

1. Vehicles should upload driving logs (camera, lidar, radar, vehicle state) for storage and analysis.
2. Engineers should be able to search logs for specific scenarios (e.g. "cyclist cuts in at night") and label them.
3. New driving software should be tested by replaying millions of scenarios in simulation before release.
4. Software and model updates should be rolled out over the air to the fleet in stages.
5. Vehicles should stream live telemetry, and remote operators should be able to assist a vehicle that requests help.

**Below the line (out of scope):**

- On-vehicle perception and planning algorithms.
- Ride-hailing dispatch (see Uber).
- HD map creation (mentioned briefly).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Safety: no update reaches the fleet without passing simulation and staged rollout gates; rollbacks are instant.
2. Handle ~1-5 TB of raw data per vehicle per day across thousands of vehicles.
3. Remote assistance with low latency (< 200 ms round trip) and high availability.
4. Driving never depends on cloud connectivity; the car must stay safe when offline.
5. Data is retained and traceable for incident investigation and regulators.

**Below the line (out of scope):**

- Cost optimisation details for storage tiers.

```sketch AV Platform Requirements
Functional
- upload driving logs
- search + label scenarios
- simulate before release
- staged OTA rollouts
- telemetry + remote assist

Non-functional
- safety gates + instant rollback
- TBs per vehicle per day
- remote assist < 200ms
- car safe when offline
- traceable for investigations
```

## The Set Up

### Defining the Core Entities

1. **Vehicle**: ID, hardware version, software version, location, status.
2. **Drive log**: time-ranged sensor data split into segments, with metadata and an index of events.
3. **Scenario**: a short labelled slice of a log (or a synthetic variant) used for training or testing.
4. **Software release**: version, components (models, planner), rollout stage and target cohort.
5. **Assistance session**: vehicle, operator, guidance given.

### API or System Interface

```
(vehicle) PUT  /logs/:vehicleId/:segmentId      (resumable chunked upload at depot)
(vehicle) MQTT telemetry/{vehicleId}            (live state, every second)
GET  /scenarios/search?query=&tags=
POST /simulations { releaseId, scenarioSet } -> { jobId }
POST /releases/:id/rollout { cohort, percentage }
(vehicle) POST /assist/request { context }       -> session
```

## High-Level Design

### 1) Getting logs off vehicles

Vehicles record everything locally on large SSDs. A small, high-priority subset (events flagged on board: hard braking, disengagements, unusual objects) is uploaded over cellular soon after it happens. The full logs are uploaded over high-bandwidth links when the car returns to the **depot**, using **resumable chunked uploads** into object storage. An ingestion pipeline extracts metadata and builds an index of the log.

```diagram Log ingestion
node car 0,1 box "Vehicle|local SSD"
node cell 1.6,-0.3 box "Cellular|flagged events"
node depot 1.6,1 box "Depot Upload|high bandwidth"
node s3 3.2,1 circle "Object Storage|raw logs"
node index 4.8,1 box "Ingestion|metadata + index"
edge car -> cell
edge car -> depot
edge cell -> s3
edge depot -> s3
edge s3 -> index
```

### 2) Finding and labelling scenarios

Offline models run over new logs to tag what happened (pedestrians, weather, manoeuvres) and compute **embeddings** of scenes. Engineers search with filters and similarity ("more scenes like this one"), and send interesting slices to labelling. Labelled scenarios become training data and regression tests.

### 3) Simulation before release

A candidate release is tested by **replaying** thousands to millions of scenarios: the recorded sensor data is fed to the new software, and its decisions are scored against safety and comfort metrics. Variations (a pedestrian stepping out a second earlier) are generated synthetically. Simulation runs as a massive batch job across a compute cluster.

### 4) Rollout, telemetry and remote assistance

Releases that pass simulation go to a test fleet, then expand in **stages** across cohorts. Every vehicle streams telemetry (position, health, software version) over MQTT. When a vehicle is unsure — a road blocked by construction — it stops safely and requests **remote assistance**; an operator views its sensor feed and suggests a path, which the car validates before acting.

## Potential Deep Dives

### 1) How do we handle petabytes of logs?

:::solution bad Upload everything over cellular
#### Approach

Stream all sensor data to the cloud continuously.

#### Challenges

Terabytes per car per day over cellular is impossibly expensive and unreliable.
:::

:::solution good Depot uploads with tiered storage
#### Approach

Upload full logs at depots and keep them in object storage, moving older data to cold tiers.

#### Challenges

Most of the data is uneventful highway driving that is rarely used but costly to keep.
:::

:::solution great Triage on board and in the cloud
#### Approach

Vehicles **prioritise** on board: flagged events at full fidelity, ordinary driving downsampled. In the cloud, a triage pipeline keeps full-resolution data for interesting segments (by tags and novelty of embeddings) and keeps only compressed or summary data for the rest after a retention period. Everything needed for **incident investigation** is kept with legal holds.

#### Challenges

On-board triage must not miss important events; err toward keeping data around anomalies.
:::

### 2) How do we roll out software safely?

Each release passes **simulation gates** (no regression on the safety-critical scenario suite), then a closed-course and test-fleet phase, then **staged rollout** by cohort — by city, hardware version and percentage — with automatic halts if disengagement or incident metrics worsen. Vehicles keep the **previous version installed** in a second partition (A/B partitions), so rollback is a restart into the known-good version. Updates install only while parked.

:::tip
Stress that the car never depends on the cloud to drive: a lost connection or a failed update leaves it on the last known-good software, able to reach a safe stop.
:::

### 3) How do we make remote assistance responsive?

Assistance sessions use a low-latency connection from the nearest region, carrying a **compressed, reduced view** (key camera feeds, the car's perception output) rather than raw sensors. The operator gives **high-level guidance** (a path or permission to proceed), never direct steering, so latency spikes can't cause unsafe motion. Requests are routed to available operators by region, with queues monitored to keep wait time low.

### Final Design

```diagram Final Design
node car 0,1 box "Vehicles"
node mqtt 1.5,-0.3 box "Telemetry|MQTT"
node upload 1.5,1 box "Log Upload"
node s3 3,1 circle "Log Lake"
node mine 4.5,1 box "Scenario Mining|tags + embeddings"
node sim 6,1 box "Simulation Farm"
node rel 6,2.3 box "Release Manager|staged rollout"
node ota 3,2.3 box "OTA Service"
node assist 3,-0.3 box "Remote Assist|operators"
edge car -> mqtt
edge car -> upload
edge upload -> s3
edge s3 -> mine
edge mine -> sim "scenario suites"
edge sim -> rel "gates"
edge rel -> ota
edge ota -> car "updates"
edge mqtt <-> assist
```

```quiz
[
  {
    "question": "Why are full driving logs uploaded at depots rather than over cellular?",
    "options": ["Cellular is insecure", "Terabytes per vehicle per day is too costly and slow over cellular", "Depots are closer to the cloud", "Regulations"],
    "answer": 1,
    "explanation": "Only flagged events go over cellular; bulk data waits for high-bandwidth links."
  },
  {
    "question": "What must a release pass before reaching the fleet?",
    "options": ["Nothing", "Simulation gates on safety scenarios, then staged rollout with halts", "Only unit tests", "A manager's approval"],
    "answer": 1,
    "explanation": "Safety requires evidence from simulation and gradual exposure."
  },
  {
    "question": "Why do vehicles keep two software partitions?",
    "options": ["Speed", "So rollback is instant to the previous known-good version", "To run two drivers", "For logging"],
    "answer": 1,
    "explanation": "A/B partitions make updates recoverable."
  },
  {
    "question": "What does a remote operator send to a stuck vehicle?",
    "options": ["Direct steering commands", "High-level guidance the car validates before acting", "A new map", "Nothing"],
    "answer": 1,
    "explanation": "The car stays responsible for safe motion, so latency can't cause harm."
  }
]
```
