---
title: Content Delivery Network
seoTitle: Design a Content Delivery Network (CDN)
description: Design a CDN — routing users to nearby edge servers, caching hierarchies, cache keys and invalidation, origin shielding, and handling flash crowds.
tags: Scaling Reads, Handling Large Blobs
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🌍 What is a CDN?
A content delivery network is a global fleet of edge servers that cache content — images, video, scripts, API responses — close to users, so requests travel tens of kilometres instead of across oceans, and origin servers handle a fraction of the traffic.
:::

### Functional Requirements

**Core Requirements**

1. Customers should be able to put a CDN in front of their origin for a domain.
2. Users requesting content should be served from a nearby edge server.
3. Edges should cache content according to cache rules (TTLs, headers) and fetch misses from the origin.
4. Customers should be able to purge (invalidate) content globally.

**Below the line (out of scope):**

- Edge compute (running customer code).
- DDoS mitigation and WAF.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Low latency: most users within ~20-50ms of an edge.
2. High cache hit ratio (95%+ for static content) to protect origins.
3. Highly available: an edge or whole location failing shouldn't cause errors.
4. Purges propagate globally within seconds.

**Below the line (out of scope):**

- Billing and analytics.

```sketch CDN Requirements
Functional
- front a customer origin
- serve from nearby edge
- cache by rules; fetch misses
- global purge

Non-functional
- 20-50ms to an edge
- 95%+ hit ratio
- survive edge / PoP failure
- purge in seconds
```

## The Set Up

### Defining the Core Entities

1. **PoP (point of presence)**: a location with many edge servers.
2. **Cache object**: a response stored under a cache key (host + path + selected headers/query) with TTL.
3. **Origin**: the customer's server.
4. **Configuration**: per-customer cache rules, origins and certificates.

### API or System Interface

```
// Customer control plane
POST /distributions { domain, origin, cacheRules }
POST /distributions/:id/purge { paths: ["/img/logo.png", "/css/*"] }

// Data plane
GET https://cdn.customer.com/img/logo.png  -> served from nearest edge
```

## High-Level Design

### 1) Route users to a nearby edge

Two common techniques:

- **Anycast**: every PoP announces the same IP addresses via BGP; the internet routes each user to the topologically nearest PoP.
- **DNS-based routing**: the CDN's DNS returns the IP of a PoP chosen by the resolver's location, latency measurements and PoP load.

```diagram Request path
node user 0,1 box "User"
node dns 1.3,0 box "CDN DNS /|Anycast routing"
node edge 1.5,1.5 box "Edge PoP|(nearest)"
node shield 3,1.5 box "Shield PoP|(regional)"
node origin 4.5,1.5 box "Customer Origin"
edge user <-> dns "resolve"
edge user <-> edge "GET"
edge edge <-> shield "miss"
edge shield <-> origin "miss"
```

### 2) Serve from cache, fetch misses

Each edge server checks its cache (memory for hot objects, SSD for the rest). On a miss it fetches from a regional **shield** PoP, which in turn fetches from the origin. Responses are cached according to `Cache-Control` headers or customer rules.

### 3) Purge content

Purge requests go to the control plane, which fans out invalidation messages to every PoP via a global pub/sub system; edges drop or mark matching objects stale.

## Potential Deep Dives

### 1) How do we maximise hit ratio and protect the origin?

:::solution bad Every edge fetches misses from origin
#### Approach

Each of thousands of edge servers goes straight to the origin on a miss.

#### Challenges

A newly popular object causes thousands of simultaneous origin requests.
:::

:::solution good Consistent hashing within a PoP
#### Approach

Within a PoP, hash the cache key to choose which server stores an object, so the PoP holds one copy instead of one per server — effectively a much larger cache.

#### Challenges

Doesn't stop every PoP from separately fetching from origin.
:::

:::solution great Tiered caching with origin shield + request collapsing
#### Approach

Route misses through a small number of regional **shield** PoPs, so the origin sees roughly one request per object per region. At every tier, **collapse concurrent misses** for the same key into a single upstream fetch while others wait. Serve stale content while revalidating (`stale-while-revalidate`) and if the origin is down (`stale-if-error`).

#### Challenges

An extra hop on misses; worth it for hit ratio and origin protection.
:::

### 2) How do we design cache keys and invalidation?

Cache keys must include only what changes the response: host, path, and selected query parameters or headers (e.g. `Accept-Encoding`). Including unnecessary values (tracking query strings, cookies) fragments the cache. For invalidation, prefer **versioned URLs** (`app.3f9a.js`) that never need purging; use purge for mistakes and urgent removals, propagated through a global message bus with acknowledgements from each PoP.

### 3) How do we handle failures?

Health-check edges and PoPs continuously. With anycast, a failed PoP withdraws its route and traffic shifts automatically; with DNS routing, the control plane stops returning that PoP. Within a PoP, load balancers remove unhealthy servers.

### Final Design

```diagram Final Design
node user 0,1.2 box "Users"
node route 1.3,0 box "Anycast + DNS|routing"
node edge 1.4,1.4 box "Edge PoPs|- memory + SSD|- consistent hashing"
node shield 2.9,1.4 box "Shield PoPs|- request collapsing"
node origin 4.4,1.4 box "Origins"
node ctrl 2.9,0 box "Control Plane|config + purge"
node bus 4.4,0 circle "Global Pub/Sub"
edge user <-> route
edge user <-> edge
edge edge <-> shield
edge shield <-> origin
edge ctrl -> bus
edge bus -> edge "purge / config"
edge bus -> shield
```

```quiz
[
  {
    "question": "What does an origin shield do?",
    "options": ["Encrypts traffic", "Funnels misses through a regional tier so the origin sees far fewer requests", "Blocks bots", "Compresses images"],
    "answer": 1,
    "explanation": "Shields consolidate cache misses before they reach the origin."
  },
  {
    "question": "What is request collapsing?",
    "options": ["Compressing requests", "Combining concurrent misses for the same object into one upstream fetch", "Dropping requests", "Batching DNS lookups"],
    "answer": 1,
    "explanation": "It prevents stampedes on newly popular content."
  },
  {
    "question": "Why are versioned asset URLs preferred over purges?",
    "options": ["They're shorter", "A new version gets a new URL, so no invalidation is needed", "Purges are illegal", "They load faster"],
    "answer": 1,
    "explanation": "Immutable URLs can be cached forever safely."
  },
  {
    "question": "How does anycast route users?",
    "options": ["By user login", "All PoPs announce the same IPs and BGP routes users to the nearest one", "Random choice", "Through the origin"],
    "answer": 1,
    "explanation": "Network routing itself picks the closest PoP."
  }
]
```
