---
title: News Aggregator
seoTitle: Design a News Aggregator Like Google News
description: Design a news aggregator — crawling publisher feeds, deduplicating stories, and serving a fast paginated feed of recent articles by category.
tags: Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Google, Microsoft, Yahoo | 7
---

## Understanding the Problem

:::definition 📰 What is a News Aggregator?
A news aggregator (like Google News) collects articles from thousands of publishers, groups them, and shows users a single feed of the latest stories — linking out to the original publisher to read the full article.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view a feed of recent articles, newest first.
2. Users should be able to filter the feed by category (e.g. Technology, Sports).
3. Users should be able to page through the feed with infinite scroll.
4. Clicking an article should take the user to the publisher's site.

**Below the line (out of scope):**

- Personalised ranking and recommendations.
- User accounts, comments and saved articles.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. New articles should appear within ~30 minutes of publication.
2. The feed should load fast (< 200ms) and be highly available.
3. The system should scale to 100M daily users with traffic spikes during breaking news.
4. The same story shouldn't appear multiple times from syndicated copies.

**Below the line (out of scope):**

- Paywall handling.
- Content moderation.

```sketch News Aggregator Requirements
Functional
- feed of recent articles
- filter by category
- infinite scroll
- click through to publisher

Non-functional
- fresh within 30 min
- feed < 200ms, highly available
- 100M DAU, breaking-news spikes
- dedupe syndicated stories
```

## The Set Up

### Planning the Approach

There are two halves: an **ingestion pipeline** that pulls content in, and a **serving path** that's overwhelmingly read-heavy. We'll design each, then go deep on freshness, pagination and caching.

### Defining the Core Entities

1. **Publisher**: a news source with one or more RSS/Atom feeds.
2. **Article**: title, summary, thumbnail URL, link, category, publishedAt.
3. **Category**: a topic used for filtering.

```sketch News Aggregator Entities
Core Entities
- Publisher
- Article
- Category
```

### API or System Interface

```
GET /feed?category={category}&cursor={cursor}&limit=20 -> { articles: Article[], nextCursor }
```

Clicks go straight to the publisher URL; if we want click tracking, we can redirect through `GET /articles/:id/visit -> 302`.

## High-Level Design

### 1) Ingest articles from publishers

A **Feed Collector** fetches each publisher's RSS feed on a schedule, parses new entries, and writes Articles to the database. Thumbnails are downloaded once and stored in blob storage so we don't hotlink publisher images.

```diagram Ingestion
node pubs 0,1 circle "Publisher|RSS feeds"
node col 1.4,1 box "Feed Collector|- fetch & parse"
node db 2.8,1 circle "Articles DB"
node s3 1.4,2.2 circle "S3|thumbnails"
note 3.3,1 "Article|- id|- title|- summary|- url|- category|- publishedAt"
edge col <-> pubs "poll"
edge col -> db
edge col -> s3
```

### 2) Users should be able to view and filter the feed

A **Feed Service** queries the latest articles, optionally filtered by category, ordered by `publishedAt DESC`, and returns a page plus a cursor.

```diagram Serving the feed
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node feed 2.4,1 box "Feed Service"
node db 3.7,1 circle "Articles DB"
edge client <-> gw "GET /feed"
edge gw <-> feed
edge feed <-> db
```

## Potential Deep Dives

### 1) How do we keep the feed fresh without hammering publishers?

:::solution bad Poll every feed every minute
#### Approach

Fetch every one of ~50k publisher feeds on a fixed short interval.

#### Challenges

Most feeds haven't changed, so the vast majority of requests are wasted, and aggressive polling can get us rate-limited or blocked by publishers.
:::

:::solution good Adaptive polling with conditional requests
#### Approach

Poll each feed at an interval based on how often it publishes (busy outlets every few minutes, quiet blogs hourly), and use `ETag` / `If-Modified-Since` headers so unchanged feeds return a cheap `304 Not Modified`.

#### Challenges

