---
title: Multiplayer Game
seoTitle: Design a Real-Time Multiplayer Game Backend
description: Design the backend for a real-time multiplayer game — matchmaking, dedicated game servers with fixed tick rates, client prediction and lag compensation, state synchronisation over UDP, anti-cheat, and global server fleets.
tags: Real-time Updates, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎮 What is a Multiplayer Game Backend?
In a real-time multiplayer game — a shooter, battle royale or racing game — players in the same match see each other move and act within tens of milliseconds. The backend matches players into games, runs an authoritative **game server** for each match that simulates the world many times per second, keeps every client's view in sync despite network lag, and stops cheaters. Turn-based games like chess are much simpler (see Online Chess).
:::

### Functional Requirements

**Core Requirements**

1. Players should be matched into a game with others of similar skill and region.
2. Each match runs on a server that simulates the game and syncs state to all players in real time.
3. Players' actions (move, shoot) should feel instant, and hits should be judged fairly.
4. Results should update player stats and rankings after the match.

**Below the line (out of scope):**

- Voice chat.
- Store and inventory.
- Game design and rendering.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Latency: round trip to the game server < 50-80 ms for most players.
2. Consistency: all players agree on important outcomes (who hit whom, who won).
3. Cheat resistance: clients can't move through walls, teleport, or see hidden information.
4. Scale to ~1M concurrent players in matches of 10-100, with daily peaks and launch spikes.
5. Matchmaking in < 60 seconds.

**Below the line (out of scope):**

- Perfect fairness across very different network conditions.

```sketch Multiplayer Requirements
Functional
- skill + region matchmaking
- server-run matches, real-time sync
- instant-feeling actions, fair hits
- stats + rankings

Non-functional
- < 50-80ms RTT
- agree on outcomes
- cheat resistant
- 1M concurrent players
- match in < 60s
```

## The Set Up

### Defining the Core Entities

1. **Player**: ID, skill rating, region, party.
2. **Match ticket**: a player or party waiting for a match, with criteria.
3. **Match**: game mode, players, assigned game server, status.
4. **Game server**: a process on a host in a region running one or more matches.
5. **Snapshot**: the world state at a tick (positions, health, events).

### API or System Interface

```
POST /matchmaking/tickets { partyId, mode, region? } -> ticketId
GET  /matchmaking/tickets/:id -> { status, server: { ip, port, token } }
UDP  client -> server: inputs { tick, buttons, aim }     (~60 per second)
UDP  server -> client: snapshots { tick, entities delta } (20-60 per second)
POST /matches/:id/results   (server -> backend)
```

## High-Level Design

### 1) Matchmaking

Players submit **tickets** to the matchmaker, which measures each player's latency to nearby regions (pings to region beacons) and groups tickets with similar skill in the same region. The search widens gradually (skill range, regions) the longer a ticket waits. When a match is formed, it asks the **fleet allocator** for a game server.

### 2) Dedicated game servers

The allocator picks a ready server in that region from a pool (pre-warmed, often on Kubernetes with Agones) and hands each player the server's address and a **join token**. Clients connect over **UDP** directly to the game server.

```diagram Match flow
node client 0,1 box "Game Client"
node mm 1.6,-0.3 box "Matchmaker|skill + latency"
node alloc 3.2,-0.3 box "Fleet Allocator"
node gs 3.2,1 box "Game Server|tick loop"
node stats 4.8,1 box "Stats + Rankings"
edge client <-> mm "ticket"
edge mm -> alloc "need server"
edge alloc -> gs "assign match"
edge client <-> gs "UDP inputs / snapshots"
edge gs -> stats "results"
```

### 3) The tick loop

The game server runs a fixed **tick rate** (e.g. 30-60 Hz). Each tick it applies received player inputs, simulates physics and rules, and sends each client a **snapshot** — usually a **delta** from the last snapshot that client acknowledged, containing only entities relevant to them.

### 4) Results

At the end of the match, the server reports results to the backend, which updates stats, ratings and rewards. The server then returns to the pool.

