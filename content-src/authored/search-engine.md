---
title: Web Search Engine
seoTitle: Design a Web Search Engine
description: Design web search — building a sharded inverted index from crawled pages, query serving with scatter-gather, ranking, snippets, and index freshness.
tags: Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🔎 What is a Web Search Engine?
A search engine takes a query like "best hiking boots" and returns the most relevant web pages in a fraction of a second, from an index of billions of documents built from a web crawl.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to enter a text query and receive a ranked list of results with titles and snippets.
2. Results should be paginated.
3. Newly crawled or updated pages should become searchable.

**Below the line (out of scope):**

- The crawler itself (see [Web Crawler](/learn/system-design/problem-breakdowns/web-crawler)).
- Ads, images and personalisation.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Query latency < 300ms at p99.
2. Index tens of billions of pages.
3. Handle 100k+ queries per second.
4. Fresh: important pages updated within hours, the long tail within days.

**Below the line (out of scope):**

- Spam detection.

```sketch Search Engine Requirements
Functional
- query -> ranked results + snippets
- pagination
- new pages become searchable

Non-functional
- < 300ms p99
- tens of billions of pages
- 100k+ QPS
- fresh within hours/days
```

## The Set Up

### Defining the Core Entities

1. **Document**: a crawled page with URL, title, text, links and quality signals.
2. **Term**: a normalised word or token.
3. **Posting list**: for each term, the documents containing it (with positions and frequencies).
4. **Index shard**: a slice of the index covering a subset of documents.

### API or System Interface

```
GET /search?q=best+hiking+boots&page=1 -> { results: [{ url, title, snippet }], nextPage }
```

## High-Level Design

### 1) Build the index

An **indexing pipeline** consumes crawled pages: parse HTML, extract text, tokenise and normalise (lowercase, stemming), and build an **inverted index** mapping each term to a posting list of document IDs. Link analysis (PageRank) and quality signals are computed in batch and stored per document.

```diagram Indexing and serving
node crawl 0,0.2 circle "Crawled Pages"
node idx 1.4,0.2 box "Indexing Pipeline|- tokenize|- build postings"
node shards 2.8,0.2 circle "Index Shards"
node user 0,1.8 box "User"
node front 1.4,1.8 box "Query Frontend|- parse, spell"
node root 2.8,1.8 box "Root Aggregator|scatter-gather"
node leaf 4.2,1.8 box "Leaf Servers|one per shard"
edge crawl -> idx
edge idx -> shards
edge user <-> front
edge front <-> root
edge root <-> leaf
edge shards -> leaf "load"
```

### 2) Serve queries

The index is **sharded by document**: each leaf server holds a complete inverted index for its slice of documents. A query is sent to all shards in parallel (**scatter-gather**); each leaf finds matching documents, scores them, and returns its top results; the root merges them into the global top 10, then fetches snippets.

### 3) Make new pages searchable

A large base index is rebuilt periodically, while a small **real-time index** absorbs fresh and updated pages continuously. Queries search both and merge results.

## Potential Deep Dives

### 1) How should the index be partitioned?

:::solution good Shard by term
#### Approach

Each shard holds the full posting lists for a subset of terms.

#### Challenges

Multi-word queries must combine posting lists across shards over the network, and popular terms create hot shards.
:::

:::solution great Shard by document with replicas
#### Approach

Each shard indexes a subset of documents fully, so every query is answered locally per shard and merged at the root. Replicate each shard many times for query throughput, and add layers of aggregators to fan out to thousands of shards.

#### Challenges

Every query touches every shard, so tail latency of the slowest shard matters — use hedged requests and timeouts that return partial results.
:::

### 2) How do we rank results?

Ranking happens in stages: a fast score on each leaf (BM25 text relevance + static quality like PageRank) selects candidates, then a more expensive machine-learned ranker re-scores the merged top few hundred using many features (term proximity, freshness, click signals). Tiered indexes keep high-quality pages in a smaller tier searched first, so most queries never need the full index.

### 3) How do we keep latency low?

Cache results for popular queries (a large share of traffic repeats), compress posting lists (delta + variable-length encoding) so they fit in memory, early-terminate scoring once enough high-quality matches are found, and use hedged requests to cut tail latency.

### Final Design

```diagram Final Design
node user 0,1.4 box "Users"
node front 1.3,1.4 box "Query Frontend|- result cache"
node root 2.6,1.4 box "Root + Mid Aggregators|- ML re-ranking"
node leaf 4,0.6 box "Leaf Shards (base)|- BM25 + quality"
node rt 4,2.2 box "Real-time Index"
node docs 5.4,1.4 circle "Doc Store|snippets"
node pipe 5.4,0 box "Indexing Pipeline"
edge user <-> front
edge front <-> root
edge root <-> leaf
edge root <-> rt
edge root <-> docs
edge pipe -> leaf "rebuild"
edge pipe -> rt "fresh pages"
```

```quiz
[
  {
    "question": "What does an inverted index map?",
    "options": ["Documents to authors", "Each term to the documents containing it", "URLs to IPs", "Users to queries"],
    "answer": 1,
    "explanation": "Posting lists let queries find matching documents directly."
  },
  {
    "question": "Why shard the index by document rather than by term?",
    "options": ["It uses less disk", "Each shard can fully answer a query locally; results are merged at the root", "Terms can't be sharded", "For security"],
    "answer": 1,
    "explanation": "Term sharding requires cross-shard posting-list joins."
  },
  {
    "question": "What makes freshly crawled pages searchable quickly?",
    "options": ["Rebuilding the whole index every minute", "A small real-time index merged with the base index at query time", "Caching", "Manual submission"],
    "answer": 1,
    "explanation": "The real-time index absorbs updates between base rebuilds."
  },
  {
    "question": "Why use hedged requests in scatter-gather?",
    "options": ["To save bandwidth", "Sending a duplicate request to another replica cuts tail latency from slow shards", "To rank better", "For logging"],
    "answer": 1,
    "explanation": "The slowest shard determines query latency without hedging."
  }
]
```
