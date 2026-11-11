---
title: Gaming Leaderboard
seoTitle: Design a Real-Time Gaming Leaderboard
description: Design a real-time leaderboard for an online game — ranking hundreds of millions of players, showing top players and a player's own rank, handling score write bursts, and periodic seasons.
tags: Scaling Reads, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🏆 What is a Gaming Leaderboard?
A leaderboard ranks players by score — globally, by region, or among friends — and updates as matches finish. Players want to see the top of the board and, just as importantly, where they stand and who is just above and below them.
:::

### Functional Requirements

**Core Requirements**

1. The game should be able to submit a player's score when a match ends.
2. Players should be able to view the top N players (e.g. top 100).
3. Players should be able to see their own rank and the players around them.
4. Leaderboards should reset for each season (e.g. monthly), keeping past results.

**Below the line (out of scope):**

- Anti-cheat validation of scores.
- Friends-only leaderboards (discussed briefly as an extension).
- Match-making.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Rank updates should be visible within a second or two of a match ending.
2. Reads (top N, my rank) in under ~50 ms.
3. Scale to ~500M players, ~50M daily active, with bursts of tens of thousands of score updates per second.
4. Scores must not be lost; the board must be rebuildable.

**Below the line (out of scope):**

- Exact ranks for players far down the board (approximate is fine).

```sketch Leaderboard Requirements
Functional
- submit score after match
- view top N
- my rank + neighbours
- seasonal resets

Non-functional
- visible within ~1-2s
- reads < 50ms
- 500M players, bursty writes
- never lose scores
```

## The Set Up

### Defining the Core Entities

1. **Player**: ID, display name, region.
2. **Score**: a player's score for a given leaderboard and season.
3. **Leaderboard**: a ranking scope — `global:season-12`, `region:eu:season-12`.

### API or System Interface

```
POST /leaderboards/:boardId/scores { playerId, score }        (from game servers)
GET  /leaderboards/:boardId/top?limit=100                      -> [{ rank, player, score }]
GET  /leaderboards/:boardId/players/:playerId?around=5          -> { rank, score, neighbours }
```

Scores are submitted by trusted **game servers**, never directly by clients.

## High-Level Design

### 1) Submit a score

When a match ends, the game server calls the **Score Service**, which writes the score durably to a **Scores DB** and updates the ranking structure.

### 2) View the top N

Ranking needs a structure that keeps players sorted as scores change. A database `ORDER BY score DESC LIMIT 100` works with an index, but computing **a player's rank** means counting everyone above them — expensive for hundreds of millions of rows.

A **Redis sorted set** fits this exactly: `ZADD board score playerId` is O(log N), `ZREVRANGE board 0 99` returns the top 100, and `ZREVRANK board playerId` returns a rank in O(log N).

```diagram Score updates and reads
node game 0,1 box "Game Servers"
node score 1.5,1 box "Score Service"
node db 3,2 circle "Scores DB|(source of truth)"
node redis 3,0 circle "Redis|sorted sets"
node client 4.5,0 box "Players"
edge game -> score "match result"
edge score -> db "persist"
edge score -> redis "ZADD"
edge client <-> redis "top / my rank"
```

### 3) See my rank and neighbours

`ZREVRANK` gives the player's rank `r`, then `ZREVRANGE board r-5 r+5 WITHSCORES` returns the players around them. Player names and avatars are fetched from a cache and joined in the service.

### 4) Seasonal resets

Each season is a **new key** (`global:season-13`), so a reset is instant: new scores go to the new board. The finished season's final standings are snapshotted to the database for history, and the old key expires.

## Potential Deep Dives

### 1) How do we rank 500 million players?

A single sorted set with 500M members needs ~50-60 GB of memory and all writes land on one Redis node.

:::solution bad One huge sorted set
#### Approach

Keep every player in a single global sorted set on one large Redis instance.

#### Challenges

