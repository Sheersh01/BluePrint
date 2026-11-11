---
title: Nearby Friends
seoTitle: Design Nearby Friends — Real-Time Friend Locations
description: Design a "nearby friends" feature — users who opt in share live locations, and see which friends are within a few miles, with high-frequency location updates, pub/sub per user, and privacy controls.
tags: Real-time Updates, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📍 What is Nearby Friends?
Nearby Friends (as in Facebook or Snap Map) shows which of your friends are close to you right now — "Priya, 0.8 miles away" — and updates as people move. Unlike Yelp-style "nearby places", both sides are moving, and you only care about *your friends*, not everyone nearby.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to opt in to sharing their location with friends.
2. Users should see a list of friends within a set radius (e.g. 5 miles) with distance and last-updated time.
3. The list should update in near real time as friends move.

**Below the line (out of scope):**

- Location history.
- Showing friends on a map with routes.
- Nearby strangers or recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Updates appear within ~10-30 seconds; locations don't need to be exact to the metre.
2. Handle ~100M daily users with ~10M sharing at peak, each sending a location every ~30 seconds.
3. Privacy: only opted-in friends see a location, sharing can be paused instantly, and locations expire.
4. Battery-friendly on mobile.

**Below the line (out of scope):**

- Strong consistency.

```sketch Nearby Friends Requirements
Functional
- opt in to sharing
- friends within radius + distance
- near real-time updates

Non-functional
- 10-30s freshness
- 10M sharing, update every 30s
- privacy + instant pause
- battery friendly
```

## The Set Up

### Defining the Core Entities

1. **User**: ID, sharing setting (on/off, audience).
2. **Friendship**: pairs of users (from the social graph service).
3. **Location**: user, lat/lng, timestamp — only the latest matters, with a TTL.

### API or System Interface

```
PUT /me/location-sharing { enabled, audience }
WS  /nearby
  client -> { type: "location", lat, lng, ts }       (every ~30s)
  server -> { type: "friends", list: [{ userId, distance, updatedAt }] }
  server -> { type: "friend_update", userId, distance, updatedAt }
```

## High-Level Design

### 1) Users opt in and send locations

When a sharing user opens the app (or in the background at a low rate), the client sends its location over a **WebSocket** to a **Location Gateway** about every 30 seconds. The gateway writes the latest point to a **location cache** (Redis, keyed by user with a TTL of a few minutes) — no database write per update.

### 2) Showing nearby friends on open

On connect, the server fetches the user's friend list (filtered to those sharing), reads their cached locations in one batched call, computes distances, and returns those within the radius.

### 3) Real-time updates

Each sharing user has a **pub/sub channel**. A user's gateway subscribes to the channels of all their sharing friends. When a friend sends a new location, it's published on the friend's channel; every subscribed gateway computes the distance to its own user and pushes an update only if the friend is within the radius (or just left it).

```diagram Location updates
node friend 0,1 box "Friend's App"
node gwa 1.5,1 box "Gateway A"
node cache 1.5,-0.3 circle "Location Cache|TTL"
node pubsub 3,1 box "Pub/Sub|channel per user"
node gwb 4.5,1 box "Gateway B|distance filter"
node me 6,1 box "My App"
edge friend -> gwa "location"
edge gwa -> cache
edge gwa -> pubsub "publish"
edge pubsub -> gwb "subscribed"
edge gwb -> me "if within radius"
```

## Potential Deep Dives

### 1) How do we scale the pub/sub fan-out?

With 10M sharing users, ~330k location updates arrive per second. Each update is published once and delivered to the gateways of that user's sharing friends — perhaps 50-100 on average, so millions of deliveries per second.

:::solution bad Query friends from the database on every update
#### Approach

On each location update, look up the user's friends and their gateways in the database.

#### Challenges

Hundreds of thousands of graph lookups per second just to route messages.
:::

:::solution good Central pub/sub with a channel per user
#### Approach

Use Redis Pub/Sub (or a similar broker) where gateways subscribe to friends' channels when their user connects.

#### Challenges

One Redis cluster can't hold tens of millions of channels and millions of messages per second.
:::

:::solution great Sharded pub/sub by user ID
#### Approach

Run a **cluster of pub/sub servers** with channels partitioned by user ID using consistent hashing. Gateways subscribe to the right shard for each friend; messages are small (user ID, lat, lng, ts). The **distance filter runs on the receiving gateway**, which knows its own user's location, so far-away updates cost a cheap check and are dropped without touching the phone.

#### Challenges

Adding pub/sub shards moves channels, so gateways must re-subscribe on topology changes.
:::

### 2) Why not use a geospatial index?

A geo index answers "who is near this point?", which suits strangers or places. Here we only care about **friends**, a set of a few hundred known people, so looking up their locations directly is cheaper and keeps privacy simple. A geo index becomes useful only for a "people nearby" feature open to non-friends.

:::tip
Explain the battery trade-off: clients send updates only when they've moved meaningfully (e.g. 100 m) or every few minutes in the background, using the OS's significant-location-change APIs.
:::

### 3) How do we enforce privacy?

Locations are only published for opted-in users and only delivered to friends allowed by the audience setting. Pausing sharing **deletes the cached location** and publishes a "stopped" event, so friends' lists update immediately. Cached locations expire after a few minutes, so a phone that goes offline stops appearing. Locations aren't stored historically unless the user opts into that separately.

### Final Design

```diagram Final Design
node app 0,1 box "Apps"
node lb 1.4,1 box "Load Balancer|WebSocket"
node gw 2.8,1 box "Location Gateways|distance filter"
node cache 2.8,-0.3 circle "Location Cache"
node ps 4.2,1 box "Pub/Sub Cluster|sharded by user"
node graph 2.8,2.3 box "Friend Graph|sharing settings"
edge app <-> lb
edge lb <-> gw
edge gw <-> cache
edge gw <-> ps "publish / subscribe"
edge gw <-> graph "friends on connect"
```

```quiz
[
  {
    "question": "Why store locations in a cache with a TTL instead of a database?",
    "options": ["Databases can't store coordinates", "Only the latest location matters and it should expire automatically", "Caches are encrypted", "It's required for WebSockets"],
    "answer": 1,
    "explanation": "High write rates and automatic expiry suit an in-memory cache."
  },
  {
    "question": "How do friends' updates reach a user?",
    "options": ["Polling every friend", "The user's gateway subscribes to each sharing friend's pub/sub channel", "Email", "A nightly job"],
    "answer": 1,
    "explanation": "Publish once, deliver to subscribed gateways."
  },
  {
    "question": "Where is the distance filter applied?",
    "options": ["On the friend's phone", "On the receiving gateway, which knows its own user's location", "In the database", "Nowhere"],
    "answer": 1,
    "explanation": "Far-away updates are dropped before reaching the phone."
  },
  {
    "question": "Why isn't a geospatial index necessary here?",
    "options": ["It's too slow", "We only need locations of a known, small set of friends", "Phones can't send coordinates", "Geo indexes are insecure"],
    "answer": 1,
    "explanation": "Direct lookup of friends' locations is simpler and cheaper."
  }
]
```
