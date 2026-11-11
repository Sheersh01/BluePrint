---
title: Weather App
seoTitle: Design a Weather Application Backend
description: Design a weather app — ingesting data from providers, serving current conditions and forecasts by location with aggressive caching, and pushing severe-weather alerts.
tags: Scaling Reads, Real-time Updates
difficulty: easy
author: Editorial Team
published: Nov 10, 2026
askedAt: Amazon, Chime, Facebook, Hubspot | 2
---

## Understanding the Problem

:::definition 🌦️ What is a Weather App?
A weather app shows current conditions and forecasts for a user's location or saved cities, and alerts users about severe weather nearby.
:::

### Functional Requirements

**Core Requirements**

1. Users should see current weather and a 7-day forecast for their location or a searched city.
2. Users should be able to save favourite locations.
3. Users should receive push alerts for severe weather in their saved locations.

**Below the line (out of scope):**

- Radar animation and maps.
- Producing forecasts ourselves (we consume providers).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Fast responses (< 200ms) and very high availability — people check weather constantly.
2. Data freshness: current conditions within ~10-15 minutes; forecasts hourly.
3. Scale to 50M daily users with spikes during storms.
4. Severe-weather alerts delivered within a minute or two.

**Below the line (out of scope):**

- Historical climate data.

```sketch Weather App Requirements
Functional
- current + 7-day forecast by location
- saved locations
- severe-weather alerts

Non-functional
- < 200ms, highly available
- fresh within 10-15 min
- 50M DAU, storm spikes
- alerts within minutes
```

## The Set Up

### Defining the Core Entities

1. **Location cell**: a grid cell (e.g. geohash precision 5, ~5km) that weather is computed for.
2. **Observation / forecast**: weather data for a cell and time.
3. **Saved location**: a user's favourite place.
4. **Alert**: a severe-weather warning covering a geographic polygon.

### API or System Interface

```
GET  /weather?lat&lng -> { current, hourly[], daily[] }
POST /users/me/locations { name, lat, lng }
POST /devices { pushToken }
```

## High-Level Design

### 1) Users see current weather and forecasts

An **Ingestion Service** pulls data from weather providers (national weather services, commercial APIs) on a schedule, normalises it, and writes it keyed by **location cell**. The **Weather API** snaps the user's coordinates to a cell and returns that cell's data.

```diagram Ingest and serve
node prov 0,0.3 circle "Weather|Providers"
node ing 1.4,0.3 box "Ingestion Service|- normalise to cells"
node store 2.8,0.3 circle "Weather Store"
node cache 2.8,1.7 circle "Cache|(Redis + CDN)"
node api 1.4,1.7 box "Weather API|- snap to geohash"
node client 0,1.7 box "Client"
edge ing <-> prov "poll"
edge ing -> store
edge ing -> cache "refresh"
edge client <-> api
edge api <-> cache
edge cache <-> store
```

### 2) Users save favourite locations

Saved locations live in a user table keyed by user ID, with the cell ID stored alongside for alert matching.

### 3) Users receive severe-weather alerts

Providers publish alerts with polygons. An **Alert Service** finds which cells intersect the polygon, looks up users whose saved locations (or last known locations) fall in those cells, and sends push notifications through the notification system.

## Potential Deep Dives

### 1) How do we serve millions of requests cheaply?

:::solution bad Call the provider per request
#### Approach

Proxy each user request to a weather provider.

#### Challenges

Expensive (providers charge per call), slow, and fails when the provider throttles us.
:::

:::solution good Cache per exact coordinates
#### Approach

Cache provider responses keyed by lat/lng.

#### Challenges

Every user has slightly different coordinates, so the hit rate is terrible.
:::

:::solution great Snap to cells and cache at the edge
#### Approach

Round coordinates to a geohash cell so everyone in a neighbourhood shares one cache entry. Pre-fetch data for all populated cells on a schedule rather than on demand, and serve `GET /weather?cell=...` through a CDN with a TTL matching the data freshness (e.g. 10 minutes). Storm spikes are then absorbed by the edge.

#### Challenges

Cell size trades precision for hit rate — ~5km is plenty for weather.
:::

### 2) How do we deliver alerts quickly to the right people?

Index saved locations by cell ID so "who is in these cells?" is a fast lookup. Expand alert polygons to cells once, fan out notifications through a queue, and deduplicate so users don't receive the same alert for multiple saved places. Prioritise severe alerts ahead of marketing notifications.

### Final Design

```diagram Final Design
node client 0,1.2 box "Clients"
node cdn 1.3,1.2 circle "CDN"
node api 2.6,1.2 box "Weather API"
node store 3.9,1.2 circle "Weather Store"
node ing 3.9,0 box "Ingestion|scheduled"
node prov 5.2,0 circle "Providers"
node alert 5.2,1.2 box "Alert Service|polygon -> cells"
node users 5.2,2.4 circle "Saved Locations|by cell"
node push 3.9,2.4 box "Push Notifications"
edge client <-> cdn
edge cdn <-> api
edge api <-> store
edge ing -> store
edge ing <-> prov
edge prov -> alert "alerts"
edge alert <-> users
edge alert -> push
edge push -> client
```

```quiz
[
  {
    "question": "Why snap coordinates to geohash cells?",
    "options": ["For privacy only", "So nearby users share one cache entry, raising hit rates", "Providers require it", "To encrypt locations"],
    "answer": 1,
    "explanation": "Exact coordinates are nearly unique per user."
  },
  {
    "question": "Why not call the weather provider on every request?",
    "options": ["It's illegal", "It's slow, costly per call, and subject to provider throttling", "Providers are always down", "It's too accurate"],
    "answer": 1,
    "explanation": "Pre-fetching and caching decouple traffic from provider calls."
  },
  {
    "question": "How do you find users affected by a severe-weather alert?",
    "options": ["Scan all users", "Convert the alert polygon to cells and look up saved locations by cell", "Email everyone", "Ask the provider"],
    "answer": 1,
    "explanation": "A cell index makes the lookup fast."
  },
  {
    "question": "What should the CDN TTL match?",
    "options": ["One second", "The data refresh interval", "One year", "Nothing"],
    "answer": 1,
    "explanation": "Caching longer than the refresh interval would serve stale data."
  }
]
```
