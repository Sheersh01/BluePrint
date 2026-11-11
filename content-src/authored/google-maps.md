---
title: Google Maps
seoTitle: Design Google Maps — Map Tiles, Routing and Live Traffic
description: Design Google Maps — serving map tiles through CDNs, place search, fast routing on a road graph with precomputation, live traffic from phone location data, and ETA prediction.
tags: Scaling Reads, Scaling Writes, Handling Large Blobs
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🗺️ What is Google Maps?
Google Maps shows an interactive map of the world, finds places, and gives directions with travel times that account for live traffic. It's really three systems: a **map rendering** system (tiles), a **search** system for places and addresses, and a **routing** system that finds the fastest path on a road network of hundreds of millions of segments, using traffic data collected from phones.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view and pan/zoom a map of any area.
2. Users should be able to search for places and addresses.
3. Users should get a route between two points with an ETA, for driving (and walking/cycling).
4. ETAs and routes should reflect current traffic, and navigation should reroute when conditions change.

**Below the line (out of scope):**

- Street View and satellite imagery capture.
- Reviews and business listings (see Yelp).
- Public transit scheduling.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Map panning is smooth: tiles load in < 100 ms.
2. Routes computed in < 1 second, even across a continent.
3. Traffic reflects reality within a couple of minutes.
4. Scale to ~1B monthly users, millions of route requests per minute, and location updates from hundreds of millions of devices.
5. Accurate ETAs (within ~10% most of the time).

**Below the line (out of scope):**

- Real-time map edits by users.

```sketch Maps Requirements
Functional
- view map, pan + zoom
- search places
- routes + ETAs
- live traffic + rerouting

Non-functional
- tiles < 100ms
- routes < 1s
- traffic fresh in ~2 min
- 1B users
- accurate ETAs
```

## The Set Up

### Defining the Core Entities

1. **Tile**: a square image or vector data for zoom level z and coordinates (x, y).
2. **Road graph**: nodes (intersections) and edges (road segments) with length, speed limit, restrictions.
3. **Place**: name, location, category, address.
4. **Traffic speed**: current average speed per road segment, with timestamp.
5. **Location ping**: anonymised device position and speed, used to derive traffic.

### API or System Interface

```
GET  /tiles/{z}/{x}/{y}.pbf            (via CDN, vector tiles)
GET  /search?q=&near=lat,lng
GET  /directions?from=&to=&mode=driving&depart=now -> { routes: [{ polyline, eta, steps }] }
POST /navigation/:sessionId/location { lat, lng, speed }   (during navigation)
```

## High-Level Design

### 1) Viewing the map

The world is divided into **tiles** at each zoom level (a quadtree: level z has 4^z tiles). Tiles are pre-generated from map data as **vector tiles** (roads, labels, shapes) that the client renders, so one tile works at any screen resolution and style. Tiles are static and served from a **CDN**, with clients caching them heavily.

### 2) Searching places

Places and addresses are indexed in a search system with text fields and a **geo field**, so queries rank by text match, popularity and distance from the user or viewport. Address queries use a **geocoder** that parses the address and finds the matching point.

### 3) Routing

The **Routing Service** loads the road graph into memory. A plain Dijkstra search across a continent explores millions of nodes and takes too long, so the graph is **preprocessed** (see deep dive) to answer queries in milliseconds. Edge weights are travel times from the current traffic data.

```diagram Routing
node app 0,1 box "App"
node route 1.6,1 box "Routing Service|in-memory graph"
node traffic 3.2,-0.3 circle "Traffic Speeds"
node graph 3.2,1 circle "Road Graph|preprocessed"
node eta 3.2,2.3 box "ETA Model"
edge app <-> route "directions"
edge route <-> traffic "edge weights"
edge route <-> graph
edge route <-> eta
```

### 4) Live traffic

Phones with location sharing send anonymised speed and position. A streaming pipeline **map-matches** each ping to a road segment and computes current average speed per segment over the last few minutes. Speeds update the routing weights and the traffic colours on map tiles (as a separate overlay layer, refreshed every minute).

