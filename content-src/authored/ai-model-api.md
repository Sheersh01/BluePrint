---
title: AI Model API
seoTitle: Design APIs for Developers to Securely and Efficiently Access AI Models
description: Design a developer API for AI models — API keys and auth, token-based rate limits and quotas, routing to GPU inference fleets with batching, streaming responses, usage metering and billing, and abuse protection.
tags: Scaling Reads, Dealing with Contention
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🤖 What is an AI Model API?
An AI model API (like the APIs from OpenAI, Anthropic or Google) lets developers send requests — a prompt, images, a list of messages — and get model outputs back over HTTP. Behind a simple endpoint sits a lot of machinery: authenticating keys, enforcing limits measured in **tokens**, routing each request to scarce GPU capacity, streaming output as it's generated, counting usage for billing, and blocking abuse.
:::

### Functional Requirements

**Core Requirements**

1. Developers should create API keys scoped to projects, and call endpoints to generate text (and other modalities) from a chosen model.
2. Responses can be streamed token by token, or returned whole.
3. Each organisation has rate limits (requests and tokens per minute) and spending limits.
4. Usage is metered per request (input and output tokens) and billed.
5. Developers can submit large asynchronous batch jobs at lower priority and cost.

**Below the line (out of scope):**

- Training and fine-tuning.
- The model architecture itself.
- A consumer chat UI (see ChatGPT).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Low latency: time-to-first-token < 1 s for typical requests; streaming steady.
2. High GPU utilisation — GPUs are the dominant cost.
3. Fairness and isolation: one customer's spike can't degrade others.
4. Security: keys protected, data isolated between customers, prompts not logged beyond policy.
5. Accurate metering: every token billed exactly once.
6. Scale to ~100k requests per second at peak across many models and regions.

**Below the line (out of scope):**

- Exactly identical outputs across retries.

```sketch AI API Requirements
Functional
- API keys per project
- generate, streamed or whole
- rate + spend limits
- token metering + billing
- async batch jobs

Non-functional
- first token < 1s
- high GPU utilisation
- fair + isolated
- secure keys + data
- exact metering
- 100k req/s
```

## The Set Up

### Defining the Core Entities

1. **Organisation / project**: billing account, limits tier, allowed models.
2. **API key**: hashed secret, project, scopes, status.
3. **Request**: model, input tokens, max output tokens, priority (interactive or batch).
4. **Inference replica**: a GPU server (or group) hosting one model.
5. **Usage record**: request ID, org, model, input/output tokens, timestamp.

### API or System Interface

```
POST /v1/messages { model, messages, max_tokens, stream: true }
  Headers: Authorization: Bearer <key>
  -> SSE stream: message_start, content deltas, message_stop (with usage)
POST /v1/batches { requests[] } -> { batchId }   GET /v1/batches/:id
GET  /v1/usage?from=&to=
Errors: 401, 429 (with retry-after), 529 overloaded
```

## High-Level Design

### 1) Authentication and limits at the gateway

Requests hit an **API gateway** in the nearest region. It hashes the key and looks it up (cached), attaches the org and project, and checks **rate limits**: requests per minute and **tokens per minute** (estimated input tokens plus `max_tokens` reserved up front, corrected when the request finishes). Over-limit requests get `429` with `retry-after`.

### 2) Routing to inference

The **router** sends the request to a replica of the requested model with spare capacity, preferring replicas that already hold a cached prefix of this prompt (**prompt caching**). Each replica runs an inference server that performs **continuous batching**: new requests join the running batch between generation steps, which keeps GPUs busy without making anyone wait for a whole batch.

```diagram Request path
node dev 0,1 box "Developer App"
node gw 1.6,1 box "API Gateway|auth + rate limits"
node router 3.2,1 box "Router|capacity + cache aware"
node gpu 4.8,1 box "Inference Replicas|continuous batching"
node meter 3.2,2.3 box "Usage Metering"
edge dev <-> gw "HTTPS / SSE"
edge gw <-> router
edge router <-> gpu "stream tokens"
edge gw -> meter "usage events"
```

### 3) Streaming

Tokens are streamed back to the client over **Server-Sent Events** as they're generated, through the router and gateway. The final event includes the token usage. If the client disconnects, generation is cancelled to free the GPU.

### 4) Metering and billing

