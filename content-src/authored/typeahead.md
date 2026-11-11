---
title: Typeahead Suggestions
seoTitle: Design Typeahead Search Suggestions (Autocomplete)
description: Design search autocomplete — returning the top suggestions for a prefix in milliseconds using tries or prefix indexes, precomputed rankings, and edge caching.
tags: Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Facebook, Google, Expedia, Bloomberg | 2
---

## Understanding the Problem

:::definition ⌨️ What is Typeahead?
Typeahead (autocomplete) suggests completions as a user types into a search box — type "sys" and see "system design", "systemctl", "sysadmin jobs".
:::

### Functional Requirements

**Core Requirements**

1. As a user types, return the top 10 suggestions that start with the current prefix.
2. Suggestions should be ranked by popularity (how often they're searched).
3. Popularity should reflect recent searches, updated at least daily.

**Below the line (out of scope):**

- Personalised suggestions and spelling correction.
- Multi-language support.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Very low latency: suggestions must appear in < 100ms, ideally < 50ms server time — one request per keystroke.
2. Highly available; slightly stale rankings are fine.
3. Scale to 100k+ suggestion requests per second at peak.

**Below the line (out of scope):**

- Filtering offensive suggestions.

```sketch Typeahead Requirements
Functional
- top 10 suggestions for a prefix
- ranked by popularity
- refreshed at least daily

Non-functional
- < 100ms per keystroke
- available, staleness ok
- 100k+ req/s
```

## The Set Up

### Defining the Core Entities

1. **Query term**: a search phrase and its popularity score.
2. **Prefix**: a string the user has typed so far.
3. **Search log**: raw records of completed searches, used to compute popularity.

### API or System Interface

```
GET /suggestions?prefix=sys&limit=10 -> ["system design", "systemctl", ...]
```

## High-Level Design

### 1) Return the top suggestions for a prefix

The core data structure is a **trie**: each node represents a prefix, and we store at every node the **precomputed top-10 completions** for that prefix. A lookup walks down `s → sy → sys` and returns the list stored there — O(length of prefix), no searching through descendants at query time.

```diagram Serving suggestions
node client 0,1 box "Client|- debounce 100ms"
node cdn 1.3,1 circle "CDN / edge cache"
node svc 2.6,1 box "Suggestion Service|- in-memory trie"
node store 3.9,1 circle "Trie Snapshots|(S3)"
edge client <-> cdn "GET /suggestions"
edge cdn <-> svc "miss"
edge store -> svc "load on start"
```

### 2) Rank suggestions by popularity

Search logs flow into a data pipeline. A daily (or hourly) batch job counts queries, optionally weighting recent searches more, and keeps the top terms. It then builds a new trie with top-10 lists at every node and writes it as a snapshot.

### 3) Keep rankings fresh

Suggestion servers load the new snapshot and swap it in atomically. Readers never see a half-built trie, and rollbacks are just "load the previous snapshot".

## Potential Deep Dives

### 1) How do we answer each keystroke within 50ms?

:::solution bad Query the database with LIKE 'prefix%'
#### Approach

Store terms in a table and run `SELECT ... WHERE term LIKE 'sys%' ORDER BY count DESC LIMIT 10`.

#### Challenges

Short prefixes match millions of rows; sorting them per keystroke is far too slow.
:::

:::solution good Trie in memory, computing top-K at query time
#### Approach

Walk to the prefix node, then traverse its subtree to find the 10 most popular terms.

#### Challenges

Fine for long prefixes, but the subtree under "s" is enormous.
:::

:::solution great Trie with precomputed top-K per node + caching
#### Approach

Store the top 10 at each node during the offline build, so lookups are a single walk. Shard the trie by prefix range if it doesn't fit on one machine, and cache popular prefixes at the CDN/edge with short TTLs — the first one or two characters are requested constantly. Clients debounce keystrokes and cache recent responses locally.

#### Challenges

Storing lists at every node costs memory; cap list size and prune rare terms.
:::

### 2) How do we update popularity without rebuilding everything constantly?

:::solution good Rebuild the whole trie daily
#### Approach

A batch job recomputes counts and publishes a full snapshot.

#### Challenges

Simple and robust; trending topics take up to a day to appear.
:::

:::solution great Batch baseline + streaming trending layer
#### Approach

Keep the daily batch trie as the baseline, and add a small streaming layer (e.g. Flink counting the last hour of searches) that boosts sharply trending terms. The service merges trending candidates into the baseline top-10 at query time.

#### Challenges

Two systems to operate; the trending layer must be protected against manipulation.
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Client|- debounce + cache"
node cdn 1.3,1.2 circle "Edge Cache"
node svc 2.6,1.2 box "Suggestion Service|- sharded tries"
node trend 2.6,2.4 circle "Trending|(Redis)"
node logs 3.9,0 circle "Search Logs|(Kafka)"
node batch 5.1,0 box "Daily Builder|count + top-K"
node s3 5.1,1.2 circle "Trie Snapshots"
node stream 3.9,2.4 box "Stream Counter|(Flink)"
edge client <-> cdn
edge cdn <-> svc
edge svc <-> trend
edge logs -> batch
edge batch -> s3
edge s3 -> svc
edge logs -> stream
edge stream -> trend
```

```quiz
[
  {
    "question": "Why store the top-K completions at every trie node?",
    "options": ["To save memory", "So a lookup is a single walk with no subtree search at query time", "Because tries require it", "To support spelling correction"],
    "answer": 1,
    "explanation": "Precomputation moves the expensive ranking work offline."
  },
  {
    "question": "Why is LIKE 'prefix%' a poor fit for typeahead?",
    "options": ["SQL doesn't support it", "Short prefixes match huge numbers of rows that must be sorted per keystroke", "It returns suffixes", "It can't use strings"],
    "answer": 1,
    "explanation": "The cost explodes for the most common, shortest prefixes."
  },
  {
    "question": "What does client-side debouncing achieve?",
    "options": ["Better rankings", "Fewer requests by waiting until the user pauses typing", "Encryption", "Personalisation"],
    "answer": 1,
    "explanation": "Skipping intermediate keystrokes cuts load substantially."
  },
  {
    "question": "How can trending terms appear faster than the daily rebuild?",
    "options": ["Rebuild every second", "A streaming counter that boosts recent popular terms at query time", "Ask users", "Disable caching"],
    "answer": 1,
    "explanation": "A small real-time layer complements the stable batch baseline."
  }
]
```
