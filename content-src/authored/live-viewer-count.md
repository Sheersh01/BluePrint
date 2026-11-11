---
title: Live Viewer Count
seoTitle: Design "X People Are Viewing This Page" Live Counts
description: Design a live viewer counter — tracking active viewers per page with heartbeats, expiring presence, approximate counting at scale, and pushing updates.
tags: Real-time Updates, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Booking.com | 0
---

## Understanding the Problem

:::definition 👀 What is a Live Viewer Count?
Travel and shopping sites show messages like "23 people are looking at this hotel right now". The system tracks how many users currently have a page open and keeps the number roughly up to date.
:::

### Functional Requirements

**Core Requirements**

1. While a user has a page open, they should be counted as viewing it.
2. Users should see the current viewer count for the page they're on.
3. When users leave (or close the tab), they should stop being counted within about a minute.

**Below the line (out of scope):**

- Showing who the viewers are.
- Historical viewing analytics.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Counts can be approximate and up to ~30-60 seconds stale.
2. Must not slow down page loads; failures should just hide the badge.
3. Scale to millions of concurrent viewers across millions of pages, with hot pages having 100k+ viewers.

**Below the line (out of scope):**

- Exact counts for billing.

```sketch Viewer Count Requirements
Functional
- count active viewers per page
- show current count
- drop leavers within ~1 min

Non-functional
- approximate, ~30-60s stale ok
- never slow pages
- millions concurrent, hot pages
```

## The Set Up

### Defining the Core Entities

1. **Page**: a hotel, product or listing ID.
2. **Viewer presence**: (pageId, viewerId) with a last-seen timestamp.
3. **Viewer count**: the number of active viewers for a page.

### API or System Interface

```
POST /pages/:pageId/heartbeat { viewerId }   (every 20-30s while visible)
GET  /pages/:pageId/viewers -> { count }
```

## High-Level Design

### 1) Count users while the page is open

The browser sends a **heartbeat** every ~20 seconds while the tab is visible (using the Page Visibility API). Each heartbeat refreshes the viewer's presence for that page with a TTL of ~60 seconds.

```diagram Heartbeats and counts
node browser 0,1 box "Browser|heartbeat every 20s"
node svc 1.5,1 box "Presence Service"
node redis 3,1 circle "Redis|sorted set per page"
note 3.5,0.9 "page:123:viewers|member = viewerId|score = lastSeen"
edge browser <-> svc "heartbeat / count"
edge svc <-> redis "ZADD, trim, ZCARD"
```

### 2) Show the current count

Presence is stored per page in a Redis sorted set (`member = viewerId`, `score = lastSeen`). The count is the number of members seen within the last 60 seconds: remove older members (`ZREMRANGEBYSCORE`) and read `ZCARD`. The response is cached for a few seconds per page since everyone viewing it gets the same number.

### 3) Drop users who leave

Viewers who close the tab simply stop heartbeating; their entries age out of the window. A `navigator.sendBeacon` on page hide can remove them immediately as a best effort.

## Potential Deep Dives

### 1) How do we count at millions of concurrent viewers?

:::solution bad Store each heartbeat in a database
#### Approach

Insert a row per heartbeat and `COUNT(DISTINCT viewer)` over the last minute.

#### Challenges

Millions of writes per minute and expensive aggregate queries for every page view.
:::

:::solution good Redis sorted sets per page
#### Approach

As above: one sorted set per page, trimmed by score.

#### Challenges

A hot page with 100k viewers means a big set and many writes on one key.
:::

:::solution great Time-bucketed approximate counting
#### Approach

Bucket presence by minute: add each heartbeat to a **HyperLogLog** for `(pageId, currentMinute)`, which uses ~12KB regardless of viewers. The live count is the merged HLL of the last two buckets (`PFCOUNT` on both keys), giving ~1% error. Buckets expire after a few minutes. For very hot pages, aggregate heartbeats in each presence server for a second before writing.

#### Challenges

Counts are approximate — perfectly fine for "about 23 people".
:::

### 2) Should we poll or push the count?

Polling the count every 30 seconds piggybacks on the heartbeat response — the heartbeat endpoint simply returns the latest cached count. That's far cheaper than maintaining push connections for a badge that only needs minute-level freshness. Push (SSE) is worth it only for pages where the number changes the user's behaviour in seconds.

:::tip
Return the count in the heartbeat response. One request every 20 seconds serves both "I'm here" and "how many are here?".
:::

### Final Design

```diagram Final Design
node browser 0,1.2 box "Browser|- visibility-aware|  heartbeats"
node lb 1.4,1.2 box "Load Balancer"
node svc 2.8,1.2 box "Presence Service|- local batching|- cached counts"
node redis 4.2,0.4 circle "Redis Cluster|HLL per page-minute"
node cache 4.2,2 circle "Count Cache|(5s TTL)"
edge browser <-> lb "heartbeat -> count"
edge lb <-> svc
edge svc <-> redis
edge svc <-> cache
```

```quiz
[
  {
    "question": "How does the system know a user left without an explicit signal?",
    "options": ["It doesn't", "Their heartbeats stop and presence expires after the window", "The server pings the browser", "Cookies expire"],
    "answer": 1,
    "explanation": "Time-based expiry handles closed tabs and crashes."
  },
  {
    "question": "Why use HyperLogLog for hot pages?",
    "options": ["Exact counts", "Constant small memory with ~1% error regardless of viewer count", "Encryption", "Ordering"],
    "answer": 1,
    "explanation": "Approximate cardinality is all a viewer badge needs."
  },
  {
    "question": "What's an efficient way to deliver the count to the page?",
    "options": ["A separate WebSocket per page", "Return it in the heartbeat response", "Email", "Reload the page"],
    "answer": 1,
    "explanation": "One periodic request serves both purposes."
  },
  {
    "question": "Why use the Page Visibility API for heartbeats?",
    "options": ["Security", "To avoid counting tabs left open in the background", "To speed up rendering", "It's required"],
    "answer": 1,
    "explanation": "Only actively visible pages should count as viewers."
  }
]
```
