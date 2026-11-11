---
title: Live Video Streaming
seoTitle: Design a Live Video Streaming Platform like Twitch
description: Design a live streaming platform — ingesting broadcaster streams, real-time transcoding into an adaptive bitrate ladder, low-latency delivery through CDNs, and live chat at massive fan-out.
tags: Real-time Updates, Handling Large Blobs, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 📡 What is Live Video Streaming?
A live streaming platform lets a broadcaster send video from their computer or phone and lets thousands to millions of viewers watch it a few seconds later, while chatting alongside the stream. Unlike video on demand, nothing is pre-processed: every step has to happen in real time.
:::

### Functional Requirements

**Core Requirements**

1. Broadcasters should be able to start a live stream.
2. Viewers should be able to watch a live stream with only a few seconds of delay.
3. Viewers should be able to send and see chat messages for a stream.
4. Streams should be recorded and available for replay after they end.

**Below the line (out of scope):**

- Monetisation (subscriptions, ads, donations).
- Content moderation and copyright detection.
- Stream discovery and recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Glass-to-glass latency of about 2-5 seconds for normal streams.
2. Smooth playback across varied networks — adapt quality instead of buffering.
3. Scale to ~100k concurrent streams and individual streams with millions of viewers.
4. Highly available: a single server failure must not end a broadcast.

**Below the line (out of scope):**

- Sub-second interactive latency (video calls).
- Strong consistency for chat ordering across all viewers.

```sketch Live Streaming Requirements
Functional
- broadcaster goes live
- viewers watch, few seconds delay
- live chat
- replay after the stream

Non-functional
- 2-5s glass-to-glass latency
- adaptive quality, no buffering
- 100k streams, millions per stream
- survive server failures
```

## The Set Up

### Defining the Core Entities

1. **Channel**: a broadcaster's identity and their secret stream key.
2. **Stream**: one live broadcast session — status, start time, ingest server, renditions.
3. **Segment**: a short chunk (1-2 s) of encoded video at one quality level.
4. **Chat message**: user, stream, text and timestamp.

### API or System Interface

```
RTMP/SRT  rtmp://ingest.example.com/live/{streamKey}     (broadcaster push)
GET  /streams/:streamId/master.m3u8                      -> playlist of renditions
GET  /streams/:streamId/{rendition}/playlist.m3u8        -> latest segments
GET  /streams/:streamId/{rendition}/{segment}.m4s        -> video chunk (via CDN)
WS   /streams/:streamId/chat                             -> send / receive messages
GET  /streams/:streamId/replay                           -> VOD playlist
```

## High-Level Design

### 1) Broadcasters can start a live stream

Broadcasting software (OBS, a mobile app) pushes video over **RTMP or SRT** to the nearest **ingest server**, using the channel's stream key. The ingest server authenticates the key with the **Stream Service**, marks the stream live, and forwards the raw feed to transcoding.

```diagram Ingest
node broadcaster 0,1 box "Broadcaster|OBS / mobile"
node ingest 1.5,1 box "Ingest Server|(nearest PoP)"
node stream 3,0 box "Stream Service"
node db 4.5,0 circle "Stream DB"
node transcode 3,2 box "Transcoder"
edge broadcaster -> ingest "RTMP / SRT"
edge ingest <-> stream "auth stream key"
edge stream <-> db
edge ingest -> transcode "raw feed"
```

### 2) Viewers can watch with a few seconds of delay

The transcoder encodes the feed into an **adaptive bitrate ladder** (e.g. 1080p, 720p, 480p, 160p) and cuts each rendition into **1-2 second segments** (HLS or DASH with CMAF). Segments and updated playlists are written to an **origin**, and viewers fetch them through a **CDN**. The player picks the rendition matching its bandwidth and switches between them as conditions change.

```diagram Delivery
node transcode 0,1 box "Transcoder|ABR ladder|1-2s segments"
node origin 1.5,1 box "Origin|playlists + segments"
node cdn 3,1 box "CDN Edge"
node viewer 4.5,1 box "Viewer Player"
note 0,1.6 "1080p · 720p · 480p · 160p"
edge transcode -> origin
edge origin -> cdn "cache miss"
edge cdn <-> viewer "GET playlist / segment"
```

### 3) Viewers can chat

Viewers open a **WebSocket** to a chat server. A message is published to the stream's chat channel (Redis Pub/Sub or Kafka topic), and every chat server with viewers of that stream fans it out to its connected clients. Messages are also persisted for moderation and replay.

### 4) Streams are available for replay

Because segments already exist at every quality, a replay is just a **VOD playlist** listing the stream's segments in order. Segments are copied from the origin to durable object storage (S3) as they're produced, so the recording is ready the moment the stream ends.

## Potential Deep Dives

### 1) How do we keep latency down to a few seconds?

:::solution bad Standard HLS with long segments
#### Approach

Use 6-10 second segments and let players buffer three segments before playing.

#### Challenges

Latency becomes 20-30 seconds — chat reactions arrive long before viewers see the moment they're reacting to.
:::

:::solution good Short segments
#### Approach

Cut segments to 1-2 seconds with a keyframe at each boundary, and have players start near the live edge with a smaller buffer.

#### Challenges

