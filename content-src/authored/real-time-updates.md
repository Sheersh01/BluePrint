---
title: Real-time Updates
subtitle: How to push changes to users the moment they happen — polling, long polling, SSE, WebSockets and the pub/sub layer behind them.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Chat messages, live scores, collaborative cursors, ride locations, stock prices — a huge share of interview questions need the server to tell clients about something *as it happens*. HTTP was built for the client to ask and the server to answer, so real-time updates require deliberate design on two hops: **server → client** (how the update reaches the device) and **source → server** (how the server holding the connection learns about the update).

## The Problem

Imagine a chat app. Alice sends a message; it lands on server A. Bob is connected to server B. Two things must happen:

1. Server B must find out a message for Bob exists.
2. Server B must deliver it to Bob's device without Bob asking.

Most candidates only think about the second hop. Interviewers are usually more interested in the first.

```diagram The two hops of real-time delivery
node alice 0,1 box "Alice"
node a 1.3,1 box "Server A"
node ps 2.6,1 circle "Pub/Sub"
node b 3.9,1 box "Server B"
node bob 5.2,1 box "Bob"
edge alice -> a "send"
edge a -> ps "hop 1:|source -> server"
edge ps -> b
edge b -> bob "hop 2:|server -> client"
```

## The Solution

### Hop 2: getting updates to the client

:::solution bad Simple polling
#### Approach

The client asks "anything new?" every few seconds.

#### Challenges

Most requests return nothing, so it wastes server capacity, and updates are delayed by up to the poll interval. It is, however, dead simple and works everywhere — a perfectly good answer when updates are infrequent and a few seconds of delay is fine.
:::

:::solution good Long polling
#### Approach

The client makes a request that the server holds open until there is something to send (or a timeout, say 30s). On response, the client immediately reconnects.

#### Challenges

Near-real-time with plain HTTP, but each message costs a full request cycle, and bursts of updates cause reconnect storms.
:::

:::solution great Server-Sent Events (SSE)
#### Approach

A single long-lived HTTP response streams events from server to client. Browsers reconnect automatically and resume using `Last-Event-ID`.

#### Challenges

One-directional only — clients still send data with normal requests, which is exactly right for feeds, notifications, live comments and LLM token streaming. Some proxies buffer responses and need configuration.
:::

:::solution great WebSockets
#### Approach

A persistent, bidirectional connection over TCP. Ideal when the client sends frequent messages too: chat, multiplayer games, collaborative editing.

#### Challenges

Stateful connections complicate load balancing and deploys (draining connections), and you must implement heartbeats and reconnection yourself.
:::

:::tip
Default to SSE when updates flow mostly from server to client, and WebSockets when both sides talk constantly. Say *why* in the interview — the choice signals that you understand the traffic pattern.
:::

### Hop 1: getting updates to the right server

With millions of connections spread across many servers, the server holding a user's connection must learn about events produced elsewhere.

:::solution bad Every server polls the database
#### Approach

Each connection server queries for new data for its users.

#### Challenges

Load grows with connections × poll rate, and latency is bounded by the interval.
:::

:::solution good Consistent hashing of users to servers
#### Approach

Route each user (or each chat room / document) to a deterministic server, so producers know exactly where to send updates.

#### Challenges

Rebalancing on scale-up and failures moves connections, and a hot room can overload one server.
:::

:::solution great Pub/sub fan-out
#### Approach

Connection servers subscribe to channels for the users or topics their clients care about (Redis Pub/Sub, NATS, or Kafka for durable streams). Producers publish to the channel; the broker delivers to whichever servers are subscribed.

#### Challenges

Plain pub/sub is fire-and-forget; if a client is offline the message is missed, so pair it with durable storage (an inbox) that clients sync from on reconnect.
:::

## When to Use in Interviews

Reach for this pattern whenever a requirement says "see changes in real time", "live", or "instantly":

- [WhatsApp](/learn/system-design/problem-breakdowns/whatsapp) — WebSockets plus pub/sub between chat servers.
- [FB Live Comments](/learn/system-design/problem-breakdowns/fb-live-comments) — SSE fan-out to many viewers.
- [Uber](/learn/system-design/problem-breakdowns/uber) — streaming driver locations.
- [Google Docs](/learn/system-design/problem-breakdowns/google-docs) — WebSockets for collaborative edits.
- [Online Auction](/learn/system-design/problem-breakdowns/online-auction) — live highest bid.

## Common Deep Dives

### How do you handle reconnects without losing messages?

Make delivery recoverable: persist messages durably, give each a sequence number or timestamp, and have clients resync from their last seen position when they reconnect. Real-time push is the fast path; the durable store is the source of truth.

### How do you load balance persistent connections?

Use a layer-4 load balancer or a connection gateway, track connections per server, and scale on connection count rather than CPU. During deploys, drain connections gradually and let clients reconnect with jittered backoff to avoid thundering herds.

### What about a single topic with millions of subscribers?

Fan out hierarchically: the broker delivers to connection servers (not to individual users), and each server pushes to its own clients. Coalesce or sample updates — nobody can read 10,000 comments a second.

## Conclusion

Separate the two hops. Pick the client protocol from the traffic shape (poll → long poll → SSE → WebSocket), then design how events reach the server holding the connection — usually pub/sub backed by durable storage for recovery.

```quiz
[
  {
    "question": "Which protocol best fits one-way server-to-client streams such as live comments?",
    "options": ["WebSockets", "Server-Sent Events", "FTP", "SMTP"],
    "answer": 1,
    "explanation": "SSE streams events over one HTTP response and reconnects automatically."
  },
  {
    "question": "What problem does pub/sub solve in a real-time system?",
    "options": ["Encrypting connections", "Getting an event to whichever server holds the recipient's connection", "Rendering the UI", "Storing messages forever"],
    "answer": 1,
    "explanation": "Servers subscribe to the channels their clients care about; producers publish without knowing where clients are."
  },
  {
    "question": "Why pair pub/sub with durable storage?",
    "options": ["Pub/sub is slow", "Fire-and-forget delivery misses offline clients, who need to resync", "To reduce memory", "Brokers require it"],
    "answer": 1,
    "explanation": "Clients recover missed updates from the store on reconnect."
  },
  {
    "question": "When is simple polling an acceptable answer?",
    "options": ["Never", "When updates are infrequent and a few seconds of delay is fine", "For multiplayer games", "For collaborative editing"],
    "answer": 1,
    "explanation": "Polling is simple and robust when latency requirements are loose."
  }
]
```
