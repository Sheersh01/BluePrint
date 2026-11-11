---
title: Parts Compatibility
seoTitle: Design a Parts Compatibility Feature for an E-commerce Site
description: Design "Does this fit my car?" — modelling vehicle fitment data, ingesting supplier catalogs, fast compatibility checks and filtered search by vehicle.
tags: Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Some FAANG | 0
---

## Understanding the Problem

:::definition 🔧 What is a Parts Compatibility Feature?
Auto-parts and electronics stores let shoppers pick their vehicle (year, make, model, engine) or device and then show only parts that fit, with a "Fits your 2019 Honda Civic" badge on product pages.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to select and save a vehicle (year → make → model → trim/engine).
2. Product pages should show whether a part fits the selected vehicle.
3. Search and category pages should filter to parts that fit the selected vehicle.
4. Catalog teams should be able to import fitment data from suppliers.

**Below the line (out of scope):**

- Installation guides.
- Recommending complementary parts.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Compatibility checks on product pages in < 50ms.
2. Filtered search in < 300ms over tens of millions of parts.
3. Fitment data must be accurate — wrong answers cause returns and lost trust.
4. Catalog imports of millions of fitment rows shouldn't affect shopper traffic.

**Below the line (out of scope):**

- Real-time inventory.

```sketch Compatibility Requirements
Functional
- select + save vehicle
- "fits your car" on product page
- filter search by vehicle
- import supplier fitment

Non-functional
- check < 50ms
- search < 300ms
- accurate data
- imports don't hurt shoppers
```

## The Set Up

### Defining the Core Entities

1. **Vehicle**: a normalised configuration (year, make, model, submodel, engine) with an ID — industry standards like ACES provide these.
2. **Part**: a product with SKU and attributes.
3. **Fitment**: a (partId, vehicleId) pair, optionally with qualifiers ("front axle only", "with sunroof").
4. **Garage**: a user's saved vehicles.

### API or System Interface

```
GET  /vehicles/makes?year=2019 ; /vehicles/models?year&make ; /vehicles?year&make&model -> Vehicle[]
GET  /parts/:sku/fitment?vehicleId=123 -> { fits: true, notes: "Front only" }
GET  /search?q=brake+pads&vehicleId=123 -> Part[]
POST /fitment/imports (catalog teams, file upload)
```

## High-Level Design

### 1) Users select a vehicle

The vehicle catalog is small (hundreds of thousands of configurations) and changes rarely, so the cascading dropdown APIs are served from an in-memory cache or CDN. The chosen vehicle ID is stored in the user's garage (and a cookie for anonymous users).

### 2) Product pages show fit

```diagram Fitment checks and search
node client 0,1 box "Client|vehicleId"
node pdp 1.5,0.3 box "Fitment Service"
node cache 3,0.3 circle "Fitment Cache|(Redis sets)"
node search 1.5,1.8 box "Search Service"
node es 3,1.8 circle "Search Index|parts w/ vehicleIds"
node db 4.4,1 circle "Fitment DB|(partId, vehicleId)"
edge client <-> pdp "fits?"
edge pdp <-> cache
edge cache <-> db
edge client <-> search "search + vehicle"
edge search <-> es
edge db -> es "index"
```

The **Fitment Service** answers "does part X fit vehicle Y?" with a lookup on the fitment table keyed by `(partId, vehicleId)`, cached in Redis — e.g. a set of vehicle IDs per part.

### 3) Search filters by vehicle

Each part document in the search index carries the list of vehicle IDs it fits. A search with a selected vehicle adds a filter `vehicleIds: 123`, which search engines evaluate efficiently with an inverted index.

### 4) Import supplier fitment

Supplier files are uploaded, validated and normalised against the vehicle catalog in a batch pipeline, written to the fitment database, and then pushed to the search index incrementally.

## Potential Deep Dives

### 1) How do we model fitment compactly?

:::solution bad Free-text compatibility notes
#### Approach

Store "Fits 2016-2020 Civic" as text on the product.

#### Challenges

Can't be filtered or verified, and spelling variations break matching.
:::

:::solution good One row per (part, vehicle) pair
#### Approach

Explicit pairs keyed by normalised vehicle IDs — simple and precise.

#### Challenges

A universal part can fit tens of thousands of vehicles, so the table reaches billions of rows.
:::

:::solution great Normalised pairs + range expansion at import
#### Approach

Suppliers describe fitment as ranges ("2016-2020 Civic, all trims"). Store the compact rule, expand it into vehicle IDs at import time, and index the expanded IDs (compressed integer lists are cheap in search engines). Keep qualifiers as structured attributes so the UI can say "fits with conditions".

#### Challenges

Expansion must re-run when the vehicle catalog adds new trims.
:::

### 2) How do we keep data accurate?

Validate imports against the vehicle catalog (reject unknown vehicles), diff each import against the previous version and flag large changes for review, track return reasons like "doesn't fit" to find bad fitment, and let catalog staff correct data with an audit trail.

### Final Design

```diagram Final Design
node client 0,1.2 box "Clients"
node veh 1.4,0 box "Vehicle Catalog API|(CDN cached)"
node fit 1.4,1.2 box "Fitment Service"
node search 1.4,2.4 box "Search Service"
node cache 2.8,1.2 circle "Fitment Cache"
node db 4.2,1.2 circle "Fitment DB|rules + pairs"
node es 2.8,2.4 circle "Search Index"
node imp 4.2,0 box "Import Pipeline|- validate|- expand ranges|- diff"
edge client <-> veh
edge client <-> fit
edge client <-> search
edge fit <-> cache
edge cache <-> db
edge search <-> es
edge imp -> db
edge db -> es "incremental index"
```

```quiz
[
  {
    "question": "Why normalise vehicles to IDs?",
    "options": ["Shorter URLs", "Free-text descriptions can't be reliably matched or filtered", "Privacy", "For search ranking"],
    "answer": 1,
    "explanation": "IDs make fitment precise and filterable."
  },
  {
    "question": "How does search filter to parts that fit a vehicle?",
    "options": ["Scan every part", "Index each part's list of vehicle IDs and filter on the selected ID", "Ask the supplier", "Client-side filtering"],
    "answer": 1,
    "explanation": "Inverted indexes make ID filters fast."
  },
  {
    "question": "Why expand fitment ranges at import time?",
    "options": ["To save storage", "So queries become simple ID lookups at read time", "Ranges are illegal", "For encryption"],
    "answer": 1,
    "explanation": "Expensive expansion moves offline; reads stay fast."
  },
  {
    "question": "What signal helps find inaccurate fitment data?",
    "options": ["Page views", "Returns with reason 'doesn't fit'", "Cart size", "Ad clicks"],
    "answer": 1,
    "explanation": "Real-world returns point to bad data."
  }
]
```