Latency drops to ~6-10 seconds, but every segment still has to be fully encoded, uploaded and fetched before playback, and many tiny files increase request overhead.
:::

:::solution great Low-latency HLS / chunked CMAF
#### Approach

Use **Low-Latency HLS** (or LL-DASH): each segment is split into **partial chunks** of ~200-500 ms that are published as soon as they're encoded, and the CDN streams them using chunked transfer while the rest of the segment is still being produced. Playlists support **blocking reloads**, so players learn about new parts immediately instead of polling. Players hold a ~2-3 second buffer and speed up playback slightly when they drift behind.

#### Challenges

Requires CDN support for chunked transfer and blocking requests, and smaller buffers mean less tolerance for network hiccups — offer a "low-latency" toggle per stream.
:::

### 2) How do we serve millions of viewers on one stream?

Every viewer requests the same few segments at the same moment, which is a perfect fit for caching — as long as the origin isn't hit once per viewer.

:::solution bad Viewers fetch from the origin
#### Approach

Players request segments directly from the origin servers.

#### Challenges

A million viewers each fetching a 1 MB segment every 2 seconds is ~4 Tbps from the origin — impossible.
:::

:::solution good CDN in front of the origin
#### Approach

Serve segments through a CDN with short TTLs on playlists and long TTLs on segments (segments never change once written).

#### Challenges

When a new segment appears, thousands of edges miss at the same instant and stampede the origin.
:::

:::solution great Tiered caching with request collapsing
#### Approach

Put a **mid-tier shield** layer between edges and the origin, and enable **request collapsing**: concurrent misses for the same segment wait on a single upstream fetch. The origin sees roughly one request per shield per segment, regardless of audience size. Very popular streams can be **pushed** proactively to edges.

#### Challenges

Shields must be sized for peak events, and multiple CDNs may be needed for the largest broadcasts.
:::

### 3) How do we transcode 100k concurrent streams?

Real-time transcoding is the biggest cost. A fleet of transcoder workers (GPU or hardware encoders) is scheduled by a **job scheduler** that assigns each new stream to a worker with capacity, near its ingest PoP. To control cost, only popular or partner streams get the full ladder; small streams may get **source-quality passthrough** plus one lower rendition, and are upgraded automatically when viewers grow. If a transcoder dies, the scheduler reassigns the stream and the player rides through on its buffer.

:::tip
Mention the cost trade-off explicitly: most streams have very few viewers, so transcoding everything into five renditions wastes most of the compute.
:::

### 4) How does chat scale for a stream with a million viewers?

A million viewers typing produce more messages than anyone can read. Rate-limit senders, and on huge streams **sample** or batch messages per chat server (deliver at most N per second, with priority for moderators and subscribers). Fan-out uses a two-level hierarchy: the stream's channel delivers to chat servers, and each server delivers to its local connections, so a message is published once and copied only at the edge.

### Final Design

```diagram Final Design
node broadcaster -0.2,1 box "Broadcaster"
node ingest 1.2,1 box "Ingest PoP|RTMP / SRT"
node sched 1.2,-0.3 box "Stream Service|+ Scheduler"
node transcode 2.6,1 box "Transcoder Fleet|ABR · LL-HLS parts"
node origin 4,1 box "Origin"
node s3 4,2.4 circle "Object Storage|replays"
node shield 5.4,1 box "CDN Shield|request collapsing"
node edge 6.8,1 box "CDN Edge"
node viewer 8.2,1 box "Viewers"
node chat 6.8,-0.3 box "Chat Servers|WebSocket"
node pubsub 5.4,-0.3 circle "Pub/Sub|per stream"
edge broadcaster -> ingest
edge ingest <-> sched
edge ingest -> transcode
edge transcode -> origin
edge origin -> s3 "archive"
edge origin -> shield
edge shield -> edge
edge edge -> viewer
edge viewer <-> chat
edge chat <-> pubsub
```

```quiz
[
  {
    "question": "Why are live streams split into short segments?",
    "options": ["To encrypt them", "So players can download and switch quality chunk by chunk via ordinary HTTP and CDNs", "To reduce storage", "Because RTMP requires it"],
    "answer": 1,
    "explanation": "Segments make live video cacheable HTTP objects and enable adaptive bitrate switching."
  },
  {
    "question": "What mainly drives latency in standard HLS?",
    "options": ["DNS lookups", "Segment duration multiplied by the number of buffered segments", "Chat volume", "Database writes"],
    "answer": 1,
    "explanation": "Players buffer several full segments before playing, so long segments mean long delay."
  },
  {
    "question": "How do we stop thousands of CDN edges stampeding the origin when a new segment appears?",
    "options": ["Bigger origin disks", "A shield tier with request collapsing", "Longer playlist TTLs", "Sending segments by email"],
    "answer": 1,
    "explanation": "Collapsing concurrent misses into one upstream fetch keeps origin load independent of audience size."
  },
  {
    "question": "Why not transcode every stream into a full bitrate ladder?",
    "options": ["It's illegal", "Most streams have few viewers, so the compute cost is mostly wasted", "Players can't handle it", "It increases latency"],
    "answer": 1,
    "explanation": "Full ladders are reserved for popular streams; others get fewer renditions until their audience grows."
  }
]
```