## Potential Deep Dives

### 1) How do we make actions feel instant despite latency?

:::solution bad Wait for the server
#### Approach

The client sends input and only moves the character when the server's snapshot comes back.

#### Challenges

Every action is delayed by a full round trip (50-150 ms) — the game feels sluggish.
:::

:::solution good Client-side prediction
#### Approach

The client applies its own inputs immediately, predicting the result, and **reconciles** when the authoritative snapshot arrives: it rewinds to the server state and replays unacknowledged inputs.

#### Challenges

Other players still appear jumpy, and hits on moving targets feel unfair because each player sees the world slightly in the past.
:::

:::solution great Prediction + interpolation + lag compensation
#### Approach

Combine client prediction for the local player with **entity interpolation** for others (render them ~100 ms in the past, smoothly between snapshots). On the server, use **lag compensation** for hits: when a shot arrives, rewind other players to where the shooter saw them (based on the shooter's latency and interpolation delay), check the hit, then restore. The server remains authoritative throughout.

#### Challenges

Rewinding must be capped (e.g. 200 ms), or high-latency players get unfair advantages ("shot behind a wall").
:::

### 2) How do we keep bandwidth manageable?

Sending the full world to every player 60 times a second is impossible for large matches. Use **delta compression** against acknowledged snapshots, **quantise** values (positions to centimetres, angles to a few bits), and apply **interest management**: each client only gets entities near them or in view, at lower rates for distant ones. Inputs are tiny and sent redundantly (the last few inputs in each packet) so a lost UDP packet doesn't matter.

:::tip
Explain why UDP: TCP retransmits lost packets in order, so one lost packet delays everything behind it. In games, a newer snapshot makes the old one irrelevant, so we prefer losing it.
:::

### 3) How do we resist cheating?

The **server is authoritative**: it validates movement (speed limits, collisions) and decides hits, so modified clients can't teleport or award themselves kills. Interest management doubles as **anti-wallhack**: clients don't receive positions of enemies they can't possibly see. Client-side anti-cheat detects memory tampering and aimbots, and server-side analytics flag statistically impossible performance for review.

### Final Design

```diagram Final Design
node client 0,1 box "Clients"
node beacon 1.4,-0.3 box "Region Ping Beacons"
node mm 2.8,-0.3 box "Matchmaker"
node alloc 4.2,-0.3 box "Fleet Allocator|warm pools per region"
node gs 2.8,1 box "Game Servers|authoritative ticks"
node fleet 4.2,1 circle "Regional Fleets"
node stats 2.8,2.3 box "Stats + Ratings"
node ac 4.2,2.3 box "Anti-cheat Analytics"
edge client -> beacon "latency"
edge client <-> mm
edge mm -> alloc
edge alloc -> fleet
edge client <-> gs "UDP"
edge gs -> stats
edge gs -> ac
```

```quiz
[
  {
    "question": "Why do real-time games usually use UDP?",
    "options": ["It's encrypted", "Lost packets aren't retransmitted, so new state isn't delayed by old state", "It's more reliable", "Browsers require it"],
    "answer": 1,
    "explanation": "Newer snapshots replace older ones, so waiting for retransmits hurts."
  },
  {
    "question": "What is client-side prediction?",
    "options": ["Guessing the winner", "Applying your own inputs immediately and reconciling with the server later", "Predicting lag", "AI opponents"],
    "answer": 1,
    "explanation": "It hides the round-trip delay for the local player."
  },
  {
    "question": "What does lag compensation do?",
    "options": ["Speeds up the network", "Rewinds other players to where the shooter saw them when checking hits", "Kicks laggy players", "Reduces tick rate"],
    "answer": 1,
    "explanation": "It makes hits fair for players with latency."
  },
  {
    "question": "How does interest management help with cheating?",
    "options": ["It doesn't", "Clients don't receive positions of enemies they can't see", "It bans players", "It encrypts packets"],
    "answer": 1,
    "explanation": "Data that isn't sent can't be exploited by wallhacks."
  }
]
```
