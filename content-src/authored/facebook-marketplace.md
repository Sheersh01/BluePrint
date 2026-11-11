---
title: Facebook Marketplace
seoTitle: Design a Local Marketplace Like Facebook Marketplace
description: Design a peer-to-peer marketplace — creating listings with photos, searching nearby listings with filters, messaging sellers, and marking items sold.
tags: Scaling Reads, Handling Large Blobs
difficulty: easy
author: Editorial Team
published: Nov 10, 2026
askedAt: Facebook, Roblox | 0
---

## Understanding the Problem

:::definition 🛍️ What is Facebook Marketplace?
Facebook Marketplace lets people list items for sale — a used bike, a sofa — and lets buyers nearby browse, search, and message sellers to arrange a deal.
:::

### Functional Requirements

**Core Requirements**

1. Sellers should be able to create a listing with title, description, price, category, location and photos.
2. Buyers should be able to browse and search listings near them, with filters (category, price range, distance).
3. Buyers should be able to message a seller about a listing.
4. Sellers should be able to mark a listing as sold or delete it.

**Below the line (out of scope):**

- Payments and shipping.
- Personalised recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Search results in < 500ms.
2. New listings searchable within a minute; sold items disappear quickly.
3. Highly available browsing; eventual consistency is acceptable.
4. Scale to hundreds of millions of listings and 100M+ daily browsers.

**Below the line (out of scope):**

- Fraud and prohibited-item detection.

```sketch Marketplace Requirements
Functional
- create listing + photos
- search nearby w/ filters
- message seller
- mark sold / delete

Non-functional
- search < 500ms
- searchable within ~1 min
- available, eventual consistency
- 100s of millions of listings
```

## The Set Up

### Defining the Core Entities

1. **Listing**: seller, title, description, price, category, location, status, photo references.
2. **Photo**: image objects in blob storage with resized variants.
3. **Conversation / Message**: buyer ↔ seller messages tied to a listing.

### API or System Interface

```
POST  /listings { title, description, price, category, lat, lng, photoIds[] } -> Listing
GET   /listings/search?q&category&minPrice&maxPrice&lat&lng&radiusKm&cursor -> Listing[]
PATCH /listings/:id { status: "SOLD" }
POST  /listings/:id/conversations { message } -> Conversation
```

## High-Level Design

### 1) Sellers create listings

Photos upload directly to blob storage via presigned URLs; a worker creates thumbnails. The **Listing Service** writes the listing to the primary database and emits a change event.

```diagram Listings and search
node seller 0,0.3 box "Seller"
node buyer 0,1.7 box "Buyer"
node list 1.5,0.3 box "Listing Service"
node db 3,0.3 circle "Listings DB"
node es 3,1.7 circle "Search Index|(geo + text)"
node search 1.5,1.7 box "Search Service"
node s3 1.5,2.9 circle "Photos|(S3 + CDN)"
edge seller <-> list "create"
edge list -> db
edge db -> es "CDC"
edge buyer <-> search "search"
edge search <-> es
edge buyer <-> s3 "photos via CDN"
```

### 2) Buyers search nearby listings

A **search index** (Elasticsearch/OpenSearch) holds listings with a `geo_point`, category, price and text fields. A single query combines a distance filter, category and price filters, full-text match, and ranking by recency and distance.

### 3) Buyers message sellers

Messaging reuses a chat system (see [WhatsApp](/learn/system-design/problem-breakdowns/whatsapp)); each conversation is linked to a listing ID so sellers can see who's interested in what.

### 4) Sellers mark items sold

The status change writes to the database and propagates to the index, which filters out non-active listings.

## Potential Deep Dives

### 1) How do we make location + filter search fast?

:::solution bad SQL with distance math
#### Approach

`SELECT ... WHERE category = ? AND price BETWEEN ? AND ?` and compute distance for every row.

#### Challenges

Full scans over hundreds of millions of rows; no relevance ranking.
:::

:::solution good Geospatial index in the database
#### Approach

Use PostGIS or a geohash index so the database can find listings within a radius.

#### Challenges

Combining geo, text search, filters and ranking at high QPS stresses the primary database.
:::

:::solution great Dedicated search index fed by CDC
#### Approach

Index listings into a search engine with geo, text and filter fields, partitioned by region so queries only touch nearby shards. Keep it in sync with change data capture from the database. Cache popular browse queries (e.g. "Furniture near Austin", first page) for a short TTL.

#### Challenges

Eventual consistency between DB and index; a listing may take seconds to appear or disappear.
:::

### 2) How do we keep sold items out of results?

Index updates for status changes are prioritised, and the search service double-checks status for the page of results it returns (a cheap batch lookup in a cache), filtering anything marked sold since indexing. This avoids buyers messaging about items that are already gone.

### Final Design

```diagram Final Design
node client 0,1.2 box "Clients"
node gw 1.3,1.2 box "API Gateway"
node list 2.6,0.2 box "Listing Service"
node search 2.6,1.2 box "Search Service|- status recheck"
node chat 2.6,2.2 box "Messaging Service"
node db 4,0.2 circle "Listings DB"
node es 4,1.2 circle "Search Index|regional shards"
node cdn 1.3,2.4 circle "Photo CDN"
edge client <-> gw
edge client <-> cdn
edge gw <-> list
edge gw <-> search
edge gw <-> chat
edge list <-> db
edge db -> es "CDC"
edge search <-> es
```

```quiz
[
  {
    "question": "What's the best way to support 'bikes under $200 within 10 km'?",
    "options": ["SQL distance math on every row", "A search index with geo, text and filter fields", "Client-side filtering", "Caching every listing"],
    "answer": 1,
    "explanation": "Search engines combine geo filters, filters and text ranking efficiently."
  },
  {
    "question": "How does the search index stay in sync with the database?",
    "options": ["Manual exports", "Change data capture", "Clients write to both", "It doesn't"],
    "answer": 1,
    "explanation": "CDC streams every change into the index."
  },
  {
    "question": "How can you avoid showing just-sold items?",
    "options": ["Never cache", "Prioritise status updates and recheck status for returned results", "Delete listings immediately from S3", "Disable search"],
    "answer": 1,
    "explanation": "A cheap status recheck covers indexing lag."
  },
  {
    "question": "Where should listing photos be stored?",
    "options": ["In the listings table", "Blob storage served via CDN", "In the search index", "In Redis"],
    "answer": 1,
    "explanation": "Large binary files belong in object storage."
  }
]
```
