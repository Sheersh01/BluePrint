---
title: Online Chess
seoTitle: Design an Online Chess Platform Like Chess.com
description: Design online chess — skill-based matchmaking, real-time moves over WebSockets, server-authoritative game state, clocks, and handling disconnects.
tags: Real-time Updates, Dealing with Contention
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Chess.com, Meta | 4
---

## Understanding the Problem

:::definition ♟️ What is Online Chess?
Online chess platforms like Chess.com and Lichess pair players of similar skill and let them play live games with chess clocks, with every move appearing instantly on both boards.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to request a game and be matched with an opponent of similar rating for a given time control.
2. Players should be able to make moves, which appear on the opponent's board in real time.
3. The game should enforce chess clocks and end on checkmate, resignation, draw, or timeout.
4. Players' ratings should update after each game.

**Below the line (out of scope):**

- Spectating and chat.
- Puzzles, analysis engines and tournaments.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Moves should reach the opponent with low latency (< 200ms).
2. Game state must be consistent and authoritative — no illegal moves, no forked games.
3. Matchmaking should find an opponent within a few seconds for popular time controls.
4. Scale to 10M concurrent games.

**Below the line (out of scope):**

- Cheat (engine) detection.

```sketch Online Chess Requirements
Functional
- match by rating + time control
- real-time moves
- clocks; game end conditions
- rating updates

Non-functional
- move latency < 200ms
- authoritative, consistent game state
- match within seconds
- 10M concurrent games
```

## The Set Up

### Planning the Approach

The design has three parts: **matchmaking**, **live gameplay** (a stateful, real-time session between exactly two players), and **post-game processing** (ratings, storage). Gameplay must be server-authoritative so clients can't cheat by sending illegal moves or tampering with clocks.

### Defining the Core Entities

1. **Player**: a user with a rating per time control.
2. **Game**: two players, time control, current position (FEN), move list, clocks, status.
3. **Move**: a move in a game, with the clock times when it was made.
4. **Match Request**: a player waiting for an opponent.

```sketch Chess Entities
Core Entities
- Player (rating)
- Game
- Move
- Match Request
```

### API or System Interface

```
POST /match { "timeControl": "5+0" } -> { "requestId" }   // result pushed over WebSocket

WS /games/:gameId
-> { "type": "move", "uci": "e2e4", "ply": 1 }
-> { "type": "resign" }
<- { "type": "move", "uci": "e7e5", "ply": 2, "clocks": { "white": 291.2, "black": 298.7 } }
<- { "type": "gameOver", "result": "1-0", "reason": "checkmate" }
```

## High-Level Design

### 1) Users should be able to get matched with an opponent

A **Matchmaking Service** keeps a pool of waiting players per time control. It pairs players whose ratings are close, creates a Game, and notifies both players (over their WebSocket connections) with the game ID.

```diagram Matchmaking
node c 0,1 box "Clients"
node ws 1.3,1 box "Connection Gateway|(WebSockets)"
node mm 2.6,1 box "Matchmaking Service"
node pool 3.9,0.4 circle "Waiting Pools|(Redis sorted sets)"
node games 3.9,1.6 box "Game Service"
edge c <-> ws
edge ws <-> mm "POST /match"
edge mm <-> pool
edge mm -> games "create game"
```

### 2) Players should be able to make moves in real time

Both players connect to the **Game Service** instance that owns their game. When a move arrives, the server validates it against the current position, updates the clocks, appends it to the move list, and pushes it to the opponent.

```diagram Live game
node w 0,0.4 box "White"
node b 0,1.6 box "Black"
node gs 1.6,1 box "Game Service|- validate move|- update clocks|- broadcast"
node store 3,1 circle "Game Store"
edge w <-> gs "WebSocket"
edge b <-> gs "WebSocket"
edge gs -> store "append move"
```

### 3) The game should enforce clocks and end conditions