When a request completes, the gateway emits a **usage event** (request ID, tokens) to Kafka. A metering pipeline deduplicates by request ID, aggregates per org per hour and feeds billing and dashboards. Spend limits are checked against near-real-time totals.

## Potential Deep Dives

### 1) How do we rate-limit fairly when requests vary in size?

:::solution bad Requests per minute only
#### Approach

Limit each org to N requests per minute.

#### Challenges

One request with a 100k-token prompt costs as much as hundreds of small ones; request counts don't reflect load.
:::

:::solution good Token-based limits
#### Approach

Limit tokens per minute as well, reserving the request's maximum cost up front and refunding the unused part on completion.

#### Challenges

Limits protect the platform per customer, but a burst across many customers can still overload a model's capacity.
:::

:::solution great Token limits + priority queues + load shedding
#### Approach

Keep per-org token buckets (distributed, e.g. in Redis with local pre-allocation for speed), and add **admission control** per model: when replicas near saturation, the router queues requests briefly with **weighted fair queuing** between orgs and tiers, sheds the lowest priority (batch, free tier) first, and returns `529 overloaded` rather than letting latency explode. Batch jobs fill idle capacity at night and back off at peak.

#### Challenges

Capacity must be planned per model and region; queues need short limits so clients retry elsewhere instead of waiting.
:::

### 2) How do we keep GPUs busy and latency low?

Generation is memory-bandwidth-bound, so serving many requests together is far more efficient. **Continuous batching** adds and removes sequences at each step; **KV-cache management** (paged attention) lets many sequences share GPU memory; **prompt caching** reuses computation for shared prefixes like long system prompts. The router balances load using each replica's live queue depth and KV-cache usage, and autoscaling adds replicas from a pool, though model loading takes minutes, so forecasts drive capacity.

:::tip
Separate the two latency numbers: time-to-first-token (affected by queueing and prompt length) and tokens per second during streaming (affected by batch size). Bigger batches raise throughput but slow each stream.
:::

### 3) How do we secure keys and customer data?

Store only **hashes** of API keys; show the secret once at creation; support rotation and scoped keys per project. Scan public code repositories for leaked keys and revoke them automatically. Isolate customer data: prompts are processed in memory, retention follows a documented policy, and logs exclude content by default. Abuse detection classifies requests for policy violations and flags suspicious usage patterns such as sudden spikes on a new key.

### Final Design

```diagram Final Design
node dev 0,1 box "Developers"
node gw 1.4,1 box "Regional Gateway|auth · token limits"
node keys 1.4,-0.3 circle "Key Cache"
node limits 2.8,-0.3 circle "Rate Limit Store"
node router 2.8,1 box "Router|fair queues + shedding"
node fleet 4.2,1 box "GPU Fleet|per model"
node batch 4.2,-0.3 box "Batch Scheduler"
node kafka 2.8,2.3 box "Usage Events"
node bill 4.2,2.3 box "Metering + Billing"
edge dev <-> gw
edge gw <-> keys
edge gw <-> limits
edge gw <-> router
edge router <-> fleet
edge batch -> fleet "idle capacity"
edge gw -> kafka
edge kafka -> bill
```

```quiz
[
  {
    "question": "Why rate-limit by tokens instead of only requests?",
    "options": ["Tokens are easier to count", "Request sizes vary hugely, so tokens reflect actual compute cost", "Regulations", "Requests can't be counted"],
    "answer": 1,
    "explanation": "One long prompt can cost as much as hundreds of short ones."
  },
  {
    "question": "What does continuous batching do?",
    "options": ["Waits for a full batch before starting", "Adds and removes requests from the running batch at each generation step", "Runs one request at a time", "Batches billing"],
    "answer": 1,
    "explanation": "It keeps GPUs busy without making requests wait."
  },
  {
    "question": "What should the API return when a model is overloaded?",
    "options": ["Hang indefinitely", "An overloaded/429 response with retry guidance, shedding low priority first", "A random answer", "Nothing"],
    "answer": 1,
    "explanation": "Fast, explicit rejection beats unbounded latency."
  },
  {
    "question": "How should API keys be stored?",
    "options": ["In plain text", "As hashes, with the secret shown only once", "In the client app", "In logs"],
    "answer": 1,
    "explanation": "A database leak shouldn't expose usable keys."
  }
]
```
