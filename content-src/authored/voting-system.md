---
title: Online Voting System
seoTitle: Design an Online Voting System
description: Design an online voting system — verifying eligible voters, one vote per person, durable and auditable ballots, live tallies, and handling peak load.
tags: Dealing with Contention, Scaling Writes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🗳️ What is an Online Voting System?
An online voting system lets eligible people cast a vote in a poll or election — anything from a TV talent show to an organisation's board election — and produces trustworthy results.
:::

### Functional Requirements

**Core Requirements**

1. Only eligible, authenticated voters should be able to vote.
2. Each voter should be able to vote at most once per election.
3. Voters should receive confirmation that their vote was recorded.
4. Organisers should see live or final tallies.

**Below the line (out of scope):**

- Government-grade elections (which require far stronger guarantees than any web system — paper trails, in-person verification).
- Ranked-choice counting algorithms.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Correctness: no lost votes and no double votes.
2. Durability and auditability: every accepted vote can be verified later.
3. Handle bursts — e.g. 10M votes in the final 10 minutes of a TV vote.
4. Ballot secrecy where required: tallies shouldn't reveal how an individual voted.

**Below the line (out of scope):**

- Coercion resistance.

```sketch Voting Requirements
Functional
- eligible, authenticated voters
- one vote per voter
- confirmation receipt
- live / final tallies

Non-functional
- no lost or double votes
- durable + auditable
- 10M votes in 10 minutes
- ballot secrecy
```

## The Set Up

### Defining the Core Entities

1. **Election**: options, eligibility rules, open/close times.
2. **Voter**: an eligible identity (verified account, member ID).
3. **Participation record**: (electionId, voterId) — proves someone voted, without the choice when secrecy matters.
4. **Ballot**: the choice, stored separately from identity for secret ballots.
5. **Tally**: aggregated counts per option.

### API or System Interface

```
GET  /elections/:id -> { options, opensAt, closesAt }
POST /elections/:id/votes { optionId } (authenticated, Idempotency-Key) -> { receiptId }
GET  /elections/:id/results -> { counts }
GET  /receipts/:receiptId -> { recorded: true }
```

## High-Level Design

### 1) Only eligible voters vote

Voters authenticate (account login, emailed token, or membership credentials). The **Vote Service** checks eligibility rules for the election before accepting a ballot.

### 2) One vote per voter

```diagram Casting a vote
node voter 0,1 box "Voter"
node gw 1.3,1 box "API Gateway|- auth|- rate limit"
node vote 2.6,1 box "Vote Service"
node part 4,0.2 circle "Participation|unique(election, voter)"
node log 4,1.8 circle "Ballot Log|(append-only)"
node tally 5.4,1.8 box "Tally Workers"
edge voter <-> gw
edge gw <-> vote "POST /votes"
edge vote -> part "1. insert"
edge vote -> log "2. append ballot"
edge log -> tally
```

The Vote Service inserts a participation record with a **unique constraint on (electionId, voterId)**. Only if that insert succeeds does it append the ballot. Both happen in one transaction (or the ballot write is driven from the participation commit via an outbox), so a vote is never counted without the record, and never twice.

### 3) Confirm the vote

The response returns a receipt ID; the voter can later check that the receipt exists in the recorded set.

### 4) Tallies

Ballots stream from the append-only log to **tally workers** that aggregate counts per option. Live results read the aggregated counters; final results are recomputed from the full ballot log for verification.

## Potential Deep Dives

### 1) How do we prevent double voting under load?

:::solution bad Check "has voted?" then insert
#### Approach

Query for an existing vote, then insert if none.

#### Challenges

Two concurrent requests (double-click, retry) both pass the check.
:::

:::solution good Unique constraint on (election, voter)
#### Approach

Let the database reject the second insert atomically, and return the original receipt for retries using an idempotency key.

#### Challenges

Correct. At massive bursts, a single database may need partitioning by voter ID.
:::

:::solution great Partitioned participation store + durable ballot log
#### Approach

Partition participation records by `hash(voterId)` across shards, each enforcing uniqueness for its voters. Ballots are appended to a replicated log (Kafka) only after the participation write commits, and acknowledged to the voter only once durable. Tallying is asynchronous.

#### Challenges

More components; the outbox pattern keeps participation and ballot writes consistent.
:::

### 2) How do we handle the final-minutes surge?

Accept votes fast and count later: the write path only does an eligibility check, a unique insert and a log append. Pre-scale for the known close time, rate-limit abusive clients, and use a queue in front of the vote service if needed (returning "vote received" only after it's durably stored). Tally counters are updated in batches rather than per vote.

### 3) How do we keep ballots secret but auditable?

Store participation (who voted) and ballots (what was chosen) separately, with no direct link — ballots carry only a random receipt ID given to the voter. Voters can verify their receipt is counted, auditors can recount the ballot log, and neither table alone reveals individual choices.

:::warning
For public-office elections, online systems face threats (coercion, compromised devices, insider attacks) that software design alone can't solve. This design fits polls, contests and organisational votes.
:::

### Final Design

```diagram Final Design
node voter 0,1.2 box "Voters"
node gw 1.3,1.2 box "API Gateway|- auth|- rate limit"
node vote 2.6,1.2 box "Vote Service|- eligibility|- idempotency"
node part 4,0.2 circle "Participation|(sharded, unique)"
node kafka 4,1.6 circle "Ballot Log|(replicated)"
node tally 5.4,1.6 box "Tally Workers"
node res 5.4,0.2 circle "Results"
node audit 4,2.8 box "Audit Recount"
edge voter <-> gw
edge gw <-> vote
edge vote -> part
edge vote -> kafka
edge kafka -> tally
edge tally -> res
edge kafka -> audit
```

```quiz
[
  {
    "question": "What prevents the same voter voting twice under concurrency?",
    "options": ["Client-side checks", "A unique constraint on (electionId, voterId)", "Caching", "CAPTCHA"],
    "answer": 1,
    "explanation": "The database rejects the second insert atomically."
  },
  {
    "question": "How can ballots stay secret while still being auditable?",
    "options": ["Store choices with voter IDs", "Keep participation and ballots separate, linked only by a voter-held receipt", "Delete ballots after counting", "Encrypt the whole database"],
    "answer": 1,
    "explanation": "Neither table alone reveals individual choices."
  },
  {
    "question": "Why tally asynchronously from a ballot log?",
    "options": ["It's more secure", "The write path stays fast during bursts and results can be recomputed for audits", "Counters are illegal", "To hide results"],
    "answer": 1,
    "explanation": "Durable logging first, aggregation later."
  },
  {
    "question": "When should the voter be told their vote is recorded?",
    "options": ["Immediately on request", "Only after the ballot is durably stored", "After tallying", "Never"],
    "answer": 1,
    "explanation": "Acknowledging before durability risks lost votes."
  }
]
```
