---
title: Online Poker
seoTitle: Design an Online Card Game like Poker or Blackjack
description: Design an online card game like poker or blackjack — tables and seating, a server-authoritative game engine, fair shuffling, hidden information, turn timers, chip balances with a ledger, and handling disconnects.
tags: Real-time Updates, Dealing with Contention
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🃏 What is Online Poker?
An online poker (or blackjack) site lets players sit at virtual tables and play hands in real time against each other (or a dealer). Each hand involves shuffling, dealing hidden cards, rounds of betting with timers, and settling chips at the end. Because real money or valuable chips are involved, the game must be fair, cheat-resistant and never lose track of a single chip.
:::

### Functional Requirements

**Core Requirements**

1. Players should be able to find a table, buy in with chips and take a seat.
2. The game should deal cards and run betting rounds (check, bet, call, raise, fold) with turn timers.
3. Each player sees only their own hidden cards; shared cards are revealed to all at the right time.
4. At the end of a hand, pots are awarded and chip balances updated.
5. Players who disconnect should be handled fairly.

**Below the line (out of scope):**

- Tournaments with many tables (mentioned briefly).
- Payments and cash-outs.
- Chat and social features.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Fairness: shuffles are unpredictable and unbiased; clients can't see hidden cards.
2. Low latency: actions reflected for all players in < 200 ms.
3. Chips are never created or lost; every change is auditable.
4. Scale to ~100k concurrent tables and ~1M players.
5. A server crash mid-hand must not lose chips.

**Below the line (out of scope):**

- Regulatory certification details.

```sketch Card Game Requirements
Functional
- find table, buy in, sit
- deal + betting rounds + timers
- hidden cards per player
- award pots
- handle disconnects

Non-functional
- fair, unpredictable shuffles
- < 200ms actions
- chips never lost
- 100k tables
- survive crashes mid-hand
```

## The Set Up

### Defining the Core Entities

1. **Table**: game type, stakes, seats, current hand, assigned game server.
2. **Seat**: table, player, stack (chips at the table), status (active, sitting out).
3. **Hand**: deck order, cards dealt, betting actions, pots, result — an event log.
4. **Wallet**: player's chip balance outside tables, backed by a ledger.

In object-oriented terms: `Table` holds `Seat`s and runs `Hand`s; a `Hand` uses a `Deck` and a `BettingRound` state machine; a `HandEvaluator` ranks hands; `PotManager` handles side pots.

### API or System Interface

```
GET  /lobby?game=holdem&stakes= -> tables with open seats
POST /tables/:id/seats { seat, buyIn } -> joins the table
WS   /tables/:id
  client -> { action: "raise", amount, handId, seq }
  server -> { type: "deal", yourCards }           (only to that player)
  server -> { type: "action", player, action, pot, nextToAct, deadline }
  server -> { type: "showdown", hands, winners }
POST /tables/:id/leave
```

## High-Level Design

### 1) Tables and seating

The **Lobby Service** lists tables and their open seats. Each table is owned by exactly one **game server** (assigned by consistent hashing or a table directory). Buying in moves chips from the player's **wallet** to their seat stack through a ledger transaction.

### 2) The game engine

The game server runs each table's **state machine** in memory: shuffle, post blinds, deal, betting rounds, community cards, showdown. Clients only send **intents** ("raise 200"); the server validates them against the rules and current state, so a modified client can't act out of turn or bet chips it doesn't have.

```diagram Table server
node p1 0,0 box "Player A"
node p2 0,2 box "Player B"
node gs 1.6,1 box "Game Server|table state machine"
node rng 3.2,-0.3 box "Secure RNG"
node log 3.2,1 circle "Hand Event Log"
node wallet 3.2,2.3 box "Wallet Ledger"
edge p1 <-> gs "intents / views"
edge p2 <-> gs
edge rng -> gs "shuffle"
edge gs -> log
edge gs <-> wallet "buy-in / cash-out"
```

### 3) Hidden information

