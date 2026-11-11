---
title: Real-Time Bidding
seoTitle: Design a Real-Time Bidding (RTB) Ad Exchange
description: Design a real-time bidding ad exchange — fanning bid requests out to many bidders under a 100 ms deadline, running auctions, budget pacing for bidders, and logging billions of events.
tags: Scaling Writes, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition ⚡ What is Real-Time Bidding?
When a web page or app has an ad slot, an **ad exchange** auctions it in real time: it sends a **bid request** describing the slot and user to many **bidders** (demand-side platforms acting for advertisers), collects their bids within about 100 milliseconds, picks the winner and returns the ad — all while the page loads. This happens millions of times per second across the internet. Unlike serving ads inside one app, the exchange depends on many external bidders it doesn't control.
:::

### Functional Requirements

**Core Requirements**

1. Publishers' ad slots should send ad requests to the exchange.
2. The exchange should send bid requests to eligible bidders and collect bids before a deadline.
3. The exchange should run an auction (with floor prices) and return the winning ad.
4. Impressions, clicks and auction outcomes should be logged for billing and reporting.
5. (Bidder side) A bidder should decide whether and how much to bid within its time budget while pacing advertiser budgets.

**Below the line (out of scope):**

- Ad creative review.
- User identity syncing details.
- Advertiser campaign UIs.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Hard latency limit: the whole auction completes within ~100 ms; bidders get ~50-80 ms.
2. Scale to ~5M ad requests per second at peak, each fanned out to many bidders.
3. Billing accuracy: impressions and prices must be counted exactly once.
4. Graceful degradation: slow bidders must not slow down the auction.

**Below the line (out of scope):**

- Strong consistency of budget spend (small overspend is tolerated and reconciled).

```sketch RTB Requirements
Functional
- receive ad requests
- fan out bid requests
- auction + floors
- log impressions + clicks
- bidder: bid + pace budgets

Non-functional
- ~100ms end to end
- 5M req/s, fanned out
- exact billing
- slow bidders can't slow auctions
```

## The Set Up

### Defining the Core Entities

1. **Ad request**: slot size, publisher, page context, device, location, user ID (if consented), floor price.
2. **Bid request / bid**: OpenRTB messages; a bid has price, creative and campaign.
3. **Auction**: request, bids received, winner, clearing price.
4. **Impression**: the ad actually rendered (confirmed by a tracking pixel), with the price charged.
5. **Campaign (bidder side)**: targeting, bid strategy, daily budget, spend so far.

### API or System Interface

```
GET  /ad?slot=&pub=&ctx=...                 (from publisher page / SDK)
POST {bidder}/bid  OpenRTB BidRequest -> BidResponse { price, adm, nurl }  (timeout ~80ms)
GET  /win?auction=&price=                    (win notice to bidder)
GET  /imp?auction=&sig=                      (impression pixel)
GET  /click?auction=&sig=
```

## High-Level Design

### 1) Receiving ad requests

Publisher pages and app SDKs call the exchange's nearest **edge region** (anycast + load balancers). The **auction service** enriches the request with publisher settings (floors, blocked categories) and user data from a low-latency store.

### 2) Fanning out to bidders

