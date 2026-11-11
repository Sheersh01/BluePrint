---
title: Like Counter
seoTitle: Design Facebook Likes with Live Counts for Viral Posts
description: Design a like system — recording likes, counting at massive scale for celebrity posts, and pushing live count updates to viewers.
tags: Scaling Writes, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Facebook, Amazon, Twitter, Coinbase | 0
---

## Understanding the Problem

:::definition 👍 What is a Like Counter?
Every post on a social network shows a like button and a count. The system must record who liked what, show accurate-enough counts, and — for live features — update counts on screen as new likes arrive, even when a celebrity post gets millions of likes in minutes.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to like and unlike a post (at most one like per user per post).
2. Users should see the like count on each post, and whether they liked it.
3. Viewers of a post should see the count update live.

**Below the line (out of scope):**

- Reactions beyond a single like.
- Showing the list of likers.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Handle bursts of 100k+ likes per second on a single viral post.
2. Counts may be approximate in real time (lag of a few seconds is fine) but must converge to the exact value.
3. "Did I like this?" must be accurate for the user (read-your-writes).
4. Reading counts must be fast (< 50ms) because they appear on every feed item.

**Below the line (out of scope):**

- Fraud and bot-like detection.

```sketch Like Counter Requirements
Functional
- like / unlike (once per user)
- show count + my like
- live count updates

Non-functional
- 100k likes/s on one post
- counts converge, lag ok
- my like is accurate
- reads < 50ms
```

## The Set Up

### Defining the Core Entities

1. **Like**: (postId, userId, createdAt) — the source of truth.
2. **Like count**: an aggregated counter per post.
3. **Post**: the content being liked.

### API or System Interface

```
PUT    /posts/:id/like
DELETE /posts/:id/like
GET    /posts/:id/likes/summary -> { count, likedByMe }
SSE    /posts/:id/likes/stream   -> { count } updates
```

## High-Level Design

### 1) Users should be able to like and unlike

The **Like Service** writes the like edge to a wide-column store keyed by `(postId, userId)` — the primary key makes a like idempotent and enforces one per user. It also emits a `liked`/`unliked` event.

```diagram Likes and counts
node client 0,1 box "Client"
node svc 1.4,1 box "Like Service"
node edges 2.8,0.2 circle "Likes Table|(postId, userId)"
node kafka 2.8,1.8 circle "Kafka|like events"
node agg 4.2,1.8 box "Counter|Aggregator"
node cache 4.2,0.6 circle "Counts|(Redis)"
edge client <-> svc "PUT /like"
edge svc -> edges
edge svc -> kafka
edge kafka -> agg
edge agg -> cache "+N every 1s"
edge svc <-> cache "read count"
```

### 2) Users should see counts and their own like

Counts come from a counter cache (Redis), backed by a durable counts table. "Liked by me" is a point lookup on the likes table, which is accurate immediately after the user's write.

### 3) Viewers should see live updates

Viewers subscribe over SSE. When a post's count changes, the aggregator publishes the new total to a pub/sub channel for that post; connection servers forward it to subscribed viewers, at most once every second or two.

## Potential Deep Dives

### 1) How do we count likes on a viral post?

:::solution bad Increment the post row on every like
#### Approach

`UPDATE posts SET likes = likes + 1` per like.

#### Challenges

100k updates per second on one row serialise on its lock and overwhelm the database.
:::

:::solution good Atomic increments in Redis
#### Approach

`INCR post:123:likes` per like, persisted periodically.

#### Challenges

Much faster, but one key still lives on one Redis node — a single hot post can saturate it.
:::

:::solution great Aggregate events, then shard hot counters
#### Approach

Like events go to Kafka, partitioned by postId. Aggregators sum deltas in memory and flush `+N` every second, turning 100k writes into one. For extremely hot posts, also split the counter across shards (`post:123:likes:0..15`) and sum them on read (or cache the sum for a second). A periodic reconciliation job recounts from the likes table so the counter converges to the truth.

#### Challenges

Counts lag by about a second and unlike/like flips must be handled as signed deltas.
:::

### 2) How do we push live updates to millions of viewers?

Don't send an event per like — that would be 100k messages per second per viewer. Coalesce: emit the latest count per post at most once per second. Fan out hierarchically through pub/sub to connection servers, each of which forwards to its own viewers. For huge audiences, approximate ("1.2M") rather than exact digits.

:::pattern Pattern: Real-time Updates
Coalescing updates and fanning out to connection servers (not to individual users) is what keeps live counts affordable.
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Clients"
node svc 1.4,0.4 box "Like Service"
node conn 1.4,2 box "Connection Servers|(SSE)"
node edges 2.8,0 circle "Likes Table"
node kafka 2.8,1 circle "Kafka"
node agg 4.2,1 box "Aggregators|- batch deltas|- sharded counters"
node cache 4.2,2.3 circle "Counts|(Redis)"
node ps 2.8,2.3 circle "Pub/Sub"
node recon 5.5,0 box "Reconciler"
edge client <-> svc
edge client <-> conn
edge svc -> edges
edge svc -> kafka
edge kafka -> agg
edge agg -> cache
edge agg -> ps "count changed"
edge ps -> conn
edge recon <-> edges
edge recon -> cache
```

```quiz
[
  {
    "question": "How do you enforce one like per user per post?",
    "options": ["Client-side checks", "A primary key on (postId, userId)", "Rate limiting", "A cache"],
    "answer": 1,
    "explanation": "The key makes likes idempotent."
  },
  {
    "question": "What turns 100k likes per second into a manageable write rate?",
    "options": ["Bigger databases", "Aggregating deltas in memory and flushing once per second", "Dropping likes", "Client batching only"],
    "answer": 1,
    "explanation": "Batching collapses many increments into one."
  },
  {
    "question": "Why shard a single post's counter?",
    "options": ["To hide counts", "One key on one node can't absorb a celebrity post's write rate", "For backups", "To support unlikes"],
    "answer": 1,
    "explanation": "Splitting spreads writes across nodes; reads sum the shards."
  },
  {
    "question": "How should live counts be pushed to viewers?",
    "options": ["One message per like", "Coalesced updates at most once per second", "Email", "Hourly"],
    "answer": 1,
    "explanation": "Viewers only need the latest number."
  }
]
```