The server sends each player a **personalised view**: their own hole cards, everyone's actions and the community cards. Other players' hole cards are never sent to a client until showdown, so inspecting network traffic reveals nothing.

### 4) Settling hands

At showdown, the `HandEvaluator` ranks hands and the `PotManager` splits main and side pots. Stack changes are recorded in the hand log; the wallet only changes on buy-in and leaving the table.

## Potential Deep Dives

### 1) How do we make shuffles fair?

:::solution bad Language default random function
#### Approach

Shuffle with a standard pseudo-random generator seeded by the clock.

#### Challenges

Predictable seeds have been exploited in real poker sites to reconstruct the deck.
:::

:::solution good Cryptographically secure RNG
#### Approach

Use a **cryptographically secure** random source with a correct Fisher-Yates shuffle (no modulo bias).

#### Challenges

Players still have to trust the operator.
:::

:::solution great Secure RNG + certification + audit trail
#### Approach

Use a hardware-backed or OS CSPRNG, a verified Fisher-Yates implementation, independent **RNG certification**, and record each hand's deck order in the immutable hand log for audits and disputes. Some games publish a hash of the shuffled deck before the hand and reveal it afterwards, letting players verify the deck wasn't changed mid-hand.

#### Challenges

The deck order in the log is highly sensitive and must be stored securely and revealed only after the hand.
:::

### 2) How do we survive a game server crash?

Each table's events (shuffle, actions, results) are appended to a **durable hand log** before they're broadcast. If a server dies, the table is reassigned and the new server **replays the log** to rebuild the current hand, or, if the hand can't continue safely, **cancels it and returns all bets** to stacks. Because stacks are derived from the log and wallets only change via ledger transactions, no chips are lost or duplicated.

:::tip
Mention action sequence numbers: each client action carries the hand ID and expected sequence, so a delayed or duplicated message after a reconnect is rejected instead of applied twice.
:::

### 3) How do we handle disconnects and timers?

Each turn has a **server-side deadline**; clients show a countdown, but only the server decides. If time runs out, the server auto-checks or folds. A disconnected player gets a short **time bank** to reconnect; their seat stays and they sit out future hands if they don't return. Reconnecting clients receive the full current view.

### Final Design

```diagram Final Design
node players 0,1 box "Players"
node gw 1.4,1 box "WebSocket Gateway"
node lobby 1.4,-0.3 box "Lobby Service"
node dir 2.8,-0.3 circle "Table Directory"
node gs 2.8,1 box "Game Servers|one owner per table"
node log 4.2,1 circle "Hand Logs"
node wallet 4.2,2.3 box "Wallet + Ledger"
node rng 4.2,-0.3 box "Certified RNG"
node fraud 5.6,1 box "Collusion Detection"
edge players <-> gw
edge players <-> lobby
edge lobby <-> dir
edge gw <-> gs
edge gs -> log
edge gs <-> wallet
edge rng -> gs
edge log -> fraud
```

```quiz
[
  {
    "question": "Why must the server be authoritative?",
    "options": ["Clients are slow", "Modified clients could act out of turn or bet chips they don't have", "Servers are cheaper", "For graphics"],
    "answer": 1,
    "explanation": "Clients send intents; the server validates and decides."
  },
  {
    "question": "How do we keep other players' cards secret?",
    "options": ["Encrypt them on the client", "Never send them to a client until showdown", "Hide them in CSS", "Trust players"],
    "answer": 1,
    "explanation": "Each player only receives their own hidden cards."
  },
  {
    "question": "What's wrong with shuffling using a clock-seeded random function?",
    "options": ["It's slow", "The seed can be predicted, revealing the deck order", "It's biased toward aces", "Nothing"],
    "answer": 1,
    "explanation": "Shuffles need a cryptographically secure source."
  },
  {
    "question": "How do we avoid losing chips if a game server crashes mid-hand?",
    "options": ["Hope it doesn't", "Replay the durable hand log or cancel the hand and return bets", "Give everyone extra chips", "Restart the site"],
    "answer": 1,
    "explanation": "Events are logged before they're broadcast."
  }
]
```
