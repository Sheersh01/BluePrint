---
title: Concurrent Stream Limit
seoTitle: Design Netflix's Limit on Simultaneous Screens per Account
description: Design a system that limits how many screens an account can stream on at once — session leases, heartbeats, atomic counters and handling crashed devices.
tags: Dealing with Contention
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Netflix | 0
---

## Understanding the Problem

:::definition 📺 What is a Concurrent Stream Limit?
Streaming services limit how many devices can play video on one account at the same time — for example, a "Standard" plan allows 2 screens. Starting playback on a third device should be blocked until another stops.
:::

### Functional Requirements

**Core Requirements**

1. When a device starts playback, allow it only if the account is under its plan's screen limit.
2. When playback stops, the screen should be freed.
3. If a device crashes or loses connectivity, its screen should be freed automatically.
4. Users should see which devices are currently streaming and be able to stop one.

**Below the line (out of scope):**

- Video delivery itself.
- Download-for-offline limits.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. The limit must hold under concurrency — two devices starting at the same instant can't both take the last slot.
2. Checks add little latency to starting playback (< 100ms).
3. Highly available: if the limiter fails, prefer letting users watch over blocking paying customers.
4. Scale to 200M+ accounts and tens of millions of concurrent streams.

**Below the line (out of scope):**

- Account-sharing detection.

```sketch Stream Limit Requirements
Functional
- allow start if under plan limit
- free slot on stop
- auto-free on crash
- list + kick devices

Non-functional
- correct under concurrency
- < 100ms check
- fail open
- 200M accounts
```

## The Set Up

### Defining the Core Entities

1. **Account**: plan and its maximum concurrent streams.
2. **Stream session (lease)**: accountId, deviceId, sessionId, last heartbeat, expiry.

### API or System Interface

```
POST   /sessions { "deviceId": "tv-123", "titleId": "..." } -> { sessionId, ttl } | 409 LIMIT_REACHED
POST   /sessions/:id/heartbeat
DELETE /sessions/:id
GET    /accounts/:id/sessions -> Session[]
```

## High-Level Design

### 1) Allow playback only under the limit

When a device starts playback, the player calls the **Session Service** before requesting the stream manifest. The service checks the account's active sessions and creates a new one only if there's room.

```diagram Session leases
node player 0,1 box "Player|- heartbeat every 30s"
node svc 1.5,1 box "Session Service"
node redis 3,1 circle "Redis|sessions per account"
node play 1.5,2.3 box "Playback API|(manifest, DRM)"
note 3.5,0.9 "account:42:sessions|sorted set|member = sessionId|score = expiresAt"
edge player <-> svc "start / heartbeat"
edge svc <-> redis "atomic check + add"
edge player <-> play "requires sessionId"
```

### 2) Free the screen when playback stops

On stop, the player deletes its session. The Playback API (manifest and DRM license requests) only works with a valid session ID, so a removed session also stops playback.

### 3) Free screens from crashed devices

Sessions are **leases**: each has an expiry a minute or two in the future, and the player renews it with a heartbeat every 30 seconds. If a device dies, its heartbeats stop and the lease expires on its own — no cleanup message needed.

### 4) Show and stop devices

Listing sessions reads the account's active leases. "Stop streaming on this device" deletes the lease; the player's next heartbeat (or license renewal) fails and playback ends.

## Potential Deep Dives

### 1) How do we enforce the limit correctly under concurrency?

:::solution bad Read count, then insert
#### Approach

Count active sessions; if under the limit, insert a new one.

#### Challenges

Two devices starting simultaneously both read "1 of 2" and both insert — three streams.
:::

:::solution good Database transaction with row lock
#### Approach

Lock the account row (`SELECT ... FOR UPDATE`), count unexpired sessions, insert, commit.

#### Challenges

Correct, but adds database latency to every heartbeat and start at tens of millions of streams.
:::

:::solution great Atomic script in Redis
#### Approach

Keep each account's sessions in a Redis sorted set scored by expiry. A Lua script atomically (1) removes expired members (`ZREMRANGEBYSCORE`), (2) checks the count against the limit, and (3) adds the new session. Redis runs scripts single-threaded, so the check-and-add can't interleave. Heartbeats just update the member's score.

#### Challenges

Redis must be replicated; a failover can briefly lose recent leases, which at worst lets an extra stream start — acceptable for this product.
:::

### 2) What if the session service is down?

**Fail open**: if the check times out, let playback start and attach a session later. Blocking millions of paying customers because a limiter is down is far worse than briefly allowing an extra screen. Monitor and alert on fail-open rates.

### 3) How long should leases last?

Short leases free crashed devices quickly but require frequent heartbeats; long leases reduce load but leave ghost sessions. A 30-second heartbeat with a 90-second lease (tolerating two missed heartbeats) is a common balance. Tie heartbeats to existing traffic — such as DRM license renewals — so they cost almost nothing extra.

### Final Design

```diagram Final Design
node player 0,1.2 box "Player Devices"
node gw 1.3,1.2 box "API Gateway"
node svc 2.6,0.4 box "Session Service|- Lua check-and-add|- fail open"
node play 2.6,2 box "Playback / DRM|- validates session"
node redis 4,0.4 circle "Redis Cluster|leases"
node acct 4,2 circle "Accounts DB|plan limits"
edge player <-> gw
edge gw <-> svc
edge gw <-> play
edge svc <-> redis
edge svc <-> acct
edge play <-> svc "verify"
```

```quiz
[
  {
    "question": "Why model streams as leases with expiry?",
    "options": ["For billing", "So crashed devices free their slot automatically when heartbeats stop", "To encrypt video", "To speed up playback"],
    "answer": 1,
    "explanation": "Expiry removes the need for a reliable stop message."
  },
  {
    "question": "What prevents two simultaneous starts from exceeding the limit?",
    "options": ["Client checks", "An atomic check-and-add, e.g. a Redis Lua script", "Longer leases", "Retries"],
    "answer": 1,
    "explanation": "The count check and insert must happen as one atomic step."
  },
  {
    "question": "If the session service is unavailable, what should happen?",
    "options": ["Block all playback", "Fail open and allow playback", "Log users out", "Retry forever"],
    "answer": 1,
    "explanation": "Briefly allowing an extra stream beats blocking paying customers."
  },
  {
    "question": "How can heartbeats be made nearly free?",
    "options": ["Send them every second", "Piggyback on existing DRM license renewals", "Skip them", "Use email"],
    "answer": 1,
    "explanation": "Reusing traffic the player already sends avoids extra load."
  }
]
```