The auction service picks **eligible bidders** for the request (by geography, format and each bidder's request quota), sends bid requests in parallel over **persistent HTTP/2 connections**, and waits until the deadline. Late responses are discarded.

```diagram Auction
node page 0,1 box "Publisher Page"
node auction 1.6,1 box "Auction Service"
node b1 3.2,0 box "Bidder A"
node b2 3.2,1 box "Bidder B"
node b3 3.2,2 box "Bidder C"
node log 1.6,2.4 circle "Event Log"
edge page <-> auction "ad request / ad"
edge auction <-> b1 "bid req (80ms)"
edge auction <-> b2
edge auction <-> b3
edge auction -> log
```

### 3) Running the auction

Valid bids above the floor are ranked; the winner pays the clearing price (first-price is now standard in display ads; second-price historically). The exchange returns the winning creative and sends a **win notice** to the winning bidder.

### 4) Logging and billing

Every auction outcome is logged. Billing is based on **impressions** — the pixel fired when the ad actually renders — not wins, since many won ads never display. Events flow through **Kafka** into deduplicated aggregation for billing and reporting.

## Potential Deep Dives

### 1) How do we meet the 100 ms deadline?

:::solution bad Wait for every bidder
#### Approach

Send to all bidders and wait for all responses.

#### Challenges

One slow bidder makes every auction slow, and pages render without ads.
:::

:::solution good Hard per-auction timeout
#### Approach

Wait at most ~80 ms, then run the auction with whatever has arrived.

#### Challenges

Bidders that are usually slow still consume resources on every request, and fanning out to everyone wastes bandwidth.
:::

:::solution great Timeouts plus adaptive traffic shaping
#### Approach

Use a hard deadline, and **shape traffic** per bidder: track each bidder's latency, timeout rate and bid rate, and send them only the requests they're likely to bid on and can answer in time (bidders also publish targeting preferences). Keep **regional** auction clusters close to both users and bidders' data centres, persistent connections, and compact encodings (protobuf). Slow or failing bidders are throttled automatically.

#### Challenges

Traffic shaping must stay fair and transparent to bidders who pay for access.
:::

### 2) How does a bidder decide and pace budgets in ~50 ms?

The bidder keeps campaigns and targeting in an **in-memory index**, matches the request, predicts click/conversion probability with a fast model, and computes a bid. Budgets are stored centrally but **each bidder node gets a slice** of the remaining budget for the next few seconds (pacing tokens), so it can decide locally without a network call. Spend from impressions flows back to reconcile, and the pacing controller adjusts each campaign's bid rate to spread spend over the day.

:::tip
Mention that pacing aims to spend evenly over the day — not to run out by 9 a.m. — so the controller throttles bid participation probability, not just price.
:::

### 3) How do we bill exactly once at millions of events per second?

Impression and click URLs carry a **signed auction ID** so they can't be forged. Pipelines **deduplicate** by auction ID (a pixel can fire twice) in a streaming job, aggregate spend per campaign and publisher, and write results to a store for billing. A daily batch job recomputes totals from the raw logs to reconcile the streaming numbers before invoices go out.

### Final Design

```diagram Final Design
node page 0,1 box "Publishers"
node lb 1.4,1 box "Edge LB|anycast"
node auction 2.8,1 box "Auction Service|shaping + timeout"
node ctx 2.8,-0.3 circle "Context Store"
node bidders 4.2,1 box "External Bidders"
node kafka 2.8,2.4 box "Kafka|auctions · imps · clicks"
node stream 4.2,2.4 box "Dedupe + Aggregation"
node bill 5.6,2.4 circle "Billing Store"
edge page <-> lb
edge lb <-> auction
edge auction <-> ctx
edge auction <-> bidders "bid req / bids"
edge auction -> kafka
edge page -> kafka "imp / click pixels"
edge kafka -> stream
edge stream -> bill
```

```quiz
[
  {
    "question": "Why does the exchange enforce a hard bid deadline?",
    "options": ["Bidders prefer it", "Ads must be chosen while the page loads, so slow bidders can't delay auctions", "To save storage", "It's required by HTTP"],
    "answer": 1,
    "explanation": "Late bids are discarded."
  },
  {
    "question": "What is traffic shaping in RTB?",
    "options": ["Compressing images", "Sending each bidder only requests they're likely to bid on and answer in time", "Blocking all bidders", "Rate limiting users"],
    "answer": 1,
    "explanation": "It reduces wasted fan-out and timeouts."
  },
  {
    "question": "Why bill on impressions rather than auction wins?",
    "options": ["Wins are secret", "Many won ads never render, so impressions reflect actual delivery", "Impressions are cheaper", "Bidders refuse to pay"],
    "answer": 1,
    "explanation": "The impression pixel confirms the ad was shown."
  },
  {
    "question": "How do bidder nodes pace budgets without a network call per request?",
    "options": ["They ignore budgets", "Each node gets a local slice of remaining budget that is refreshed frequently", "They query a database each time", "Advertisers approve each bid"],
    "answer": 1,
    "explanation": "Local tokens keep decisions within the latency budget."
  }
]
```
