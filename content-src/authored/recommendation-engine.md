---
title: Recommendation Engine
seoTitle: Design a Recommendation System Like Netflix's
description: Design a recommendation engine — candidate generation, ranking, feature stores, offline training vs. online serving, and feedback loops.
tags: Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🎬 What is a Recommendation Engine?
A recommendation engine picks which items — movies, products, videos — to show each user, ordered by how likely they are to engage. Netflix's home rows and Amazon's "customers also bought" are classic examples.
:::

### Functional Requirements

**Core Requirements**

1. Users should see a personalised list of recommended items on the home page.
2. Item pages should show "similar items".
3. Recommendations should adapt to user behaviour (views, ratings, purchases).

**Below the line (out of scope):**

- Search ranking.
- Ads.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Low latency: recommendations returned in < 200ms.
2. Scale to 200M users and millions of items.
3. Fresh enough: new behaviour reflected within minutes to hours; new items recommendable within a day.
4. Highly available — fall back to popular items rather than show nothing.

**Below the line (out of scope):**

- Fairness and diversity research.

```sketch Recommendation Requirements
Functional
- personalised home list
- similar items
- adapts to behaviour

Non-functional
- < 200ms
- 200M users, millions of items
- fresh within minutes-hours
- fall back to popular
```

## The Set Up

### Defining the Core Entities

1. **User**: profile and behaviour history.
2. **Item**: metadata (genre, price, tags).
3. **Interaction**: user × item events (view, click, rating, purchase) with timestamps.
4. **Embedding**: learned vector representing a user or item.
5. **Feature**: precomputed signals used for ranking (e.g. user's genre affinity, item popularity).

### API or System Interface

```
GET /recommendations?userId&context=home&limit=50 -> Item[]
GET /items/:id/similar?limit=20 -> Item[]
POST /events { userId, itemId, type, ts }   (behaviour logging)
```

## High-Level Design

### 1) Personalised home recommendations

Serving uses a two-stage funnel:

```diagram Two-stage recommendation funnel
node client 0,1 box "Client"
node api 1.3,1 box "Recommendation API"
node cand 2.6,0.2 box "Candidate Generation|- ANN over embeddings|- popular / trending"
node rank 2.6,1.8 box "Ranker|(ML model)"
node fs 4,1.8 circle "Feature Store"
node ann 4,0.2 circle "Vector Index"
edge client <-> api
edge api -> cand "1. ~1000 candidates"
edge cand <-> ann
edge api -> rank "2. score + order"
edge rank <-> fs
```

1. **Candidate generation** cheaply pulls ~1,000 plausible items from several sources: nearest neighbours of the user's embedding in a vector index, items similar to recently watched ones, and trending items.
2. **Ranking** scores the candidates with a richer model using features from a **feature store** (user history, item stats, context like time of day) and returns the top results, with business rules (remove already-watched, diversify genres).

### 2) Similar items

Precompute each item's nearest neighbours offline (by embedding similarity or co-occurrence: "people who watched X also watched Y") and store the lists in a key-value store for instant lookup.

### 3) Adapt to behaviour

Interaction events stream through Kafka. Offline pipelines retrain models and recompute embeddings daily; a streaming job updates real-time features (e.g. "last 5 items watched") so the ranker reacts within minutes.

## Potential Deep Dives

### 1) How do we serve within 200ms for 200M users?

:::solution bad Score every item at request time
#### Approach

Run the ranking model over the whole catalog.

#### Challenges

Millions of model evaluations per request is far too slow.
:::

:::solution good Precompute recommendations offline
#### Approach

A nightly batch job computes each user's top 100 and stores them; serving is a key lookup.

#### Challenges

Fast, but stale — it ignores what the user did five minutes ago, and wastes work on inactive users.
:::

:::solution great Online two-stage funnel with precomputed embeddings
#### Approach

Precompute embeddings offline, use approximate nearest-neighbour search (e.g. HNSW) for candidates in milliseconds, then rank a few hundred items online with fresh features. Cache results per user for a short time and fall back to precomputed or popular lists on timeouts.

#### Challenges

More infrastructure: vector index, feature store and model serving must all meet latency budgets.
:::

### 2) How do we handle new users and new items?

The **cold-start** problem: new users have no history, and new items have no interactions. For users, start from popular and trending items, onboarding preferences, and context (country, device). For items, use content features (genre, description embeddings) to place them near similar items, and reserve a small amount of exposure to gather signal (exploration).

### 3) How do we avoid training/serving skew?

Compute features in one place — a **feature store** with the same definitions for offline training and online serving — and log the exact features used at serving time so training data matches production.

### Final Design

```diagram Final Design
node client 0,1.2 box "Clients"
node api 1.3,1.2 box "Recommendation API|- cache + fallback"
node cand 2.6,0.2 box "Candidate Gen|ANN + rules"
node rank 2.6,1.4 box "Ranker"
node ann 4,0.2 circle "Vector Index"
node fs 4,1.4 circle "Feature Store"
node kafka 2.6,2.6 circle "Event Stream"
node train 4,2.6 box "Offline Training|+ embeddings"
node stream 5.3,1.4 box "Streaming Features"
edge client <-> api
edge api <-> cand
edge api <-> rank
edge cand <-> ann
edge rank <-> fs
edge client -> kafka "events"
edge kafka -> train
edge kafka -> stream
edge stream -> fs
edge train -> ann
edge train -> fs
```

```quiz
[
  {
    "question": "Why split recommendation serving into candidate generation and ranking?",
    "options": ["For simplicity only", "Ranking the full catalog per request is too slow; cheap retrieval narrows candidates first", "Models require it", "To save storage"],
    "answer": 1,
    "explanation": "A funnel keeps expensive models on a small set."
  },
  {
    "question": "What does approximate nearest-neighbour search provide?",
    "options": ["Exact matches", "Fast retrieval of items with embeddings close to the user's", "Encryption", "Sorting by price"],
    "answer": 1,
    "explanation": "ANN indexes like HNSW find similar vectors in milliseconds."
  },
  {
    "question": "How do you recommend to a brand-new user?",
    "options": ["Show nothing", "Popular/trending items, onboarding choices and context", "Random items only", "Wait a week"],
    "answer": 1,
    "explanation": "Cold-start relies on non-personal signals until history accrues."
  },
  {
    "question": "What is a feature store for?",
    "options": ["Storing videos", "Consistent feature definitions for both training and serving", "Caching HTML", "User passwords"],
    "answer": 1,
    "explanation": "It prevents training/serving skew."
  }
]
```
