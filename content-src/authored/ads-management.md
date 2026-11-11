---
title: Ads Management and Serving
seoTitle: Design an Ads Management and Display System for a Social Feed
description: Design ad serving for a social feed — campaign management, targeting, real-time auctions, budget pacing, and impression and click logging.
tags: Scaling Reads, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Facebook, Google, Amazon, Pinterest | 0
---

## Understanding the Problem

:::definition 📣 What is an Ads Management and Serving System?
Advertisers create campaigns with budgets, targeting and creatives; when a user scrolls their feed, the system picks the best ad for that slot in milliseconds through an auction, shows it, and charges the advertiser — without overspending budgets.
:::

### Functional Requirements

**Core Requirements**

1. Advertisers should be able to create campaigns with targeting (age, location, interests), budget, bid and creatives.
2. When a feed requests an ad, the system should choose the best eligible ad via an auction.
3. The system should record impressions and clicks and charge advertisers.
4. Campaigns should not exceed their daily budgets, and spend should be paced through the day.

**Below the line (out of scope):**

- Click-fraud detection.
- The ML model that predicts click-through rates (we treat it as a service).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Ad selection within ~50ms so the feed isn't slowed.
2. Handle millions of ad requests per second.
3. Budgets must not be significantly overspent; small overshoot is tolerable.
4. Impression and click logs must be durable — they're how advertisers are billed.

**Below the line (out of scope):**

- Advertiser reporting dashboards (see [Ad Click Aggregator](/learn/system-design/problem-breakdowns/ad-click-aggregator)).

```sketch Ads Requirements
Functional
- campaigns: targeting, budget, bid
- auction per ad slot
- log impressions + clicks, bill
- budget pacing

Non-functional
- select in ~50ms
- millions req/s
- no big overspend
- durable billing logs
```

## The Set Up

### Defining the Core Entities

1. **Campaign**: advertiser, budget, bid strategy, schedule, status.
2. **Ad**: creative, targeting criteria, belongs to a campaign.
3. **Ad request**: user ID, context (placement, device), timestamp.
4. **Impression / Click**: logged events tied to an ad request ID.

### API or System Interface

```
POST /campaigns { budgetDaily, bid, targeting, creatives[] }

// Internal, called by the feed service
POST /ads/select { userId, placement, count: 1 } -> [{ adId, creative, impressionToken }]

POST /events/impression { impressionToken }
GET  /c/:clickToken -> 302 to advertiser URL
```

## High-Level Design

### 1) Advertisers create campaigns

The **Campaign Service** stores campaigns in a relational database. Changes are published so serving systems rebuild their in-memory **ad index** within seconds.

### 2) Choose the best ad for a feed slot

```diagram Ad selection
node feed 0,1 box "Feed Service"
node sel 1.5,1 box "Ad Selection|1. retrieve|2. rank|3. auction"
node idx 3,0.2 circle "Ad Index|(in-memory)"
node ml 3,1.8 box "CTR Prediction"
node user 1.5,2.4 circle "User Features"
node budget 3,2.9 circle "Budget / Pacing"
edge feed <-> sel "POST /ads/select"
edge sel <-> idx "eligible ads"
edge sel <-> ml "score"
edge sel <-> user
edge sel <-> budget "can spend?"
```

1. **Retrieve**: the ad index (an inverted index from targeting attributes to ads) returns the few thousand ads eligible for this user.
2. **Rank**: a model predicts click probability; expected value = bid × predicted CTR (plus quality signals).
3. **Auction**: the highest score wins; with a second-price-style rule, the winner pays just enough to beat the runner-up.
4. Check that the winning campaign still has budget to spend, then return the creative with a signed impression token.

### 3) Log impressions and clicks

The client reports impressions when the ad is actually visible; clicks go through a redirect endpoint. Events are written to Kafka, deduplicated by token, and aggregated for billing and reporting.

### 4) Pace budgets

A **Budget Service** tracks spend per campaign and decides, for each auction, whether a campaign should participate, so spend is spread across the day instead of being exhausted in the first hour.

## Potential Deep Dives

### 1) How do we pick an ad within 50ms?

:::solution bad Score every ad for every request
#### Approach

Run the CTR model across all active ads.

#### Challenges

Millions of ads × millions of requests per second is impossible.
:::

:::solution great Multi-stage retrieval and ranking
#### Approach

An in-memory inverted index (sharded across serving nodes, rebuilt from the campaign stream) narrows millions of ads to a few thousand by targeting. A cheap model trims that to hundreds; an expensive model ranks the final candidates. Cache user features close to the serving nodes.

#### Challenges

Index freshness: paused campaigns must disappear within seconds, so updates stream in rather than waiting for a rebuild.
:::

### 2) How do we avoid overspending budgets?

:::solution bad Check the database on every auction
#### Approach

Read and update the campaign's spend in the database per impression.

#### Challenges

A popular campaign gets thousands of impressions per second — a hot row and slow auctions.
:::

:::solution great Distributed budget allocation with pacing
#### Approach

A central budget service hands each serving node a small **spend allowance** per campaign for the next few seconds and tracks actual spend from the impression stream. Nodes decide locally from their allowance (no network call per auction). A pacing controller throttles participation probability so spend tracks a target curve through the day.

#### Challenges

Allowances create small overshoot when many nodes spend at once; keep allowances small near the end of a budget.
:::

### Final Design

```diagram Final Design
node adv 0,0 box "Advertisers"
node camp 1.4,0 box "Campaign Service"
node cdb 2.8,0 circle "Campaign DB"
node feed 0,1.4 box "Feed Service"
node sel 1.4,1.4 box "Ad Serving Nodes|- in-memory index|- rank + auction|- local allowance"
node ml 2.8,0.6 box "Ranking Models"
node budget 4.2,1.4 box "Budget + Pacing"
node kafka 1.4,2.8 circle "Kafka|impr + clicks"
node bill 2.8,2.8 box "Billing + Reporting"
edge adv <-> camp
edge camp <-> cdb
edge camp -> sel "campaign stream"
edge feed <-> sel
edge sel <-> ml
edge sel <-> budget "allowances"
edge sel -> kafka
edge kafka -> bill
edge kafka -> budget "actual spend"
```

```quiz
[
  {
    "question": "Why use multi-stage retrieval and ranking?",
    "options": ["For accuracy only", "Scoring every ad per request is impossible within ~50ms", "Advertisers require it", "To save storage"],
    "answer": 1,
    "explanation": "Cheap filters narrow candidates before expensive models run."
  },
  {
    "question": "What score typically decides the auction?",
    "options": ["Bid only", "Bid times predicted click-through rate (plus quality)", "Ad age", "Random"],
    "answer": 1,
    "explanation": "Expected value balances price and relevance."
  },
  {
    "question": "How can serving nodes enforce budgets without a database call per auction?",
    "options": ["Ignore budgets", "Use small spend allowances handed out by a budget service", "Charge later", "Cache the campaign forever"],
    "answer": 1,
    "explanation": "Local allowances bound overspend while avoiding hot rows."
  },
  {
    "question": "What is budget pacing for?",
    "options": ["Spending faster", "Spreading spend across the day instead of exhausting it early", "Refunds", "Fraud"],
    "answer": 1,
    "explanation": "Pacing gives campaigns delivery throughout the day."
  }
]
```
