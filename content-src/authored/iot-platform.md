---
title: IoT Platform
seoTitle: Design an IoT Device Platform
description: Design an IoT platform — connecting millions of devices over MQTT, ingesting telemetry at high write rates, storing time-series data, sending commands to devices, and handling intermittent connectivity.
tags: Scaling Writes, Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🔌 What is an IoT Platform?
An IoT platform connects physical devices — sensors, meters, thermostats, vehicles — to the cloud. Devices send telemetry (temperature, location, status), the platform stores and analyses it, raises alerts, and lets users and applications send commands back to devices.
:::

### Functional Requirements

**Core Requirements**

1. Devices should securely connect and send telemetry.
2. Users should be able to view current device state and historical telemetry.
3. Users should be able to define alert rules (e.g. temperature above 80°C for 5 minutes).
4. Users and applications should be able to send commands or configuration to devices.

**Below the line (out of scope):**

- Over-the-air firmware updates (discussed briefly).
- Device manufacturing and provisioning at the factory.
- Billing.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Scale to ~10M connected devices, each reporting every ~10 seconds (~1M messages/second).
2. Tolerate unreliable networks: devices disconnect often and must not lose data or commands.
3. Alerts should fire within seconds of the triggering data.
4. Strong device security: each device authenticates individually and can only access its own data.

**Below the line (out of scope):**

- Hard real-time control loops (handled on the device).

```sketch IoT Platform Requirements
Functional
- devices connect + send telemetry
- current state + history
- alert rules
- commands to devices

Non-functional
- 10M devices, ~1M msgs/s
- flaky networks, no loss
- alerts in seconds
- per-device identity
```

## The Set Up

### Defining the Core Entities

1. **Device**: ID, type, owner, certificate, firmware version.
2. **Telemetry**: device ID, timestamp, metrics.
3. **Device shadow**: the latest reported state and the desired state for each device.
4. **Alert rule**: condition, window and notification target.
5. **Command**: a request sent to a device, with status (pending, delivered, acknowledged).

### API or System Interface

```
MQTT  devices/{deviceId}/telemetry       (device publishes)
MQTT  devices/{deviceId}/commands        (device subscribes)
GET   /devices/:id/state                 -> latest reported + desired state
GET   /devices/:id/telemetry?metric=temp&from=&to=&step=1m
POST  /devices/:id/commands { type, payload }
POST  /alert-rules { condition, window, notify }
```

## High-Level Design

### 1) Devices connect and send telemetry

Devices keep a long-lived **MQTT** connection over TLS to an **MQTT broker cluster**. MQTT suits constrained devices: tiny headers, persistent sessions and QoS levels. Each device authenticates with its own **X.509 certificate**. The broker forwards telemetry into **Kafka**, which absorbs the ~1M messages per second and decouples devices from processing.

```diagram Telemetry ingestion
node device 0,1 box "Devices|MQTT over TLS"
node broker 1.6,1 box "MQTT Brokers"
node kafka 3.2,1 box "Kafka|telemetry topic"
node tsdb 4.8,0 circle "Time-series DB"
node shadow 4.8,2 circle "Device Shadow|(latest state)"
edge device -> broker "publish telemetry"
edge broker -> kafka
edge kafka -> tsdb "batch writes"
edge kafka -> shadow "update latest"
```

### 2) Users view current state and history

Consumers write telemetry in batches to a **time-series database** (TimescaleDB, InfluxDB or Cassandra with time-bucketed partitions), partitioned by device and time. Another consumer updates each device's **shadow** — its latest reported state — in a key-value store, so "what is this device doing now?" is a single lookup. Older data is **downsampled** (1-minute and 1-hour rollups) and raw data is moved to cheap object storage after a retention period.

### 3) Alert rules

A **stream processor** (Flink) consumes the telemetry topic, evaluates each rule with windowed state per device ("average temperature over 5 minutes > 80"), and emits alerts to a notification service. Rules are loaded from a rules store and updated without restarting.

### 4) Commands to devices

A command is stored with status `pending` and written to the device shadow's **desired state**. If the device is connected, it's published to `devices/{id}/commands`; the device applies it and reports back, which updates the shadow and marks the command acknowledged. If the device is offline, it receives the pending desired state when it reconnects.

## Potential Deep Dives

### 1) How do we handle 10 million persistent connections?

