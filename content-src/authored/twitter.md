---
title: Twitter
seoTitle: Design a Microblogging Platform Like Twitter
description: Design Twitter — posting tweets, following users, a home timeline served in milliseconds, and handling celebrity fan-out.
tags: Scaling Reads, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Uber, Coupang | 0
---

## Understanding the Problem

:::definition 🐦 What is Twitter?
Twitter (now X) is a microblogging platform where users post short messages — tweets — and read a home timeline of recent tweets from the accounts they follow.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to post a tweet (280 characters, optional media).
2. Users should be able to follow and unfollow other users.
3. Users should be able to view a home timeline of recent tweets from people they follow.
4. Users should be able to like a tweet and see like counts.

**Below the line (out of scope):**

- Search, trends and recommendations.
- Direct messages and notifications.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Timelines should load in < 200ms.
2. Availability over consistency — a tweet can take a few seconds to appear in followers' timelines.
3. Scale to 300M daily users reading ~100 timelines each, and ~500M tweets per day.
4. Handle accounts with 100M+ followers.

**Below the line (out of scope):**

- Content moderation.

```sketch Twitter Requirements
Functional
- post tweets
- follow / unfollow
- home timeline
- likes + counts

Non-functional
- timeline < 200ms
- availability >> consistency
- 300M DAU, 500M tweets/day
- celebrities with 100M followers
```

## The Set Up

### Defining the Core Entities

1. **User**: an account.
2. **Tweet**: text, media references, author, timestamp, counters.
3. **Follow**: follower → followee edge.
4. **Like**: user → tweet edge.

### API or System Interface

```
POST   /tweets                  { "text": "...", "mediaIds": [] } -> Tweet
POST   /users/:id/follow
DELETE /users/:id/follow
GET    /timeline?cursor        -> Tweet[]
POST   /tweets/:id/like
```

## High-Level Design

### 1) Users should be able to post tweets

The **Tweet Service** stores tweets in a database partitioned by tweet ID. Media is uploaded directly to blob storage via presigned URLs and served through a CDN.

### 2) Users should be able to follow other users

The **Graph Service** stores follow edges in two tables (or a table and an index): `following(userId → followeeId)` and `followers(userId → followerId)`, so both directions are cheap to query.

### 3) Users should be able to view their home timeline

The naive approach computes the timeline on read: fetch everyone I follow, pull their recent tweets, merge by time. With hundreds of followees and a 200ms budget, that's too slow at scale — so we precompute timelines.

```diagram Timeline fan-out on write
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node tweet 2.4,0.3 box "Tweet Service"
node tl 2.4,1.7 box "Timeline Service"
node q 3.7,0.3 circle "Queue"
node fan 4.9,0.3 box "Fan-out Workers"
node redis 4.9,1.7 circle "Timeline Cache|(Redis lists)"
node db 3.7,1.7 circle "Tweets DB"
edge client <-> gw
edge gw <-> tweet "POST /tweets"
edge gw <-> tl "GET /timeline"
edge tweet -> q
edge q -> fan
edge fan -> redis "push tweetId|to followers"
edge tl <-> redis
edge tl <-> db "hydrate"
```

### 4) Users should be able to like tweets

Likes are stored as edges for "did I like this?" checks, and counted separately (see deep dive) because popular tweets receive enormous like volumes.

## Potential Deep Dives

### 1) How do we serve timelines fast, including for celebrity followers?

:::solution bad Fan-out on read
#### Approach

Assemble the timeline at request time from each followee's recent tweets.

#### Challenges

Hundreds of queries per timeline load, at 300M users × 100 loads a day — far too expensive.
:::

:::solution good Fan-out on write
#### Approach

When a tweet is posted, workers push its ID onto each follower's timeline list in Redis (capped at ~800 entries). Reading a timeline is one list read plus tweet hydration from cache.

#### Challenges

A celebrity tweet means 100M list writes, delaying delivery and wasting work on inactive accounts.
:::

:::solution great Hybrid fan-out
#### Approach

Fan out on write for normal accounts; skip fan-out for accounts above a follower threshold. At read time, merge the precomputed timeline with recent tweets from the few celebrities the user follows (cached heavily, since everyone reads them). Skip maintaining timelines for users inactive for weeks and rebuild them on their next visit.

#### Challenges

Two code paths and a tunable threshold — the standard trade-off Twitter itself made.
:::

:::pattern Pattern: Scaling Reads
Precomputed timelines trade write amplification for constant-time reads — the right trade when reads dominate.
:::

### 2) How do we count likes on viral tweets?

:::solution bad Increment a counter column on every like
#### Approach

`UPDATE tweets SET likes = likes + 1` per like.

#### Challenges

A viral tweet receives thousands of likes per second, all contending on one row.
:::

:::solution great Sharded counters with async aggregation
#### Approach

Record like events in a log (Kafka); counter workers aggregate them in memory and flush totals periodically. For hot tweets, split the counter into N shards (`tweet:123:likes:0..N`) and sum on read. Displayed counts can lag by a second or two.

#### Challenges

Counts are approximate in real time but converge; the like-edge table remains the source of truth for "did I like it".
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node cdn 0,2.4 circle "CDN|media"
node gw 1.2,1.2 box "API Gateway"
node tweet 2.4,0.2 box "Tweet Service"
node graph 2.4,1.2 box "Graph Service"
node tl 2.4,2.2 box "Timeline Service|- merge celebs"
node kafka 3.7,0.2 circle "Kafka"
node fan 4.9,0.2 box "Fan-out + Counter|Workers"
node redis 4.9,1.5 circle "Redis|timelines, counts"
node db 3.7,1.5 circle "Tweets DB"
node gdb 3.7,2.7 circle "Graph DB"
edge client <-> gw
edge client <-> cdn
edge gw <-> tweet
edge gw <-> graph
edge gw <-> tl
edge tweet -> kafka
edge kafka -> fan
edge fan -> redis
edge tl <-> redis
edge tl <-> db
edge graph <-> gdb
edge tweet <-> db
```

```quiz
[
  {
    "question": "Why does fan-out on write struggle for celebrities?",
    "options": ["Their tweets are longer", "One tweet requires writing to tens of millions of timelines", "They tweet rarely", "Redis can't store their tweets"],
    "answer": 1,
    "explanation": "Write amplification grows with follower count."
  },
  {
    "question": "In a hybrid timeline, how are celebrity tweets included?",
    "options": ["Fanned out like everyone else", "Merged in at read time", "Emailed to followers", "Ignored"],
    "answer": 1,
    "explanation": "Celebrity tweets are fetched and merged when the timeline is read."
  },
  {
    "question": "How should like counts on viral tweets be maintained?",
    "options": ["One UPDATE per like", "Aggregate like events asynchronously, sharding hot counters", "Count likes on every read", "Store counts on the client"],
    "answer": 1,
    "explanation": "Batching and sharding avoid contention on a single hot row."
  },
  {
    "question": "Why store follow edges in both directions?",
    "options": ["For backups", "Timelines need 'who do I follow' and fan-out needs 'who follows me'", "To save space", "It's required by Redis"],
    "answer": 1,
    "explanation": "Each direction serves a different hot query."
  }
]
```
