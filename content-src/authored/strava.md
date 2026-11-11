---
title: Strava
seoTitle: Design a Fitness Tracking App Like Strava
description: Design Strava — recording runs and rides with GPS, sharing activities and leaderboards — including offline tracking, GPS data storage and segment leaderboards.
tags: Real-time Updates, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Amazon, Microsoft | 6
---

## Understanding the Problem

:::definition 🏃 What is Strava?
Strava is a fitness app that records runs, rides and other workouts using a phone's GPS, shows live stats while you exercise, and lets you share completed activities with friends.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to start, pause, and stop recording an activity.
2. While recording, users should see live stats: distance, pace, and a map of their route.
3. Users should be able to view their completed activities and those of friends.
4. Users should be able to see a leaderboard of the fastest times on a route segment.

**Below the line (out of scope):**

- Social features like kudos and comments.
- Training plans and heart-rate analytics.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Recording must work offline (trail runs often have no signal) and never lose data.
2. Live stats should feel real time to the athlete.
3. The system should scale to 10M concurrent recording sessions at peak.
4. Viewing activities should be highly available; eventual consistency for friends' feeds is fine.

**Below the line (out of scope):**

- Anti-cheating detection.
- Privacy zones around a user's home.

```sketch Strava Requirements
Functional
- start / pause / stop activity
- live distance, pace, route map
- view my + friends' activities
- segment leaderboards

Non-functional
- works offline, never lose data
- real-time stats for the athlete
- 10M concurrent sessions
- availability >> consistency
```

## The Set Up

### Planning the Approach

The key insight is that **live stats only matter to the athlete holding the phone**. That lets us compute them on the device and keep the backend out of the hot loop.

### Defining the Core Entities

1. **User**: an athlete.
2. **Activity**: a recorded workout — type, start/end time, status, totals.
3. **Route**: the ordered list of GPS points (lat, long, timestamp) for an activity.
4. **Friend**: a connection between two users.

```sketch Strava Entities
Core Entities
- User
- Activity
- Route (GPS points)
- Friend
```

### API or System Interface

```
POST  /activities                      { "type": "RUN" } -> Activity
PATCH /activities/:id                  { "state": "PAUSED" | "RESUMED" | "COMPLETED" }
POST  /activities/:id/route            { "points": [{ "lat", "long", "ts" }] }
GET   /activities?mode=USER|FRIENDS&cursor -> Activity[]
GET   /segments/:id/leaderboard -> Entry[]
```

## High-Level Design

### 1) Users should be able to start, pause and stop an activity

An **Activity Service** creates an Activity row with status `IN_PROGRESS` and updates it on pause, resume and completion. State changes are small, infrequent writes.

### 2) Users should see live stats while recording

The phone collects a GPS point every few seconds. Distance and pace are computed **on the device** by summing the distance between consecutive points (haversine formula) — no network round trip needed, and it keeps working without signal.

Points are buffered locally and uploaded in batches to `POST /activities/:id/route` when connectivity allows.

```diagram Recording an activity
node phone 0,1 box "Phone|- GPS every 2-5s|- local buffer|- compute stats"
node gw 1.3,1 box "API Gateway"
node act 2.5,1 box "Activity Service"
node db 3.8,1 circle "Activity DB"
note 4.3,1 "Activity|- id|- userId|- type|- state|- distance|- route[]"
edge phone <-> gw "batched points"
edge gw <-> act
edge act <-> db
```

### 3) Users should be able to view activities

Completed activities are read by ID and listed by user. For the friends view, we query the Friend table for friend IDs, then fetch their recent activities. Because a friends feed tolerates staleness, we can precompute or cache it like any social feed.

### 4) Users should see segment leaderboards

When an activity completes, a worker checks which predefined **segments** (popular stretches of road or trail) the route passes through and records the elapsed time on each. The leaderboard is the fastest times per segment.

## Potential Deep Dives

### 1) How do we guarantee no data loss while offline?

:::solution bad Stream every GPS point to the server
#### Approach

Send each point to the backend as it's captured and rely on the server for stats.

#### Challenges