Still polling, so freshness is bounded by each feed's interval — but well within our 30-minute target.
:::

:::solution great Adaptive polling plus push where available
#### Approach

Subscribe via **WebSub** (PubSubHubbub) for publishers that support it so new articles are pushed to us instantly; fall back to adaptive polling for everyone else. Collectors are sharded by publisher and fed from a scheduling queue.

#### Challenges

Push endpoints need verification and must be idempotent, since the same item can arrive by both push and poll.
:::

### 2) How do we paginate a feed that keeps changing?

:::solution bad Offset pagination
#### Approach

`LIMIT 20 OFFSET 40` for page three.

#### Challenges

New articles arriving at the top shift everything down, so users see duplicates when they scroll. Large offsets are also slow.
:::

:::solution great Cursor pagination
#### Approach

Return a cursor encoding the last article's `(publishedAt, id)` and query `WHERE (published_at, id) < (:ts, :id) ORDER BY published_at DESC, id DESC LIMIT 20`. With an index on `(category, published_at, id)` each page is a fast index range scan, and new articles never cause duplicates.

#### Challenges

You can't jump to an arbitrary page number — which infinite scroll doesn't need.
:::

### 3) How do we serve 100M users and survive breaking-news spikes?

Everyone sees the same feed for a given category, which makes it extremely cacheable. Precompute the first few pages of each category feed into Redis whenever new articles are ingested, and put a **CDN** in front of the feed API with a short TTL (30-60 seconds). During a spike, nearly all requests are served from the edge and the database barely notices.

:::tip
Deduplicate syndicated stories (the same wire story on 40 sites) during ingestion: normalise the title and compute a similarity hash (e.g. SimHash) over the text, and group near-duplicates so the feed shows one entry.
:::

### Final Design

```diagram Final Design
node pubs 0,0.4 circle "Publishers"
node sched 1.3,0.4 box "Poll Scheduler|+ WebSub"
node col 2.6,0.4 box "Collectors|- parse|- dedupe (SimHash)"
node db 3.9,0.4 circle "Articles DB"
node cache 3.9,1.7 circle "Feed Cache|(Redis)"
node feed 2.6,1.7 box "Feed Service"
node cdn 1.3,1.7 circle "CDN"
node client 0,1.7 box "Client"
edge sched -> col
edge col <-> pubs
edge col -> db
edge col -> cache "precompute pages"
edge feed <-> cache
edge feed <-> db
edge cdn <-> feed
edge client <-> cdn
```

```quiz
[
  {
    "question": "Why is offset pagination a problem for a live news feed?",
    "options": ["It is not supported by SQL", "New articles shift results and cause duplicates while scrolling", "It needs a cache", "It sorts incorrectly"],
    "answer": 1,
    "explanation": "Cursor pagination anchors on the last item seen, so inserts at the top don't affect later pages.",
    "section": "2-how-do-we-paginate-a-feed-that-keeps-changing"
  },
  {
    "question": "What do ETag / If-Modified-Since headers save when polling RSS feeds?",
    "options": ["Unchanged feeds return a cheap 304 instead of the full body", "They encrypt the feed", "They push updates to us", "They remove the need for a scheduler"],
    "answer": 0,
    "explanation": "Conditional requests make polling an unchanged feed nearly free for both sides."
  },
  {
    "question": "Why does a non-personalised feed scale so well?",
    "options": ["It is smaller", "Every user sees the same pages, so they can be cached at a CDN", "It doesn't need a database", "It never changes"],
    "answer": 1,
    "explanation": "Shared responses can be served from edge caches with short TTLs.",
    "section": "3-how-do-we-serve-100m-users-and-survive-breaking-news-spikes"
  },
  {
    "question": "How can syndicated copies of the same story be grouped?",
    "options": ["Exact URL matching", "Similarity hashing such as SimHash over normalised text", "Random sampling", "Sorting by date"],
    "answer": 1,
    "explanation": "Near-duplicate detection catches the same wire story published on many sites with small edits."
  }
]
```
