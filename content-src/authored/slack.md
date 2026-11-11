---
title: Slack
seoTitle: Design Slack — Team Chat with Channels
description: Design team chat like Slack — workspaces and channels, real-time message delivery over WebSockets, ordered channel history, unread state, search, and very large channels.
tags: Real-time Updates, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 💼 What is Slack?
Slack is chat for organisations. Each company has a **workspace** with **channels** (public or private) and direct messages. Unlike consumer messengers, history is permanent and searchable, channels can have tens of thousands of members, and people use it from several devices at once all day.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to send messages to channels and DMs, and receive them in real time.
2. Users should be able to scroll back through a channel's full history.
3. Users should see which channels have unread messages and mentions, synced across devices.
4. Users should be able to search messages in their workspace.

**Below the line (out of scope):**

- Threads, reactions and file uploads (mentioned briefly).
- Voice and video huddles.
- Integrations and bots.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Messages delivered to online members within ~500 ms.
2. Messages within a channel are ordered consistently for everyone.
3. No message loss; history is durable.
4. Scale to ~1M workspaces, ~20M concurrent connections, and channels with 100k members.
5. Strict isolation between workspaces.

**Below the line (out of scope):**

- End-to-end encryption (Slack messages are searchable server-side).

```sketch Slack Requirements
Functional
- send + receive in real time
- full channel history
- unreads synced across devices
- search

Non-functional
- < 500ms delivery
- consistent order per channel
- durable, no loss
- 20M connections, 100k-member channels
- workspace isolation
```

## The Set Up

### Defining the Core Entities

1. **Workspace**: an organisation and its members.
2. **Channel**: workspace, name, type (public, private, DM), members.
3. **Message**: channel, sender, text, timestamp ID (ordered within the channel).
4. **Read cursor**: per user per channel, the last message they've read.

### API or System Interface

```
POST /channels/:id/messages { text, clientMsgId } -> { messageId, ts }
GET  /channels/:id/messages?before=ts&limit=50
POST /channels/:id/read { ts }
GET  /search?q=&in=channel&from=user
WS   /realtime   -> message, read_marker, typing events
```

## High-Level Design

### 1) Sending and receiving in real time

Clients keep a **WebSocket** to a gateway server. On send, the **Message Service** assigns the message a channel-ordered ID, persists it, and publishes it to the channel's topic. Every gateway that has connected members of that channel is subscribed to the topic and pushes the message to them.

```diagram Message flow
node sender 0,1 box "Sender"
node msg 1.5,1 box "Message Service"
node db 1.5,2.4 circle "Message Store"
node pubsub 3,1 box "Channel Pub/Sub"
node gw 4.5,1 box "Gateway Servers"
node members 6,1 box "Online Members"
edge sender -> msg "send"
edge msg -> db "persist"
edge msg -> pubsub "publish"
edge pubsub -> gw
edge gw -> members "WebSocket"
```

### 2) Channel history

Messages are stored partitioned by **channel ID** and sorted by message timestamp, so "the 50 messages before X" is one range read (Cassandra/Vitess-style sharded MySQL). Clients cache recent history locally and fetch older pages as the user scrolls.

### 3) Unread state across devices

Each user has a **read cursor** per channel. A channel is unread if its latest message ID is greater than the cursor. When the user reads on one device, the cursor update is pushed to their other devices so badges clear everywhere. Mentions are counted separately, as they're more important.

### 4) Search

Messages are indexed asynchronously into a search cluster **partitioned by workspace**, so a query only touches that workspace's index and isolation is enforced. Search filters by channels the user can see.

## Potential Deep Dives

### 1) How do we fan out to a channel with 100k members?

:::solution bad Write to each member's inbox
#### Approach

Copy each message into every member's inbox (fan-out on write).

#### Challenges

100k writes per message in a busy announcements channel, mostly for people who aren't online.
:::

:::solution good Push to online members only
#### Approach

Store the message once per channel. Look up online members and push to each of their connections.

#### Challenges

Looking up and pushing to 100k members from one service is slow and bursty.
:::

:::solution great Gateway-level subscriptions
#### Approach

Each gateway server **subscribes to the channels its connected users belong to**. A message is published once to the channel topic and reaches only the gateways that care (perhaps a few hundred), each of which delivers locally to its connections. Offline members simply see it in history and unread counts when they return. A **channel server** layer can own subscription state per channel to avoid every gateway tracking everything.

#### Challenges

Users in thousands of channels mean large subscription sets; gateways subscribe lazily and clients load a "boot" snapshot on connect.
:::

### 2) How do we order messages and avoid duplicates?

Each channel's messages get IDs from a single **owner** for that channel (the shard leader or a per-channel sequence), so order is consistent for everyone. Clients send a **clientMsgId**; retries after a timeout are deduplicated, so a flaky connection doesn't post the message twice. Clients show the message optimistically and reconcile when the server's ID arrives.

:::tip
Mention reconnection: a reconnecting client sends its last seen message ID per active channel and fetches anything newer, so nothing is missed during a disconnect.
:::

### 3) How do we keep workspaces isolated and scalable?

Shard data by **workspace ID** (with very large enterprises getting dedicated shards), so a workspace's channels, messages and search index live together and queries can't cross tenants. Gateways authenticate each connection to a workspace and only subscribe to that workspace's channels.

### Final Design

```diagram Final Design
node client 0,1 box "Clients|desktop · mobile"
node gw 1.5,1 box "Gateways|WebSocket"
node cs 3,1 box "Channel Servers|pub/sub"
node msg 1.5,-0.3 box "Message Service"
node db 3,-0.3 circle "Messages|by channel"
node cursors 1.5,2.3 circle "Read Cursors"
node idx 4.5,1 box "Indexer"
node search 6,1 circle "Search|per workspace"
edge client <-> gw
edge gw <-> cs "subscribe / deliver"
edge client -> msg "send (HTTP)"
edge msg -> db
edge msg -> cs "publish"
edge db -> idx "CDC"
edge idx -> search
edge gw <-> cursors "read markers"
```

```quiz
[
  {
    "question": "Why not copy every message into each member's inbox?",
    "options": ["It's insecure", "Large channels would need 100k writes per message", "Inboxes can't hold text", "It breaks search"],
    "answer": 1,
    "explanation": "Messages are stored once per channel and delivered to online members."
  },
  {
    "question": "How does a gateway know which messages to deliver?",
    "options": ["It receives every message", "It subscribes to the channels its connected users belong to", "Clients poll it", "It reads the database"],
    "answer": 1,
    "explanation": "Pub/sub per channel limits fan-out to interested gateways."
  },
  {
    "question": "How is a channel marked unread?",
    "options": ["A flag per message per user", "Its latest message ID is greater than the user's read cursor", "A cron job", "The client guesses"],
    "answer": 1,
    "explanation": "One cursor per user per channel is cheap and syncs across devices."
  },
  {
    "question": "What prevents a retried send from posting twice?",
    "options": ["Rate limiting", "A client-generated message ID used for deduplication", "Longer timeouts", "TLS"],
    "answer": 1,
    "explanation": "The server ignores repeats of the same clientMsgId."
  }
]
```
