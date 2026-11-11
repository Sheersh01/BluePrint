---
title: Fraud Detection
seoTitle: Design a Real-Time Fraud Detection System
description: Design a real-time fraud detection system for payments — scoring transactions in milliseconds with rules and ML models, computing streaming features, and handling review and feedback loops.
tags: Real-time Updates, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🛡️ What is a Fraud Detection System?
A fraud detection system decides, while a payment is being processed, whether to approve it, block it, or ask for extra verification. It combines hand-written rules with machine-learning models that look at the transaction and the recent behaviour of the card, user, device and merchant.
:::

### Functional Requirements

**Core Requirements**

1. Every transaction should get a decision — approve, challenge (e.g. 3-D Secure / OTP) or decline — before the payment completes.
2. Analysts should be able to add and change rules without a deploy.
3. Suspicious transactions should be queued for human review.
4. Confirmed fraud (chargebacks, analyst labels) should feed back into models and rules.

**Below the line (out of scope):**

- Training the ML models themselves (we consume a trained model).
- Account-takeover detection at login.
- Anti-money-laundering reporting.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Low latency: a decision within ~100 ms p99, since it sits on the payment path.
2. High availability — if scoring fails, payments must still flow (fail open with a safe fallback).
3. Scale to ~10k transactions per second at peak.
4. Every decision must be auditable: what was scored, by which rules and model version.

**Below the line (out of scope):**

- Perfect accuracy — the goal is balancing fraud losses against false declines.

```sketch Fraud Detection Requirements
Functional
- approve / challenge / decline
- analysts change rules live
- review queue
- feedback from chargebacks

Non-functional
- < 100ms p99 on the payment path
- fail open safely
- 10k TPS peak
- auditable decisions
```

## The Set Up

### Defining the Core Entities

1. **Transaction**: amount, currency, card, user, merchant, device, IP, location, time.
2. **Feature**: a computed signal — "card's spend in the last hour", "distinct countries for this card today", "device age".
3. **Rule**: a condition and action, e.g. `amount > 2000 AND account_age_days < 2 → challenge`.
4. **Decision**: transaction, score, triggered rules, model version, outcome.
5. **Label**: confirmed fraud or legitimate, from chargebacks or reviewers.

### API or System Interface

```
POST /score { transaction }   -> { decision: approve|challenge|decline, score, reasons[] }
POST /rules { condition, action, mode: shadow|active }
GET  /review-queue?status=open
POST /labels { transactionId, label: fraud|legit }
```

## High-Level Design

### 1) Every transaction gets a decision

The **Payment Service** calls the **Scoring Service** synchronously before authorising. The scoring service loads features for the card, user, device and merchant from a low-latency **Feature Store**, runs the **rules engine** and the **ML model**, combines them into a decision, and returns within the latency budget.

```diagram Synchronous scoring
node pay 0,1 box "Payment Service"
node scoring 1.6,1 box "Scoring Service|rules + model"
node fs 3.2,0 circle "Feature Store|(Redis)"
node model 3.2,2 box "Model Server"
node log 1.6,2.4 circle "Decision Log"
edge pay <-> scoring "score(txn) -> decision"
edge scoring <-> fs "get features"
edge scoring <-> model "predict"
edge scoring -> log "audit"
```

### 2) Analysts change rules without a deploy

Rules are stored in a **Rules DB** and compiled into the scoring service's memory; services reload when rules change (pushed via a config channel). New rules start in **shadow mode**: they're evaluated and logged but don't affect decisions, so analysts can see how many transactions they'd catch before activating them.

### 3) Suspicious transactions go to review

Transactions that were challenged, or scored in a grey zone, are published to a **review queue**. Analysts see the transaction, its features and the reasons it was flagged, and label it.

### 4) Feedback improves future decisions

Labels from reviewers and **chargebacks** (which can arrive weeks later) are joined with the logged features at decision time and stored as training data. Models are retrained periodically and deployed after offline evaluation and a shadow period.

## Potential Deep Dives

### 1) How do we compute behavioural features in real time?

The most predictive signals are about recent behaviour: "five transactions on this card in the last ten minutes" or "first purchase from this country".

:::solution bad Query the transactions database at scoring time
#### Approach

On every score request, run aggregate SQL queries over the card's recent transactions.

#### Challenges

Several aggregate queries per transaction blow the 100 ms budget and overload the payments database at 10k TPS.
:::

:::solution good Batch-computed features
#### Approach

