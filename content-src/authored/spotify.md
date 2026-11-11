---
title: Spotify
seoTitle: Design a Music Streaming Service like Spotify
description: Design a music streaming service like Spotify — catalog and search, low-latency audio playback through CDNs, offline downloads with DRM, playlists, and play counting for royalties.
tags: Handling Large Blobs, Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎵 What is Spotify?
Spotify streams music from a catalog of over 100 million tracks to hundreds of millions of listeners. Users search and browse, build playlists, play tracks instantly, and download music for offline listening. Every play is counted, because artists and labels are paid royalties based on streams.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to search the catalog for tracks, albums and artists.
2. Users should be able to play a track with playback starting almost instantly.
3. Users should be able to create and edit playlists.
4. Premium users should be able to download tracks for offline playback.
5. Plays should be counted accurately for royalties and charts.

**Below the line (out of scope):**

- Recommendations (Discover Weekly) — see Recommendation Engine.
- Podcasts — see Podcast Platform.
- Social features and lyrics.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Playback starts in < 300 ms, with no gaps between tracks.
2. Highly available playback; ~500M users, ~50M concurrent streams at peak.
3. Licensed content must be protected (encrypted, offline downloads expire).
4. Play counts must be accurate and fraud-resistant.

**Below the line (out of scope):**

- Lossless audio and spatial audio.

```sketch Spotify Requirements
Functional
- search catalog
- instant playback
- playlists
- offline downloads
- count plays for royalties

Non-functional
- start < 300ms, gapless
- 50M concurrent streams
- DRM-protected
- accurate, fraud-resistant counts
```

## The Set Up

### Defining the Core Entities

1. **Track**: ID, title, artists, album, duration, audio file references per quality.
2. **Album / Artist**: catalog metadata.
3. **Playlist**: owner, ordered track list, version.
4. **Play event**: user, track, timestamp, duration played, device.

### API or System Interface

```
GET  /search?q=&type=track,album,artist
GET  /tracks/:id/stream -> { cdnUrls[], keyId, formats }   (signed URLs)
GET  /playlists/:id
PATCH /playlists/:id { add|remove|move, version }
POST /downloads { trackIds[] } -> { licences[] }
POST /events/plays [{ trackId, msPlayed, ts }]   (batched)
```

## High-Level Design

### 1) Searching the catalog

Catalog metadata lives in a database and is indexed into **Elasticsearch** with fields for titles, artists and popularity. Prefix matching powers search-as-you-type, and popularity boosts results so "Hello" finds the famous song first.

### 2) Playing a track

Each track is transcoded into a few bitrates (e.g. 96, 160, 320 kbps Ogg/AAC), **encrypted**, and stored in object storage. The **Playback Service** returns short-lived **signed CDN URLs** and the decryption key reference. The client fetches audio from the nearest **CDN** edge and starts playing after the first few hundred kilobytes.

```diagram Playback
node app 0,1 box "App"
node play 1.6,-0.3 box "Playback Service|signed URLs + keys"
node cdn 1.6,1 box "CDN Edge"
node s3 3.2,1 circle "Object Storage|encrypted audio"
node meta 3.2,-0.3 circle "Catalog DB"
edge app <-> play "1. stream info"
edge play <-> meta
edge app <-> cdn "2. fetch audio"
edge cdn <-> s3 "miss"
```

### 3) Playlists

Playlists are stored as an ordered list of track IDs with a **version number**. Edits are applied as operations (add, remove, move) checked against the version, so two devices editing at once don't overwrite each other; collaborative playlists merge operations.

### 4) Offline downloads and play counting

Downloads fetch the same encrypted files plus a **device-bound licence** that must be refreshed online every 30 days. Clients send **play events** in batches (including plays made offline), which flow through **Kafka** into counting pipelines; a stream counts as a play after 30 seconds of listening.

## Potential Deep Dives

### 1) How do we make playback start instantly?

:::solution bad Download the whole file first
#### Approach

Fetch the full track, then start playing.

#### Challenges

A 5 MB file over mobile takes seconds before any sound plays.
:::

:::solution good Progressive streaming from a CDN
#### Approach

Stream from the CDN with HTTP range requests and start playback after a small buffer.

#### Challenges

The first track still pays DNS, TLS and cache-miss latency.
:::

:::solution great Prefetching and local caching
#### Approach

The client **prefetches** the start of tracks it predicts will play next (the next song in the queue, the top search result) and keeps a large **local cache** of recently played music, since people replay the same songs. Popular tracks are **pre-warmed** at edges. The client starts at a lower bitrate and switches up once the buffer is healthy, and preloads the next track for gapless playback.

#### Challenges

Prefetching uses mobile data, so it's limited on cellular networks.
:::

### 2) How do we count plays accurately at scale?

Play events arrive in huge volume, sometimes late (offline plays) and sometimes duplicated (client retries). Each event carries a unique ID; the pipeline **deduplicates** and aggregates per track per day. Fraud detection looks for bots and farms: many accounts looping the same tracks, impossible listening hours, or suspicious device patterns, and their plays are excluded from royalty reports. Royalty totals are computed in a batch job from the cleaned events, since they must be exact and auditable.

:::tip
Mention the split: real-time counters for charts and "plays this week" can be approximate, while monthly royalty reports come from an exact, deduplicated batch job.
:::

### 3) How do we protect licensed content?

Audio is encrypted at rest and on the CDN; the client fetches a key from a **licence service** after authorisation and holds it in protected memory. Offline licences are tied to the device and expire unless the app checks in, and the number of devices with downloads is capped per account.

### Final Design

```diagram Final Design
node app 0,1 box "Apps|cache + prefetch"
node gw 1.5,1 box "API Gateway"
node play 3,-0.3 box "Playback + Licence"
node search 3,1 box "Search Service"
node es 4.5,1 circle "Search Index"
node pl 3,2.3 box "Playlist Service"
node cdn 1.5,-0.3 box "CDN"
node s3 0,-0.3 circle "Audio Storage"
node kafka 1.5,2.3 box "Kafka|play events"
node count 0,2.3 box "Counting + Royalties"
edge app <-> gw
edge app <-> cdn "audio"
edge cdn <-> s3
edge gw <-> play
edge gw <-> search
edge search <-> es
edge gw <-> pl
edge gw -> kafka "plays"
edge kafka -> count
```

```quiz
[
  {
    "question": "Why does Spotify use signed, short-lived CDN URLs?",
    "options": ["They're shorter", "So only authorised clients can fetch audio, and links can't be shared indefinitely", "To speed up DNS", "For SEO"],
    "answer": 1,
    "explanation": "Signatures and expiry protect licensed content on a public CDN."
  },
  {
    "question": "What helps playback start almost instantly?",
    "options": ["Larger files", "Prefetching likely next tracks and caching recently played music locally", "Waiting for full downloads", "Turning off the CDN"],
    "answer": 1,
    "explanation": "The fastest network request is the one already done."
  },
  {
    "question": "Why deduplicate play events?",
    "options": ["To save disk", "Clients retry, so the same play can arrive twice, inflating royalties", "Duplicates are illegal", "Kafka requires it"],
    "answer": 1,
    "explanation": "Each event's unique ID makes counting exact."
  },
  {
    "question": "How do offline downloads stay protected?",
    "options": ["They're unencrypted", "Encrypted files plus device-bound licences that expire unless refreshed", "Users promise not to share", "They're deleted daily"],
    "answer": 1,
    "explanation": "Licence expiry ensures downloads stop working if the subscription ends."
  }
]
```