## Potential Deep Dives

### 1) How do we compute routes in milliseconds?

:::solution bad Dijkstra on the full graph
#### Approach

Run Dijkstra from origin to destination over the whole road network.

#### Challenges

A cross-country route explores tens of millions of nodes — seconds of CPU per request.
:::

:::solution good A* with partitioning
#### Approach

Use A* with a distance heuristic and split the map into regions, searching only regions between origin and destination.

#### Challenges

Faster, but long routes still explore huge areas, and traffic changes require care.
:::

:::solution great Contraction hierarchies / customisable route planning
#### Approach

Preprocess the graph into a hierarchy: **contraction hierarchies** add shortcut edges so a query only climbs to "important" roads and back down, exploring a few thousand nodes. For live traffic, use **customisable route planning (CRP)**: the graph is partitioned into cells once, and only the cheap "customisation" step (recomputing shortcut costs inside cells) runs when traffic weights change — every minute or so. Queries then take milliseconds.

#### Challenges

Preprocessing is heavy and memory-hungry; graph data is replicated across many routing servers per region.
:::

### 2) How do we turn location pings into traffic?

Hundreds of millions of devices send pings, partitioned by **region/tile** in Kafka. A stream processor map-matches pings to segments (using a hidden Markov model over the road graph), filters outliers (a parked car, a cyclist on a road), and aggregates speeds per segment per minute, requiring a minimum number of devices for privacy. Segments without live data fall back to **historical speed profiles** for that time of week.

:::tip
Mention that ETA isn't just sum of current speeds: traffic will change during a long trip, so an ETA model predicts future segment speeds from historical patterns plus current conditions.
:::

### 3) How do we serve tiles at this scale?

There are trillions of possible tiles, but traffic is extremely skewed toward cities and common zoom levels. Pre-render popular tiles; generate rare ones **on demand** and cache them. Vector tiles are small and compress well; the CDN handles almost all requests, and clients cache tiles locally (also enabling **offline maps** by downloading a region's tiles and graph).

### Final Design

```diagram Final Design
node app 0,1 box "Apps"
node cdn 0,-0.3 box "CDN|vector tiles"
node tilegen 1.5,-0.3 box "Tile Generator"
node gw 1.5,1 box "API Gateway"
node search 3,-0.3 box "Search + Geocoder"
node route 3,1 box "Routing (CRP)"
node traffic 4.5,1 circle "Segment Speeds"
node stream 4.5,2.3 box "Traffic Pipeline|map-matching"
node kafka 3,2.3 box "Location Pings"
edge app <-> cdn
edge cdn <-> tilegen "miss"
edge app <-> gw
edge gw <-> search
edge gw <-> route
edge route <-> traffic
edge stream -> traffic
edge kafka -> stream
edge gw -> kafka "pings"
```

```quiz
[
  {
    "question": "Why are map tiles served from a CDN?",
    "options": ["They're secret", "Tiles are static and heavily reused, so edge caching handles almost all requests", "CDNs compute routes", "Browsers require it"],
    "answer": 1,
    "explanation": "Tiles change rarely and are requested enormously often."
  },
  {
    "question": "Why isn't plain Dijkstra used for long routes?",
    "options": ["It gives wrong answers", "It explores far too many nodes for millisecond responses", "It ignores distance", "It can't handle one-way roads"],
    "answer": 1,
    "explanation": "Preprocessed hierarchies make queries orders of magnitude faster."
  },
  {
    "question": "What does customisable route planning make cheap?",
    "options": ["Tile rendering", "Updating route weights when traffic changes", "Search", "Storing places"],
    "answer": 1,
    "explanation": "Only the customisation step reruns, not full preprocessing."
  },
  {
    "question": "What is map-matching?",
    "options": ["Matching map colours", "Assigning noisy GPS pings to the road segment the device is actually on", "Comparing maps", "Geocoding addresses"],
    "answer": 1,
    "explanation": "It's the first step in turning pings into segment speeds."
  }
]
```