Compute features hourly in a batch job and load them into Redis.

#### Challenges

Fast and cheap to read, but stale — a fraudster testing a stolen card makes dozens of attempts within minutes, all invisible to hourly features.
:::

:::solution great Streaming features plus batch features
#### Approach

Every transaction event flows through **Kafka** into a stream processor (**Flink**) that maintains **windowed aggregates** per card, user, device and merchant (counts and sums over 1 min, 1 h, 24 h) and writes them to the online feature store within seconds. Long-term features (account age, historical chargeback rate) come from batch jobs. The scoring service also applies the current transaction itself on top, so the very latest attempt is counted.

#### Challenges

Feature definitions must be identical in training and serving to avoid skew — define them once in a feature platform that generates both the streaming job and the offline backfill.
:::

### 2) How do we stay within the latency budget and fail safely?

Fetch all features in **one batched read** (pipelined `MGET`) and run rules and the model in parallel. Give every dependency a **strict timeout**; if the feature store or model is slow, fall back to rules-only scoring with conservative thresholds. If the scoring service itself is down, the payment service **fails open** for low-risk transactions (small amounts, known cards) and challenges the rest, rather than blocking all payments.

:::tip
Say out loud what happens when scoring is unavailable. Blocking every payment is often worse than accepting a slightly higher fraud rate for a few minutes.
:::

### 3) How do we combine rules and ML?

:::solution bad Rules only
#### Approach

Hand-written thresholds for amounts, velocities and countries.

#### Challenges

Easy to understand, but fraudsters learn the thresholds quickly, and rules multiply into thousands of conflicting conditions.
:::

:::solution great Layered decisions
#### Approach

Hard **block/allow rules** run first (sanctioned countries, known stolen cards, trusted merchants). The **ML model** produces a risk score from hundreds of features. **Policy thresholds** map score ranges to approve / challenge / decline, tunable per merchant or region. Rules remain for fast reactions to new attacks while models catch subtle patterns; reason codes from both are recorded for explainability.

#### Challenges

Requires model monitoring (score distribution drift, precision/recall on labels) and careful threshold tuning, since false declines cost real revenue.
:::

### 4) How do we detect fraud rings?

Individual transactions can look clean while a group of accounts shares devices, cards or addresses. A **graph** of users, devices, cards and IPs, updated from the event stream, lets you compute features like "number of accounts linked to this device" or "distance to a known fraudster", which are fed into the model.

### Final Design

```diagram Final Design
node pay 0,1 box "Payment Service"
node scoring 1.5,1 box "Scoring Service|rules + policy"
node model 3,2.2 box "Model Server"
node fs 3,1 circle "Feature Store|(online)"
node rules 1.5,-0.3 circle "Rules DB"
node kafka 3,-0.3 box "Kafka|txn events"
node flink 4.5,-0.3 box "Flink|windowed features"
node log 1.5,2.4 circle "Decision Log"
node review 0,2.4 box "Review Queue|+ labels"
edge pay <-> scoring
edge scoring <-> model
edge scoring <-> fs
edge rules -> scoring "hot reload"
edge pay -> kafka
edge kafka -> flink
edge flink -> fs
edge scoring -> log
edge log -> review
```

```quiz
[
  {
    "question": "Why compute velocity features with a stream processor rather than hourly batch jobs?",
    "options": ["It's cheaper", "Fraud attacks happen within minutes, so features must be seconds fresh", "Batch jobs can't count", "Regulations require it"],
    "answer": 1,
    "explanation": "Stolen-card testing produces bursts that hourly features miss."
  },
  {
    "question": "What should happen if the scoring service is unavailable?",
    "options": ["Block every payment", "Fail open for low-risk transactions and challenge the rest", "Retry forever", "Approve everything silently"],
    "answer": 1,
    "explanation": "Graceful degradation keeps revenue flowing while limiting risk."
  },
  {
    "question": "What is shadow mode for rules?",
    "options": ["Rules hidden from analysts", "Evaluating and logging a rule without affecting decisions", "Rules that run at night", "Encrypted rules"],
    "answer": 1,
    "explanation": "Shadow mode measures a rule's impact before it can decline real customers."
  },
  {
    "question": "Why log the features used at decision time?",
    "options": ["For marketing", "For auditability and to build training data that matches serving", "To speed up scoring", "It's free"],
    "answer": 1,
    "explanation": "Logged features explain decisions and avoid training/serving skew when joined with later labels."
  }
]
```
