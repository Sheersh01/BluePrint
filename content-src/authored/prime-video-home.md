---
title: Prime Video Home
seoTitle: Design the Prime Video (Streaming Service) Home Page
description: Design the personalised home page of a video streaming service like Prime Video or Netflix — rows of titles chosen per user, candidate generation and ranking, entitlements, artwork, and serving millions of page loads quickly.
tags: Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📺 What is the Prime Video Home Page?
When you open a streaming app, the home page shows rows like "Continue watching", "Top 10 in your country" and "Because you watched…", each filled with title artwork. Every user sees a different page, it must load almost instantly on TVs, phones and browsers, and it can only include titles the user is entitled to watch in their country.
:::

### Functional Requirements

**Core Requirements**

1. Users should see a personalised home page: an ordered list of rows, each with an ordered list of titles.
2. Rows include personal ones (continue watching, watchlist, recommendations) and editorial or trending ones.
3. Only titles available in the user's region and entitled by their subscription should appear (with clear labels for rent/buy or add-on channels).
4. Users can scroll rows horizontally and the page vertically, loading more on demand.

**Below the line (out of scope):**

- Video playback.
- Search.
- Training recommendation models (see Recommendation Engine).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. The first screen renders in < 1 second, including on living-room devices.
2. Highly available: if personalisation fails, show a sensible non-personalised page rather than an error.
3. Scale to ~200M users with a big evening peak (~100k page loads per second).
4. "Continue watching" reflects what the user just watched within a minute.

**Below the line (out of scope):**

- Perfect freshness of recommendations (hours old is fine).

```sketch Home Page Requirements
Functional
- personalised rows of titles
- personal + editorial rows
- only entitled + regional titles
- lazy-load rows

Non-functional
- first screen < 1s
- degrade, never error
- 100k loads / s peak
- continue watching fresh
```

## The Set Up

### Defining the Core Entities

1. **Title**: movie or series, metadata, artwork variants, availability windows per region.
2. **Row**: type (personal, editorial, genre), title and a list of title IDs.
3. **Page**: ordered rows for a user on a device.
4. **Entitlement**: what a user can watch (subscription, channels, rentals).
5. **Viewing progress**: user, title/episode, position.

### API or System Interface

```
GET /home?device=tv&cursor= -> { rows: [{ id, title, items: [{ titleId, artUrl, badge }] }], nextCursor }
GET /rows/:rowId?cursor=        -> more items for a row
```

## High-Level Design

### 1) Building rows

Row content comes from several sources: **offline recommendation jobs** precompute "Because you watched" and "Top picks" per user each day; **editorial** rows are curated; **trending** rows are computed per region every few minutes; **continue watching** and **watchlist** come from live user stores.

### 2) Assembling the page

The **Home Service** gathers candidate rows for the user, filters items by **region and entitlements**, removes duplicates across rows, and ranks the rows themselves (a user who binges documentaries gets that row higher). It then **hydrates** each title with metadata and the right artwork for the device.

```diagram Page assembly
node app 0,1 box "TV / Mobile App"
node home 1.6,1 box "Home Service|assemble + rank"
node recs 3.2,-0.3 circle "Precomputed Recs"
node live 3.2,1 circle "Watch Progress|+ watchlist"
node ent 3.2,2.3 box "Entitlements"
node meta 1.6,-0.6 circle "Title Metadata"
edge app <-> home "GET /home"
edge home <-> recs
edge home <-> live
edge home <-> ent
edge home <-> meta "hydrate"
```

### 3) Lazy loading

Only the first few rows and the first ~10 items per row are returned. More rows arrive as the user scrolls down, and more items as they scroll right, using cursors. This keeps the first response small and fast.

## Potential Deep Dives

### 1) How do we load the page in under a second?

:::solution bad Compute everything on request
#### Approach

Run recommendation models and query every source when the user opens the app.

#### Challenges

Model inference and many sequential calls blow the latency budget at 100k requests per second.
:::

:::solution good Precomputed rows plus parallel fetches
#### Approach

Precompute heavy personal rows offline and store them in a key-value store by user. At request time, fetch all row sources **in parallel** with strict timeouts.

#### Challenges

Still hydrating hundreds of titles per request.
:::

:::solution great Precompute + cache shared parts + fallbacks
#### Approach

Precompute personal rows, and cache **shared rows** (trending, editorial, genre) per region and entitlement segment, since millions of users see the same ones. Title metadata and artwork URLs are cached in memory in the Home Service. Each source has a **timeout and fallback**: if recommendations are slow, substitute a popular-in-region row. Artwork images come from a CDN, sized per device.

#### Challenges

Cached shared rows must still be filtered per user's exact entitlements, which must be fast (a bitmap or set check).
:::

### 2) How do we keep "Continue watching" fresh?

The player sends progress events every few seconds; a stream processor updates the user's **viewing progress** store and removes finished titles (or advances to the next episode). The Home Service always reads this row live, while the rest of the page may come from caches. When the user returns from watching, the app re-requests just that row.

:::tip
Mention device differences: a TV home page shows fewer, larger tiles and has more memory constraints than mobile, so the API takes the device type and returns layout-appropriate rows and artwork.
:::

### 3) How do we personalise row order and artwork?

Beyond choosing rows, a ranking model orders rows by predicted engagement for the user, with diversity constraints (not five comedy rows in a row). Artwork can be **personalised too**: each title has several artwork variants and a bandit picks the one most likely to appeal to this user. All of this is logged to measure impact with A/B tests.

### Final Design

```diagram Final Design
node app 0,1 box "Apps"
node cdn 0,2.3 box "Image CDN"
node gw 1.4,1 box "API Gateway"
node home 2.8,1 box "Home Service|assemble · filter · rank"
node shared 2.8,-0.3 circle "Shared Row Cache"
node recs 4.2,-0.3 circle "Personal Rows KV"
node prog 4.2,1 circle "Viewing Progress"
node ent 4.2,2.3 box "Entitlements"
node batch 5.6,-0.3 box "Offline Rec Jobs"
edge app <-> gw
edge app <-> cdn
edge gw <-> home
edge home <-> shared
edge home <-> recs
edge home <-> prog
edge home <-> ent
edge batch -> recs
```

```quiz
[
  {
    "question": "Why precompute personal recommendation rows?",
    "options": ["They never change", "Running models on every page load is too slow and expensive", "To hide them", "Regulations"],
    "answer": 1,
    "explanation": "Offline jobs store rows per user for fast lookup."
  },
  {
    "question": "What should happen if the recommendation source times out?",
    "options": ["Show an error page", "Fall back to a popular-in-region row", "Retry forever", "Leave the screen blank"],
    "answer": 1,
    "explanation": "The page should degrade gracefully."
  },
  {
    "question": "Which rows can be cached and shared across users?",
    "options": ["Continue watching", "Trending and editorial rows per region and segment", "Watchlist", "None"],
    "answer": 1,
    "explanation": "Millions of users see the same shared rows."
  },
  {
    "question": "Why load only the first few rows initially?",
    "options": ["Users don't scroll", "To keep the first response small so the screen renders fast", "TVs can't show rows", "To save storage"],
    "answer": 1,
    "explanation": "Lazy loading fetches more as the user scrolls."
  }
]
```
