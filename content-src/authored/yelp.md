---
title: Yelp
seoTitle: Design a Local Business Review Site Like Yelp
description: Design Yelp — business search by location and keyword, reviews and ratings — with geospatial indexing, full-text search and consistent rating aggregates.
tags: Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Google, Meta, Amazon | 9
---

## Understanding the Problem

:::definition 🍽️ What is Yelp?
Yelp is an online platform that lets users discover local businesses — restaurants, salons, plumbers — by searching near a location, reading reviews, and leaving their own ratings.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to search for businesses by name, category, and location.
2. Users should be able to view a business and its reviews.
3. Users should be able to leave a review (a 1-5 star rating plus optional text) on a business.

**Below the line (out of scope):**

- Business owners claiming and editing their listings.
- Reservations, ordering, and messaging.
- Personalised recommendations.

:::tip
A common constraint interviewers add is that **each user may review a business only once**. It's worth asking about, because it changes the data model and how you validate writes.
:::

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. The system should have low latency for search (< 500ms).
2. The system should be highly available for search and viewing; eventual consistency is fine for new reviews appearing.
3. The system should scale to 100M daily users and 10M businesses.
4. A user can only leave one review per business.

**Below the line (out of scope):**

- Spam and fake-review detection.
- GDPR and data residency.

The defining property of Yelp is that it is **extremely read-heavy**. Millions of searches and page views happen for every review written — this should shape every decision we make.

```sketch Yelp Requirements
Functional
- search by name, category, location
- view business + reviews
- leave a review (1 per user/business)

Non-functional
- low latency search (< 500ms)
- availability >> consistency
- 100M DAU, 10M businesses
```

## The Set Up

### Planning the Approach

We'll build the design by walking through each functional requirement in order, then use our deep dives to hit the non-functional requirements — especially search latency and keeping average ratings correct.

### Defining the Core Entities

1. **Business**: name, location (lat/long), category, address, and an aggregate average rating.
2. **User**: the person searching and reviewing.
3. **Review**: a rating and optional text, written by one user about one business.

```sketch Yelp Entities
Core Entities
- Business
- User
- Review
```

### API or System Interface

Search takes optional filters and returns a paginated list of partial business objects:

```
GET /businesses?query&category&lat&long&radius&page -> Partial<Business>[]
```

Viewing a business returns its details along with the first page of reviews:

```
GET /businesses/:businessId -> Business & Review[]
GET /businesses/:businessId/reviews?cursor -> Review[]
```

Leaving a review:

```
POST /businesses/:businessId/reviews
{
  "rating": 4,
  "text": "Great tacos, slow service."
}
```

:::warning
The userId comes from the authenticated session (JWT), never from the request body — otherwise anyone could post reviews as someone else.
:::

## High-Level Design

### 1) Users should be able to search for businesses

We start with a client, an API Gateway that handles routing, authentication and rate limiting, and a **Business Service** backed by a relational database.

```diagram Search businesses
node client 0,1 box "Client"
node gw 1,1 box "API Gateway|- routing|- auth"
node biz 2.3,1 box "Business Service"
node db 3.8,1 circle "Database"
note 4.3,0.55 "Business|- id|- name|- category|- lat, long|- avgRating|- numRatings"
edge client <-> gw "GET /businesses"
edge gw <-> biz
edge biz <-> db
```

1. The client sends `GET /businesses` with the query, category, and the user's location.
2. The API Gateway forwards the request to the Business Service.
3. The Business Service queries the Business table, filtering by category and a bounding box around the location, and matches the name with `LIKE`.
4. Results are returned to the client, paginated.

This works for a demo, but a `LIKE '%taco%'` query plus a lat/long range filter can't use indexes efficiently. We'll fix both in the deep dives.

### 2) Users should be able to view a business and its reviews

Viewing a business is a primary-key lookup on the Business table plus a query on the Review table by `businessId`, ordered by creation time. Because reviews can be numerous, we paginate them with a cursor.

### 3) Users should be able to leave a review

We add a **Review Service** that owns writes to the Review table. Separating it from the Business Service lets us scale the read path independently — reads outnumber writes by orders of magnitude.

```diagram Leave a review
node client 0,1 box "Client"
node gw 1,1 box "API Gateway|- routing|- auth"
node biz 2.3,0.4 box "Business Service"
node rev 2.3,1.6 box "Review Service"
node db 3.8,1 circle "Database"
note 4.3,0.3 "Business|- id|- name|- avgRating|- numRatings"
note 4.3,1.25 "Review|- id|- userId|- businessId|- rating|- text"
edge client <-> gw
edge gw <-> biz "search / view"
edge gw <-> rev "POST review"
edge biz <-> db
edge rev <-> db
```

1. The client sends `POST /businesses/:businessId/reviews`.
2. The Review Service validates the rating (1-5) and writes a row to the Review table.
3. The response returns once the review is durably stored.

## Potential Deep Dives

### 1) How do we keep the average rating fast to read and correct?

Search results and business pages all show the average rating, so recomputing it on every read is out of the question.

:::solution bad Compute the average on every read
#### Approach

Run `SELECT AVG(rating) FROM reviews WHERE business_id = ?` whenever a business is shown.

#### Challenges

A popular business may have tens of thousands of reviews and appears in thousands of searches per second. Aggregating on every read wastes enormous amounts of database work and blows our latency budget.
:::

:::solution good Periodic batch recompute
#### Approach

