---
title: Goodreads
seoTitle: Design an Online Book Review System that Aggregates Reviews
description: Design a book review platform like Goodreads that also aggregates reviews from other sources — canonical book records, matching external books to editions, rating aggregation, and read-heavy book pages.
tags: Scaling Reads, Managing Long Running Tasks
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📖 What is Goodreads?
Goodreads lets readers rate and review books, track what they're reading, and see a book's average rating. This version also **aggregates reviews from other sources** — retailers, review sites and publisher feeds — so a book page shows reviews and ratings from across the web. The tricky part is that the same book appears under many editions, titles and identifiers, and every source describes it differently.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to rate (1-5 stars) and review books, and keep shelves (want to read, reading, read).
2. Book pages should show the average rating, rating distribution and reviews.
3. The system should import reviews and ratings from external sources and attach them to the right book.
4. Users should be able to search for books by title, author or ISBN.

**Below the line (out of scope):**

- Social feed of friends' activity.
- Recommendations.
- Buying books.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Book pages load in < 300 ms; the workload is very read-heavy.
2. External imports should be accurate: a review must not be attached to the wrong book.
3. Ratings can update within minutes; consistency isn't critical.
4. Scale to ~20M books, ~100M users and hundreds of millions of reviews.
5. Respect each source's terms and rate limits.

**Below the line (out of scope):**

- Real-time review updates.

```sketch Book Review Requirements
Functional
- rate, review, shelves
- book page: avg, distribution, reviews
- import external reviews
- search

Non-functional
- pages < 300ms, read-heavy
- attach to the right book
- ratings fresh in minutes
- 20M books, 100M users
- polite to sources
```

## The Set Up

### Defining the Core Entities

1. **Work**: the abstract book ("Dune"), grouping all its editions.
2. **Edition**: a specific publication with ISBN, format, language, publisher.
3. **Review**: work, edition, author (user or external source), rating, text, source, external ID.
4. **Rating summary**: per work, count and distribution of stars per source.
5. **Source**: an external provider with credentials, schedule and rate limits.

### API or System Interface

```
GET  /works/:id -> { work, editions[], ratingSummary, reviews (paged, filter by source) }
POST /works/:id/ratings { stars }
POST /works/:id/reviews { text, stars, editionId? }
PUT  /me/shelves/:shelf { workId }
GET  /search?q=
(internal) importers write to /ingest/reviews
```

## High-Level Design

### 1) Users rate and review

Ratings and reviews are stored in a database sharded by work ID (so a book's reviews live together). Each user can have one rating per work, enforced by a unique key. Writes publish an event that updates the work's **rating summary**.

### 2) Book pages

A book page needs the work, its rating summary and the first page of reviews. The summary is a precomputed row (`count`, `sum`, histogram per source), and the page is cached in a CDN/Redis with a short TTL. Reviews are paged by helpfulness or date.

### 3) Importing external reviews

**Importers** per source (APIs, feeds or licensed data dumps) fetch new reviews on a schedule, normalise them into a common format, and pass them to a **matcher** that maps each external book reference to one of our works. Matched reviews are stored with `source` and `externalId` (so re-imports update rather than duplicate) and update the rating summary.

```diagram Import pipeline
node src 0,1 box "External Sources"
node imp 1.5,1 box "Importers|per source"
node norm 3,1 box "Normaliser"
node match 4.5,1 box "Book Matcher"
node db 4.5,2.3 circle "Reviews DB"
node review 6,1 box "Manual Review Queue"
edge src -> imp
edge imp -> norm
edge norm -> match
edge match -> db "matched"
edge match -> review "low confidence"
```

### 4) Search

Works and editions are indexed in **Elasticsearch** with title, author, series and ISBNs; results are grouped by work so users don't see 40 editions of the same novel.

## Potential Deep Dives

### 1) How do we match external books to the right work?

:::solution bad Match by title
#### Approach

Find a work with the same title.

#### Challenges

Thousands of books share titles ("Home", "Untitled"), and sources format titles differently ("Dune (Deluxe Edition)").
:::

:::solution good Match by ISBN
#### Approach

Use the ISBN when the source provides one, mapping the edition to its work.

#### Challenges

Many sources don't include ISBNs, some use internal IDs or ASINs, and ISBN data has errors.
:::

:::solution great Identifier first, then scored fuzzy matching
#### Approach

Try **strong identifiers** first (ISBN-10/13, ASIN, known cross-references). Otherwise compute a **match score** from normalised title (stripping subtitles and edition words), author names (with aliases), publication year and language, using a search index to fetch candidates. High-confidence matches are accepted automatically; borderline ones go to a **manual review queue**, and confirmed mappings are cached so the same external book never needs matching again.

#### Challenges

Thresholds must favour precision: an unmatched review is better than a review on the wrong book.
:::

### 2) How do we keep rating summaries correct and fast?

Updating a popular book's summary row on every rating creates a hot row. Instead, rating events are **aggregated in short batches** (per work per minute) and applied as increments. Because users can change or delete ratings, events carry the old and new values. A periodic job recomputes summaries from raw ratings to fix any drift. Summaries are kept **per source**, so the page can show "4.2 from readers here · 4.5 across retailers" rather than mixing different scales.

:::tip
Mention normalisation: some sources rate out of 10 or use thumbs up/down; convert to a common scale and label the source clearly.
:::

### 3) How do we import politely and reliably?

Each source has its own **scheduler** with rate limits, backoff and incremental fetching (since the last cursor or timestamp). Imports are idempotent by `(source, externalId)`. If a source changes its format, its importer fails in isolation and alerts, without affecting others. Licensing rules decide what we can display (some sources allow only ratings plus a link to the full review).

### Final Design

```diagram Final Design
node user 0,1 box "Readers"
node cdn 1.4,1 box "CDN|book pages"
node api 2.8,1 box "Book + Review API"
node db 4.2,1 circle "Reviews DB|by work"
node sum 4.2,-0.3 circle "Rating Summaries"
node agg 5.6,-0.3 box "Rating Aggregator"
node es 2.8,-0.3 circle "Search Index"
node ingest 5.6,1 box "Import Pipeline|+ matcher"
node src 7,1 box "External Sources"
edge user <-> cdn
edge cdn <-> api
edge api <-> db
edge api <-> sum
edge api <-> es
edge db -> agg "rating events"
edge agg -> sum
edge src -> ingest
edge ingest -> db
```

```quiz
[
  {
    "question": "Why separate works from editions?",
    "options": ["It saves storage", "Reviews and ratings belong to the book, while editions have different ISBNs and formats", "Editions are secret", "Search engines require it"],
    "answer": 1,
    "explanation": "Grouping editions under a work combines their reviews."
  },
  {
    "question": "What should the matcher try first?",
    "options": ["Title only", "Strong identifiers like ISBN or ASIN", "Random matching", "The cover image"],
    "answer": 1,
    "explanation": "Identifiers are precise; fuzzy matching is the fallback."
  },
  {
    "question": "What happens to low-confidence matches?",
    "options": ["Accepted anyway", "Sent to a manual review queue", "Deleted", "Attached to the most popular book"],
    "answer": 1,
    "explanation": "Precision matters more than coverage."
  },
  {
    "question": "How do we avoid duplicate reviews when re-importing?",
    "options": ["Delete all and reimport", "Upsert by (source, externalId)", "Compare text", "Ignore duplicates"],
    "answer": 1,
    "explanation": "The source's ID makes imports idempotent."
  }
]
```