One node handles every write and holds all memory; failover of a 60 GB instance is slow, and it can't scale further.
:::

:::solution good Shard by score range
#### Approach

Split the board into shards by score range (0-999, 1000-1999, …). A player's global rank is their rank within their shard plus the sizes of all higher shards (cheap `ZCARD` calls).

#### Challenges

Scores cluster unevenly, so ranges need rebalancing, and players move between shards as their score changes.
:::

:::solution great Exact top, approximate tail
#### Approach

Keep an **exact sorted set for the top ~100k players**, which is what people actually compare against. For everyone else, maintain a **score histogram** (count of players per score bucket) and estimate rank from the bucket counts — "you're in the top 12%" or "rank ~2,431,000". Exact per-player scores remain in the database. Shard the histogram updates by player to spread writes.

#### Challenges

Ranks far down the board are approximate — but nobody distinguishes rank 2,431,118 from 2,431,000, and the product can show percentiles instead.
:::

### 2) How do we handle bursts of score updates?

Tournaments and the end of popular events produce huge write spikes. The Score Service writes scores to a **Kafka** topic partitioned by player ID; consumers apply them to the database and Redis. Each update is idempotent (`ZADD` with the player's best or latest score — use `GT` to keep only higher scores), so redelivery is harmless and replaying the log can **rebuild the board** if Redis is lost.

:::tip
Mention that Redis is a derived view. The database (or the Kafka log) is the source of truth, so a corrupted or lost Redis node can be rebuilt.
:::

### 3) How do we serve heavy read traffic on the top 100?

Every player opening the leaderboard asks for the same top 100. Cache that response for 1-2 seconds in the service or CDN, so Redis serves it once per interval regardless of traffic. "My rank" is per player and served directly by Redis read replicas.

### 4) What about regional and friends leaderboards?

Regional boards are just more sorted sets (`region:eu:season-12`), updated alongside the global one. Friends leaderboards are small, so compute them on read: fetch the friend list, `ZMSCORE` their scores from the global set and sort in memory.

### Final Design

```diagram Final Design
node game 0,1 box "Game Servers"
node score 1.4,1 box "Score Service"
node kafka 2.8,1 box "Kafka|partitioned by player"
node worker 4.2,1 box "Rank Workers"
node db 5.6,2.2 circle "Scores DB"
node redis 5.6,0 circle "Redis Cluster|top-100k sorted sets|+ histograms"
node read 4.2,-0.9 box "Leaderboard API|cached top N"
node client 2.8,-0.9 box "Players"
edge game -> score
edge score -> kafka
edge kafka -> worker
edge worker -> db
edge worker -> redis
edge read <-> redis
edge client <-> read
```

```quiz
[
  {
    "question": "Why is a Redis sorted set a good fit for a leaderboard?",
    "options": ["It's persistent by default", "It keeps members ordered by score with O(log N) updates and rank lookups", "It supports SQL", "It encrypts scores"],
    "answer": 1,
    "explanation": "ZADD, ZREVRANGE and ZREVRANK map directly to the leaderboard operations."
  },
  {
    "question": "How can seasons be reset instantly?",
    "options": ["Delete every member one by one", "Write new scores to a new per-season key", "Restart Redis", "Set all scores to zero"],
    "answer": 1,
    "explanation": "A new key starts empty; the old one is snapshotted and expired."
  },
  {
    "question": "What's a practical way to rank players far down a 500M-player board?",
    "options": ["Exact global sort on every request", "Estimate rank from a score histogram", "Ignore them", "Rank alphabetically"],
    "answer": 1,
    "explanation": "Bucket counts give a cheap, good-enough rank or percentile."
  },
  {
    "question": "Why route score updates through Kafka?",
    "options": ["Kafka ranks players", "To absorb bursts and allow rebuilding the board by replay", "To reduce read latency", "To store avatars"],
    "answer": 1,
    "explanation": "The log smooths spikes and acts as a source for rebuilding derived views."
  }
]
```