Fails the moment signal drops, drains battery with constant radio use, and creates 10M × (1 point / 3s) ≈ 3M writes per second for data only the athlete is watching.
:::

:::solution great Local-first recording with batched sync
#### Approach

Persist every point to on-device storage first (SQLite / the platform database), compute stats locally, and sync in batches every 10-30 seconds or when the activity ends. Each batch carries a sequence number so uploads are **idempotent** — retries after a flaky connection don't duplicate points.

#### Challenges

The server's view lags behind the device, which is fine because nobody else needs real-time data. If the phone dies mid-run, points already persisted locally are uploaded on the next app launch.
:::

### 2) How should we store GPS routes?

A one-hour run at a point every 3 seconds is ~1,200 points. Storing each point as a database row would mean billions of tiny rows. Instead, store the route as a **compressed blob** (e.g. an encoded polyline) — either in a column on the Activity or in S3 with a pointer — and keep only summary fields (distance, duration, bounding box) in the database for queries.

:::tip
Encoded polylines store deltas between consecutive coordinates, shrinking routes by 5-10× — and they are exactly what map SDKs consume for drawing the route.
:::

### 3) How do we scale segment leaderboards?

:::solution bad Query all efforts on every view
#### Approach

Store every segment effort in a table and run `ORDER BY elapsed LIMIT 10` on each leaderboard view.

#### Challenges

Popular segments have millions of efforts. Sorting on every view is slow, even with an index, and leaderboards are viewed far more than they change.
:::

:::solution great Redis sorted set per segment
#### Approach

Maintain a sorted set `segment:{id}` with member = userId and score = best elapsed time. On a new effort, `ZADD` with the `LT` flag only updates when the time improves. Reading the top 10 is `ZRANGE 0 9` and a user's rank is `ZRANK`.

#### Challenges

Sorted sets must fit in memory; segments with very long tails can keep only the top N in Redis and serve deep ranks from the database. The database remains the source of truth so Redis can be rebuilt.
:::

### Final Design

```diagram Final Design
node phone 0,1 box "Phone|- local storage|- on-device stats"
node gw 1.3,1 box "API Gateway"
node act 2.5,0.4 box "Activity Service"
node feed 2.5,1.6 box "Feed Service"
node q 3.7,0.4 circle "Queue"
node seg 4.8,0.4 box "Segment Matcher"
node lb 4.8,1.6 circle "Leaderboards|(Redis)"
node db 3.7,1.6 circle "Activity DB"
node s3 2.5,2.6 circle "S3|routes"
edge phone <-> gw "batched sync"
edge gw <-> act
edge gw <-> feed
edge act -> q "completed"
edge q -> seg
edge seg -> lb
edge act <-> db
edge feed <-> db
edge act -> s3
```

```quiz
[
  {
    "question": "Why compute distance and pace on the device rather than the server?",
    "options": ["Servers can't do math", "Only the athlete needs live stats and it must work offline", "It's more accurate", "It reduces storage"],
    "answer": 1,
    "explanation": "Local computation removes the network from the loop, works without signal and saves millions of writes per second."
  },
  {
    "question": "What makes batched GPS uploads safe to retry?",
    "options": ["Larger batches", "Sequence numbers that make uploads idempotent", "Using UDP", "Compressing the payload"],
    "answer": 1,
    "explanation": "The server ignores batches it has already applied, so retries never duplicate points.",
    "section": "1-how-do-we-guarantee-no-data-loss-while-offline"
  },
  {
    "question": "Which structure fits a segment leaderboard with fast top-N and rank lookups?",
    "options": ["Redis sorted set", "Linked list", "Bloom filter", "S3 object"],
    "answer": 0,
    "explanation": "Sorted sets keep members ordered by score with O(log n) updates and rank queries.",
    "section": "3-how-do-we-scale-segment-leaderboards"
  },
  {
    "question": "How should a long GPS route be stored?",
    "options": ["One database row per point", "As a compressed blob such as an encoded polyline", "In the cache only", "In the client only"],
    "answer": 1,
    "explanation": "Compressed routes avoid billions of tiny rows; summary fields stay queryable in the database.",
    "section": "2-how-should-we-store-gps-routes"
  }
]
```