Store `avgRating` and `numRatings` on the Business row and recompute them with a cron job every few minutes.

#### Challenges

Ratings are stale between runs, and the job grows with the dataset. A newly reviewed business shows the old rating — acceptable for many products, but users notice when their own review doesn't move the number.
:::

:::solution great Synchronous update in a transaction
#### Approach

Store `avgRating` and `numRatings` on the Business row and update them in the **same transaction** that inserts the review:

```
BEGIN;
INSERT INTO reviews (user_id, business_id, rating, text) VALUES (...);
UPDATE businesses
SET avg_rating = (avg_rating * num_ratings + :rating) / (num_ratings + 1),
    num_ratings = num_ratings + 1
WHERE id = :business_id;
COMMIT;
```

Write volume is tiny (reviews are rare compared to reads), so the extra row lock is cheap. Reads now get a precomputed number for free.

#### Challenges

A single extremely popular business can see lock contention on its row. At Yelp's write volume this is not a real problem, but if it were, you could buffer rating deltas in a queue and apply them in small batches.
:::

### 2) How can we make search fast across name, category and location?

:::pattern Pattern: Scaling Reads
Search pages are hit far more often than businesses change, which makes this a classic case for read-optimised indexes and caching rather than more database replicas alone.
:::

:::solution bad Basic SQL with LIKE and lat/long ranges
#### Approach

Filter with `latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?` and `name LIKE '%term%'`.

#### Challenges

A B-tree index can only range-scan one dimension efficiently, so the database scans a wide strip of the map. Leading-wildcard `LIKE` can't use an index at all. Latency grows with the table.
:::

:::solution good Geospatial index in the database (PostGIS)
#### Approach

Store location as a geography column with a GiST index (PostGIS) and query with `ST_DWithin`. Add a full-text index (`tsvector` + GIN) on name and description for keyword matching.

#### Challenges

This keeps everything in Postgres, which is operationally simple. Combining geo, full-text and category filters in one query is possible but tuning ranking and relevance in SQL is awkward, and search load competes with transactional load.
:::

:::solution great Dedicated search engine (Elasticsearch)
#### Approach

Index businesses into Elasticsearch with a `geo_point` field, keyword fields for category, and analysed text for name and description. Use **change data capture** from the primary database to keep the index up to date.

A single query combines a `geo_distance` filter, a category `term` filter and a full-text `match`, then ranks by relevance and rating.

#### Challenges

The index is eventually consistent with the database — a new business may take a few seconds to appear, which our requirements allow. Running an Elasticsearch cluster adds operational cost.
:::

:::info
For predefined areas like "Pizza in San Francisco", the same query shape repeats constantly. Caching the first page of results by `(query, category, geohash prefix)` in Redis removes most of the load from the search cluster.
:::

### 3) How do we enforce one review per user per business?

The simplest correct answer is a database constraint: a **unique index on `(user_id, business_id)`** in the Review table. Application-level checks alone are racy — two concurrent requests could both pass the check — but the database guarantees uniqueness atomically and the second insert fails cleanly with a conflict we can return as `409`.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node gw 1,1.2 box "API Gateway|- routing|- auth|- rate limiting"
node biz 2.3,0.4 box "Business Service|- view business"
node search 2.3,1.2 box "Search Service"
node rev 2.3,2 box "Review Service|- txn: review + avg"
node es 3.7,0.9 circle "Elasticsearch"
node db 3.7,2 circle "Postgres"
node cache 3.7,0 circle "Redis Cache"
note 3.2,2.45 "unique(userId, businessId)"
edge client <-> gw
edge gw <-> biz
edge gw <-> search
edge gw <-> rev
edge search <-> es
edge biz <-> cache
edge rev <-> db
edge db -> es "CDC"
```

```quiz
[
  {
    "question": "Why is a plain B-tree index on latitude and longitude a poor fit for proximity search?",
    "options": ["B-trees cannot store decimals", "It can only range-scan one dimension efficiently", "It uses too little memory", "It requires a cache"],
    "answer": 1,
    "explanation": "A B-tree narrows one dimension at a time, so a 2D bounding-box query still scans a wide strip. Geospatial indexes partition both dimensions.",
    "section": "2-how-can-we-make-search-fast-across-name-category-and-location"
  },
  {
    "question": "What is the best way to guarantee a user leaves only one review per business?",
    "options": ["Check in the application before inserting", "A unique index on (user_id, business_id)", "Rate limit the endpoint", "Cache recent reviewers"],
    "answer": 1,
    "explanation": "Application checks race under concurrency; a unique constraint is enforced atomically by the database.",
    "section": "3-how-do-we-enforce-one-review-per-user-per-business"
  },
  {
    "question": "How should the average rating be kept fast to read and correct?",
    "options": ["Compute AVG() on every request", "Update avgRating and numRatings in the same transaction as the review insert", "Recompute nightly", "Store ratings only in the cache"],
    "answer": 1,
    "explanation": "Reviews are rare relative to reads, so maintaining the aggregate transactionally is cheap and always correct.",
    "section": "1-how-do-we-keep-the-average-rating-fast-to-read-and-correct"
  },
  {
    "question": "How does the Elasticsearch index stay in sync with the primary database?",
    "options": ["Clients write to both", "Change data capture from the database", "A nightly full export only", "It doesn't need to"],
    "answer": 1,
    "explanation": "CDC streams every change from the database log into the index, giving eventual consistency without dual writes."
  }
]
```
