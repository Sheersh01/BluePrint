---
title: ChatGPT
seoTitle: Design a Chat Assistant Like ChatGPT
description: Design ChatGPT — conversations with an LLM, streaming token responses, conversation history, GPU capacity management, and rate limiting.
tags: Real-time Updates, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: OpenAI, Anthropic, Google | 9
---

## Understanding the Problem

:::definition 🤖 What is ChatGPT?
ChatGPT is a conversational assistant. Users send messages in a chat, and a large language model (LLM) generates a reply that streams back token by token.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to start a conversation and send messages.
2. Responses should stream back to the user as they are generated.
3. Users should be able to view and continue past conversations.

**Below the line (out of scope):**

- Training the model.
- File uploads, tools, image generation, and voice.
- Sharing conversations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Time to first token should be low (< 1s at normal load).
2. The system should scale to 100M weekly users and use expensive GPU capacity efficiently.
3. Conversations must be durable — a user's history should never disappear.
4. The system should degrade gracefully under overload (queue or rate limit rather than fall over).

**Below the line (out of scope):**

- Safety classifiers and content moderation.
- Strong consistency across devices mid-stream.

```sketch ChatGPT Requirements
Functional
- send messages in a conversation
- stream responses token by token
- view / continue past conversations

Non-functional
- time to first token < 1s
- 100M weekly users, efficient GPU use
- durable history
- graceful degradation under load
```

## The Set Up

### Planning the Approach

Most of the system is a fairly standard chat app. What's unusual is the **inference tier**: requests are long-running (seconds to minutes), extremely expensive, and capacity-constrained by GPUs. We'll focus the deep dives there.

### Defining the Core Entities

1. **User**: with a plan tier that determines limits.
2. **Conversation**: an ordered list of messages with a title.
3. **Message**: role (user/assistant), content, token count, status (streaming/complete/error).
4. **Model**: which LLM serves the request.

```sketch ChatGPT Entities
Core Entities
- User (plan tier)
- Conversation
- Message
- Model
```

### API or System Interface

```
POST /conversations -> { "conversationId" }

POST /conversations/:id/messages
{ "content": "Explain consistent hashing", "model": "default" }
-> text/event-stream of { "delta": "Consistent", ... } ... { "done": true }

GET /conversations?cursor -> Conversation[]
GET /conversations/:id/messages -> Message[]
```

## High-Level Design

### 1) Users should be able to send messages

The **Chat Service** stores the user's message, builds the prompt from the conversation history (truncated or summarised to fit the model's context window), and sends it to the **Inference Service**.

```diagram Send a message
node c 0,1 box "Client"
node gw 1.2,1 box "API Gateway|- auth|- rate limit"
node chat 2.5,1 box "Chat Service|- build prompt"
node db 2.5,2.2 circle "Conversations DB"
node inf 3.9,1 box "Inference Service"
node gpu 5.2,1 circle "GPU Workers"
edge c <-> gw "POST /messages"
edge gw <-> chat
edge chat <-> db
edge chat <-> inf
edge inf <-> gpu
```

### 2) Responses should stream back as they are generated

The model generates one token at a time. Rather than waiting for the full answer, the Inference Service streams tokens to the Chat Service, which forwards them to the client over **Server-Sent Events**. The response is a single long-lived HTTP response, so SSE fits naturally — no bidirectional WebSocket needed.

When generation completes, the full assistant message is written to the database.

### 3) Users should be able to view past conversations

Conversations and messages are stored in a database keyed by `userId` / `conversationId`. A wide-column or document store (e.g. DynamoDB with partition key `conversationId`, sort key `messageTs`) scales well for this append-heavy, read-by-conversation pattern.

## Potential Deep Dives

### 1) How do we use scarce GPU capacity efficiently?

:::solution bad One request per GPU at a time
#### Approach

Route each request to a free GPU worker, which processes it to completion before taking another.

#### Challenges

GPUs are memory-bandwidth bound during generation; serving one sequence at a time leaves most of the compute idle and throughput terrible.
:::

:::solution great Continuous batching on inference servers
#### Approach

Inference servers batch many concurrent requests together and use **continuous (in-flight) batching**: new requests join the batch as others finish, at token granularity. Combined with a KV cache for attention state, this multiplies throughput per GPU. A router sends requests to the replica with available KV-cache capacity.

