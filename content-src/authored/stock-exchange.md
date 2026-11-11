---
title: Stock Exchange
seoTitle: Design a Stock Exchange Matching Engine
description: Design a stock exchange — order entry, risk checks, an in-memory matching engine with price-time priority, a sequenced event log, market data distribution and deterministic recovery.
tags: Dealing with Contention, Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📈 What is a Stock Exchange?
A stock exchange is where buy and sell orders from brokers meet. Its core is the **matching engine**, which keeps an **order book** per stock and pairs buyers with sellers by price and arrival time. Unlike a brokerage app (which forwards customer orders to exchanges), the exchange itself must be extremely fast, perfectly fair and fully deterministic.
:::

### Functional Requirements

**Core Requirements**

1. Brokers should be able to submit, modify and cancel limit and market orders.
2. The exchange should match orders using price-time priority and report executions.
3. Everyone should receive real-time market data: trades and order book changes.

**Below the line (out of scope):**

- Clearing and settlement (handled by a clearing house).
- Options and derivatives.
- Customer-facing brokerage features.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Very low, predictable latency: matching in microseconds, p99 order-to-ack under ~1 ms.
2. Fairness and determinism: the same input sequence must always produce the same trades.
3. No lost or duplicated orders; every event is auditable.
4. High availability with fast failover during trading hours.

**Below the line (out of scope):**

- Global geo-distribution (exchanges are deliberately in one data centre).

```sketch Exchange Requirements
Functional
- place / modify / cancel orders
- price-time priority matching
- real-time market data

Non-functional
- microsecond matching, ~1ms p99
- deterministic + fair
- nothing lost, fully auditable
- fast failover
```

## The Set Up

### Defining the Core Entities

1. **Order**: broker, symbol, side, type, price, quantity, time-in-force, sequence number.
2. **Order book**: per symbol, bids and asks sorted by price then time.
3. **Execution (trade)**: buy order, sell order, price, quantity.
4. **Event log**: the ordered sequence of every accepted input and resulting output.

### API or System Interface

Brokers use a binary protocol (FIX or a native protocol) over persistent TCP sessions:

```
NewOrder { clientOrderId, symbol, side, type, price, qty }
CancelOrder { clientOrderId }
-> ExecutionReport { status: accepted|filled|partial|cancelled|rejected, fills[] }
Market data (UDP multicast): trades, book updates, snapshots
```

## High-Level Design

### 1) Brokers submit orders

Brokers connect to **gateways** that authenticate sessions, validate messages and run **pre-trade risk checks** (credit limits, price bands, fat-finger quantity limits). Valid orders go to the **sequencer**.

### 2) Orders are sequenced and matched

The **sequencer** stamps every order with a global sequence number and writes it to a replicated **event log**. The **matching engine** consumes the log in order. Each symbol's order book lives **in memory** on a single thread: an incoming buy is matched against the lowest asks while their price ≤ the buy's limit, oldest first at each price; whatever is left rests on the book.

```diagram Order path
node broker 0,1 box "Broker"
node gw 1.4,1 box "Gateway|session + risk"
node seq 2.8,1 box "Sequencer"
node log 2.8,2.3 circle "Event Log"
node me 4.2,1 box "Matching Engine|in-memory books"
edge broker <-> gw "FIX / binary"
edge gw -> seq
edge seq -> log
edge seq -> me "ordered input"
```

### 3) Executions and market data go out

The matching engine emits executions and book changes as output events. Execution reports go back through the gateways to the brokers involved. A **market data publisher** turns book changes into feeds sent over **UDP multicast**, so every subscriber gets the same data at the same time.

## Potential Deep Dives

### 1) How do we make matching fast and deterministic?

:::solution bad A database-backed order book
#### Approach

Store orders in a relational database and match with transactions and row locks.

#### Challenges

Milliseconds per order, lock contention on popular stocks, and nondeterministic ordering between concurrent transactions.
:::

:::solution good In-memory book, single thread per symbol
#### Approach

Keep each order book in memory, partition symbols across engine threads, and process each symbol's orders on one thread — no locks, strict ordering.

#### Challenges

Durability now depends on something else, since memory is lost on a crash.
:::

:::solution great Sequenced log + deterministic state machine
#### Approach

Treat the engine as a **deterministic state machine** over the sequenced event log. Inputs are durable in the log *before* matching, so after a crash the engine replays the log (from a snapshot) to rebuild books exactly. A **hot standby** consumes the same log in parallel and holds identical state, so failover takes milliseconds. Engines avoid garbage collection pauses, pre-allocate memory, and pin threads to cores for predictable latency.

#### Challenges

Everything must be truly deterministic — no wall-clock reads or random numbers inside the engine; time comes from the sequencer.
:::

### 2) How do we keep the event log both durable and fast?

Writing to disk on every order is too slow. Instead the sequencer **replicates** each event to standby machines over a low-latency network and waits for acknowledgement from a quorum (or a designated replica) before releasing it to the engine. Disks are written asynchronously from the replicas. This is the Raft/primary-backup idea applied at microsecond scale.

:::tip
Mention that exchanges co-locate brokers in the same data centre and equalise cable lengths — fairness is a physical-layer concern too.
:::

### 3) How do we distribute market data fairly?

TCP to thousands of subscribers would mean sending the same bytes thousands of times, with some clients receiving them later. **UDP multicast** sends each packet once to everyone. Since UDP can drop packets, every message carries a **sequence number**; subscribers detect gaps and recover from a **retransmission** service or a periodic **snapshot** feed.

### Final Design

```diagram Final Design
node broker 0,1 box "Brokers"
node gw 1.4,1 box "Gateways|auth · risk"
node seq 2.8,1 box "Sequencer"
node rep 2.8,2.4 circle "Replicated Log"
node me 4.2,1 box "Matching Engine|primary"
node standby 4.2,2.4 box "Hot Standby"
node md 5.6,1 box "Market Data|UDP multicast"
node subs 5.6,-0.3 box "Subscribers"
edge broker <-> gw
edge gw -> seq
edge seq -> rep
edge seq -> me
edge rep -> standby
edge me -> md
edge md -> subs
```

```quiz
[
  {
    "question": "What does price-time priority mean?",
    "options": ["Biggest orders first", "Best price matches first; at the same price, the earliest order wins", "Random matching", "Brokers pay for priority"],
    "answer": 1,
    "explanation": "It's the standard fairness rule for order books."
  },
  {
    "question": "Why run each symbol's book on a single thread?",
    "options": ["Threads are expensive", "No locks are needed and the order of operations is strictly defined", "It saves memory", "Regulations require it"],
    "answer": 1,
    "explanation": "Single-threaded processing is fast and deterministic."
  },
  {
    "question": "How does the engine recover after a crash?",
    "options": ["Ask brokers to resend", "Replay the sequenced event log from a snapshot", "Start with empty books", "Restore yesterday's backup"],
    "answer": 1,
    "explanation": "A deterministic engine fed the same log reaches the same state."
  },
  {
    "question": "Why use UDP multicast for market data?",
    "options": ["It's encrypted", "Every subscriber receives each packet at the same time, sent only once", "It's reliable", "It's cheaper to license"],
    "answer": 1,
    "explanation": "Sequence numbers and retransmission services handle the occasional drop."
  }
]
```
