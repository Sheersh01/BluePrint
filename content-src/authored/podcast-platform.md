---
title: Podcast Platform
seoTitle: Design a Podcast Platform like Apple Podcasts
description: Design a podcast platform — ingesting millions of RSS feeds, detecting new episodes efficiently, serving audio from CDNs, subscriptions and new-episode notifications, and syncing playback position.
tags: Handling Large Blobs, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎙️ What is a Podcast Platform?
A podcast platform (Apple Podcasts, Pocket Casts, Spotify's podcast side) lets listeners find shows, subscribe, and play or download episodes. Unlike music, most podcasts aren't uploaded to the platform: creators publish an **RSS feed** on their own hosting, and the platform must discover new episodes by polling millions of feeds.
:::

### Functional Requirements

**Core Requirements**

1. The platform should ingest podcasts from RSS feeds and pick up new episodes soon after publication.
2. Users should be able to search and subscribe to shows.
3. Subscribers should be notified of new episodes, and episodes can auto-download.
4. Users should be able to stream or download episodes and resume where they left off on any device.

**Below the line (out of scope):**

- Creator hosting and uploads (mentioned briefly).
- Ads insertion and analytics for creators.
- Recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. New episodes should appear within ~15 minutes for popular shows, and within hours for inactive ones.
2. Be polite to creators' servers: don't hammer feeds.
3. Handle ~5M shows and ~100M listeners, with huge download spikes when a popular show releases.
4. Playback position syncs across devices within seconds.

**Below the line (out of scope):**

- Transcoding (episodes are already MP3/AAC).

```sketch Podcast Requirements
Functional
- ingest RSS feeds
- search + subscribe
- new-episode notifications
- stream / download, resume anywhere

Non-functional
- popular shows < 15 min fresh
- polite polling
- 5M shows, release spikes
- position sync in seconds
```

## The Set Up

### Defining the Core Entities

1. **Show**: feed URL, title, author, artwork, last fetched, polling schedule.
2. **Episode**: show, GUID from the feed, title, audio URL, duration, publish date.
3. **Subscription**: user, show, auto-download preference.
4. **Playback state**: user, episode, position, completed flag, updated at.

### API or System Interface

```
GET  /search?q=
POST /subscriptions { showId }
GET  /me/feed?cursor=           -> new episodes from subscribed shows
GET  /episodes/:id/audio         -> redirect to CDN or original host
PUT  /me/playback/:episodeId { positionSec, updatedAt }
```

## High-Level Design

### 1) Ingesting feeds

A **feed scheduler** decides when each show is due for a fetch and puts it on a queue. **Fetchers** download the RSS XML, the **parser** extracts episodes and upserts them by their feed **GUID** (so re-fetching the same feed doesn't create duplicates), and new episodes are published as events.

```diagram Feed ingestion
node sched 0,1 box "Feed Scheduler|next fetch time"
node q 1.5,1 box "Fetch Queue"
node fetch 3,1 box "Fetchers|conditional GET"
node rss 3,-0.3 box "Creator RSS Hosts"
node parse 4.5,1 box "Parser|upsert by GUID"
node db 4.5,2.3 circle "Catalog DB"
edge sched -> q
edge q -> fetch
edge fetch <-> rss
edge fetch -> parse
edge parse -> db
```

### 2) Search and subscribe

Shows and episodes are indexed into a search index. Subscriptions are rows of `(userId, showId)`, sharded by user.

### 3) New-episode notifications

A **notification worker** consumes new-episode events, looks up subscribers of the show (an index by show ID), and sends push notifications and auto-download signals. For a show with millions of subscribers, the fan-out is batched and spread over a few minutes.

### 4) Playing and syncing position

Episode audio is served through **our CDN** (cached from the creator's host) so popular releases don't overwhelm small hosts. Clients send their playback position every ~15-30 seconds and on pause; the latest `updatedAt` wins, and other devices fetch it when the episode is opened.

## Potential Deep Dives

### 1) How do we poll 5M feeds efficiently?

:::solution bad Poll every feed every few minutes
#### Approach

Fetch every feed on a fixed short interval.

#### Challenges

~5M feeds × every 5 minutes is 16k requests per second, mostly for feeds that haven't changed in months, and it hammers small creators' servers.
:::

:::solution good Adaptive polling
#### Approach

Schedule each feed based on how often it publishes and how many subscribers it has: daily news shows every few minutes, dormant feeds once a day. Use **conditional GETs** (`ETag`, `If-Modified-Since`) so unchanged feeds return a tiny `304`.

#### Challenges

Still up to minutes of delay, and still polling.
:::

:::solution great Adaptive polling plus push
#### Approach

Support **WebSub** (PubSubHubbub) and hosting-provider webhooks: big podcast hosts notify us when a feed changes, so we fetch immediately. Polling remains as a safety net with adaptive intervals, and a publish-time **prediction** (many shows release at the same weekday and hour) tightens the schedule around expected releases.

#### Challenges

Not every host supports push, so the polling path must remain robust.
:::

### 2) How do we survive release-day spikes?

When a top show drops an episode, millions of auto-downloads start within minutes. Serving through a **CDN** with request collapsing means the creator's host is hit once per edge; staggering auto-downloads with a small random delay (or on Wi-Fi/charging) flattens the peak further. Notification fan-out is rate-limited so push providers and our API aren't flooded at once.

:::tip
Mention download analytics: creators are paid by downloads, so the platform should count downloads once per device per episode, following IAB-style rules (deduplicate by IP and user agent within 24 hours).
:::

### 3) How do we sync playback position?

Writes are frequent but tiny. Store positions in a key-value store keyed by `(userId, episodeId)` with **last-write-wins** on `updatedAt` from the client clock, plus a server timestamp to break ties. Clients batch updates and flush on pause, background and app close, so data use stays small.

### Final Design

```diagram Final Design
node rss 0,-0.3 box "RSS Hosts|+ WebSub"
node ingest 1.5,-0.3 box "Ingestion|schedule · fetch · parse"
node db 3,-0.3 circle "Catalog DB"
node bus 3,1 box "New Episode Events"
node notify 4.5,1 box "Notification Fan-out"
node app 6,1 box "Listener Apps"
node cdn 4.5,2.3 box "CDN|episode audio"
node pos 6,2.3 circle "Playback Positions"
node search 4.5,-0.3 circle "Search Index"
edge rss -> ingest
edge ingest -> db
edge db -> bus
edge bus -> notify
edge notify -> app "push"
edge app <-> cdn
edge app <-> pos
edge db -> search
```

```quiz
[
  {
    "question": "How do most podcasts reach the platform?",
    "options": ["Creators upload to it", "The platform polls the creator's RSS feed", "Email", "FTP"],
    "answer": 1,
    "explanation": "RSS is the open distribution format for podcasts."
  },
  {
    "question": "What keeps feed polling cheap?",
    "options": ["Fetching everything every minute", "Adaptive schedules and conditional GETs that return 304 when unchanged", "Bigger servers", "Ignoring old shows"],
    "answer": 1,
    "explanation": "Most feeds rarely change, so most fetches cost almost nothing."
  },
  {
    "question": "How do we avoid duplicate episodes when re-fetching a feed?",
    "options": ["Compare titles", "Upsert by the episode's GUID", "Delete and reinsert", "Ask the creator"],
    "answer": 1,
    "explanation": "The GUID uniquely identifies each item in the feed."
  },
  {
    "question": "Why serve popular episodes through our CDN?",
    "options": ["Branding", "So release spikes don't overwhelm creators' hosting", "Required by RSS", "To transcode audio"],
    "answer": 1,
    "explanation": "The CDN fetches once per edge and serves millions."
  }
]
```