Each broker node can hold a few hundred thousand idle MQTT connections, so ~10M devices need a cluster of dozens of brokers behind a TCP/TLS load balancer. Brokers must be **stateless with respect to routing**: a device can reconnect to any broker, and session state (subscriptions, queued QoS 1 messages) is kept in a shared session store or replicated across the broker cluster. Reconnect storms after an outage are controlled by **randomised backoff on devices** and connection rate limits on the load balancer.

### 2) How do we avoid losing data on flaky networks?

:::solution bad Fire-and-forget telemetry
#### Approach

Devices publish with MQTT QoS 0 and drop data when offline.

#### Challenges

Any disconnection loses readings, which is unacceptable for metering or compliance data.
:::

:::solution good QoS 1 with retries
#### Approach

Publish with **QoS 1** (at-least-once): the broker acknowledges each message and the device retries until acked.

#### Challenges

Duplicates are possible after retries, and data produced while offline is still lost unless stored locally.
:::

:::solution great Local buffering, sequence numbers, idempotent writes
#### Approach

Devices **buffer readings locally** while offline and upload them in batches on reconnect, using QoS 1. Each reading carries the **device timestamp and a sequence number**, so the ingestion pipeline deduplicates and writes idempotently (upsert by `deviceId + timestamp`). Late data is accepted into the time-series store and stream processing uses **event time with allowed lateness**, so alerts and rollups are correct even when data arrives out of order.

#### Challenges

Device clocks drift — sync with NTP and record both device and server receive time.
:::

### 3) How do we store ~1M writes per second?

A relational database row per reading won't keep up. Time-series stores batch writes, compress columns (similar consecutive values compress extremely well) and partition by `(deviceId, time bucket)` so writes spread across nodes and range queries for one device stay on one partition. Dashboards read pre-computed rollups rather than raw points.

:::tip
Do the back-of-envelope: 1M messages/s × ~200 bytes ≈ 200 MB/s, ~17 TB/day raw. That number justifies compression, downsampling and tiered retention.
:::

### 4) How do we secure millions of devices?

Each device gets a **unique certificate** provisioned at manufacture; a compromised device can be revoked without affecting others. The broker enforces **topic-level authorisation**: device `abc` may only publish to `devices/abc/*` and subscribe to its own command topic. Firmware updates are **signed** and rolled out in stages to a small percentage of devices first.

### Final Design

```diagram Final Design
node device 0,1 box "Devices|local buffer|cert auth"
node lb 1.4,1 box "TLS Load Balancer"
node broker 2.8,1 box "MQTT Broker Cluster|topic ACLs"
node kafka 4.2,1 box "Kafka"
node ingest 5.6,0 box "Ingest Workers|dedupe + batch"
node tsdb 7,0 circle "Time-series DB|+ rollups"
node flink 5.6,2.1 box "Flink|alert rules"
node notify 7,2.1 box "Notifications"
node shadow 4.2,-0.4 circle "Device Shadow"
node api 2.8,-0.4 box "Device API|state · history · commands"
edge device <-> lb
edge lb <-> broker
edge broker -> kafka
edge kafka -> ingest
edge ingest -> tsdb
edge kafka -> flink
edge flink -> notify
edge kafka -> shadow
edge api <-> shadow
edge api -> broker "commands"
```

```quiz
[
  {
    "question": "Why is MQTT commonly used for IoT devices?",
    "options": ["It's a database", "Lightweight pub/sub with persistent sessions and delivery QoS for constrained devices", "It's required by HTTP", "It compresses video"],
    "answer": 1,
    "explanation": "Small overhead and QoS levels suit low-power devices on unreliable networks."
  },
  {
    "question": "What is a device shadow?",
    "options": ["A backup device", "A stored copy of each device's latest reported and desired state", "A firewall", "A firmware image"],
    "answer": 1,
    "explanation": "Shadows let apps read state and queue changes even while devices are offline."
  },
  {
    "question": "How do we prevent duplicate readings after retries?",
    "options": ["Ignore retries", "Include a timestamp and sequence number and write idempotently", "Use QoS 0", "Restart the broker"],
    "answer": 1,
    "explanation": "Idempotent upserts turn at-least-once delivery into effectively-once storage."
  },
  {
    "question": "Why downsample old telemetry?",
    "options": ["To hide data", "Raw data at ~17 TB/day is too costly to keep and query forever", "Regulations forbid raw data", "To improve accuracy"],
    "answer": 1,
    "explanation": "Rollups keep long-term trends queryable cheaply while raw data ages out."
  }
]
```