The server is the source of truth for time. When a move arrives, it subtracts the elapsed time (since the opponent's last move) from the mover's clock. The server also schedules a timer for the current player's remaining time so it can declare a timeout even if no message arrives. Checkmate, stalemate and draws are detected by the move validator.

### 4) Ratings should update after each game

When a game ends, the Game Service emits a `game_finished` event. A **Rating Service** consumes it and updates both players' ratings (Elo or Glicko-2) and stores the finished game for history.

## Potential Deep Dives

### 1) How do we match players quickly and fairly?

:::solution bad Scan all waiting players for each request
#### Approach

On each request, iterate over everyone waiting in the time control to find the closest rating.

#### Challenges

O(n) per request with thousands waiting, and concurrent requests can grab the same opponent.
:::

:::solution great Sorted pools with an expanding rating window
#### Approach

Keep a Redis sorted set per time control with score = rating. To match, query `ZRANGEBYSCORE` within ±50 of the player's rating; if nobody is found, widen the window every couple of seconds (±100, ±200…). Remove both players **atomically** (a Lua script or `ZREM` returning 1 for both) so two matchmakers can't pair the same person twice.

#### Challenges

Rare time controls have thin pools; the expanding window trades match quality for wait time, which is the right trade for players.
:::

### 2) Where does game state live, and how do moves stay consistent?

:::solution bad Clients send the full board after each move
#### Approach

Trust the client to compute and send the new position.

#### Challenges

Trivial to cheat, and two clients can disagree about the position.
:::

:::solution great Single authoritative owner per game
#### Approach

Each game is owned by exactly one Game Service instance (assigned by consistent hashing on gameId). It keeps the live state in memory, validates every move, and uses the move number (`ply`) to reject duplicates or out-of-turn moves. Every accepted move is appended to a durable store (e.g. Redis with AOF, or a database) before being acknowledged, so a crashed instance's games can be reloaded by the new owner.

#### Challenges

Ownership changes must be fenced so two instances never accept moves for the same game.
:::

### 3) How do we handle disconnects?

Mobile connections drop constantly. The player's clock keeps running while disconnected (that's the rule in real chess), and the client reconnects automatically with backoff, re-subscribes to the game, and receives the full move list to resync. If a player stays disconnected beyond a grace period while their clock runs out, they lose on time — the server's timer handles this without any client involvement.

:::tip
Latency compensation matters at fast time controls. Many platforms measure each client's round-trip time and refund a small amount of "lag" to the mover's clock so bullet games feel fair.
:::

### Final Design

```diagram Final Design
node c 0,1.2 box "Clients"
node ws 1.3,1.2 box "Connection Gateway|- route by gameId"
node mm 2.6,0.2 box "Matchmaking"
node pool 3.9,0.2 circle "Pools (Redis)"
node gs 2.6,1.4 box "Game Service|- authoritative state|- clocks & timers"
node store 3.9,1.4 circle "Game Store"
node q 2.6,2.6 circle "Events"
node rating 3.9,2.6 box "Rating Service"
node db 5.1,2.6 circle "Players &|History DB"
edge c <-> ws
edge ws <-> mm
edge mm <-> pool
edge ws <-> gs
edge gs -> store
edge gs -> q "game_finished"
edge q -> rating
edge rating -> db
```

```quiz
[
  {
    "question": "Why must the server, not the client, validate moves and keep the clock?",
    "options": ["Clients are too slow", "Otherwise players could send illegal moves or tamper with time", "Browsers can't run chess rules", "It reduces bandwidth"],
    "answer": 1,
    "explanation": "A server-authoritative game prevents cheating and keeps both boards consistent.",
    "section": "2-where-does-game-state-live-and-how-do-moves-stay-consistent"
  },
  {
    "question": "How does matchmaking balance match quality and wait time?",
    "options": ["Random pairing", "An expanding rating window over a sorted pool", "Only exact rating matches", "First-come-first-served regardless of rating"],
    "answer": 1,
    "explanation": "Start with a narrow window and widen it over time until an opponent is found.",
    "section": "1-how-do-we-match-players-quickly-and-fairly"
  },
  {
    "question": "How is a timeout detected if the player simply stops sending messages?",
    "options": ["The opponent reports it", "A server-side timer for the remaining clock time", "The client sends a timeout message", "It isn't detected"],
    "answer": 1,
    "explanation": "The server schedules a timer for the current player's remaining time."
  },
  {
    "question": "What does the move number (ply) in each move message protect against?",
    "options": ["Duplicate or out-of-turn moves", "Slow networks", "Rating inflation", "Spectators"],
    "answer": 0,
    "explanation": "The server only accepts the expected next ply, so retries and races can't apply a move twice."
  }
]
```