#### Challenges

Larger batches raise per-token latency, so batch size is tuned against latency SLOs. Long prompts consume lots of cache memory and must be scheduled carefully.
:::

### 2) What happens when demand exceeds GPU capacity?

:::solution bad Accept everything and let latency grow
#### Approach

Send every request to inference and hope capacity holds.

#### Challenges

Queues grow unbounded, requests time out after users have waited a long time, and the system thrashes.
:::

:::solution great Admission control: rate limits, priority queues and load shedding
#### Approach

Enforce per-user rate limits by plan (token bucket on messages and on tokens per minute). Put admitted requests into **priority queues** (paid tiers first) in front of the inference router with a bounded wait; when the queue is full or the expected wait exceeds a threshold, return a friendly "at capacity" error immediately. Optionally fall back to a smaller, cheaper model under pressure.

#### Challenges

Requires accurate capacity signals (queue depth, KV-cache utilisation) and careful UX for degraded responses.
:::

### 3) What if the user's connection drops mid-stream?

:::solution good Tie generation to the HTTP connection
#### Approach

If the client disconnects, cancel generation and discard the partial response.

#### Challenges

Mobile users lose answers constantly, and wasted GPU work is thrown away.
:::

:::solution great Decouple generation from delivery
#### Approach

Generation writes tokens to a short-lived stream (e.g. Redis Stream keyed by messageId) and persists the final message to the database. The SSE handler reads from that stream. A reconnecting client calls `GET /messages/:id/stream?offset=N` and resumes from where it left off; if generation already finished, it simply reads the stored message.

#### Challenges

More moving parts; streams need TTLs, and explicit "stop generating" requests must still cancel the inference job to save GPU time.
:::

:::pattern Pattern: Managing Long Running Tasks
LLM responses can take a minute. Separating the work (generation) from the client connection (delivery) is what makes them resilient.
:::

### Final Design

```diagram Final Design
node c 0,1.2 box "Client"
node gw 1.2,1.2 box "API Gateway|- auth|- rate limits"
node chat 2.5,1.2 box "Chat Service|- prompt building|- SSE"
node db 2.5,2.4 circle "Conversations DB"
node stream 2.5,0 circle "Token Streams|(Redis)"
node q 3.8,1.2 circle "Priority Queues"
node router 5,1.2 box "Inference Router|- KV-cache aware"
node gpu 6.2,1.2 box "GPU Servers|- continuous batching"
edge c <-> gw "SSE"
edge gw <-> chat
edge chat <-> db
edge chat <-> stream
edge chat -> q
edge q -> router
edge router <-> gpu
edge gpu -> stream "tokens"
```

```quiz
[
  {
    "question": "Why is SSE a natural fit for streaming LLM responses?",
    "options": ["Traffic during generation is one-way, server to client, over a single response", "It supports binary uploads", "It is required by GPUs", "It guarantees exactly-once delivery"],
    "answer": 0,
    "explanation": "The client sends one request and receives a stream of tokens back."
  },
  {
    "question": "What does continuous batching improve?",
    "options": ["Prompt quality", "GPU throughput by adding and removing requests from the batch at token granularity", "Network latency", "Storage costs"],
    "answer": 1,
    "explanation": "Keeping the batch full uses GPU compute that single-request serving leaves idle.",
    "section": "1-how-do-we-use-scarce-gpu-capacity-efficiently"
  },
  {
    "question": "How should the system behave when GPU demand exceeds capacity?",
    "options": ["Accept all requests", "Rate limit, queue with priorities and shed load with a fast error", "Restart GPUs", "Disable streaming"],
    "answer": 1,
    "explanation": "Admission control keeps latency bounded instead of letting everything time out.",
    "section": "2-what-happens-when-demand-exceeds-gpu-capacity"
  },
  {
    "question": "How can a client resume a response after its connection drops?",
    "options": ["Re-send the prompt", "Generation writes to a stream the client can resume from an offset", "It can't", "Use a CDN"],
    "answer": 1,
    "explanation": "Decoupling generation from delivery lets clients reconnect without losing or regenerating work.",
    "section": "3-what-if-the-user-s-connection-drops-mid-stream"
  }
]
```
