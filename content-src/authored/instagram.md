---
title: Instagram
seoTitle: Design a Photo Sharing App Like Instagram
description: Design Instagram — photo/video posts, follows and a low-latency home feed — covering fan-out strategies, media upload and CDN delivery.
tags: Scaling Reads, Handling Large Blobs
difficulty: medium
author: Editorial Team
published: Nov 4, 2026
askedAt: Meta, Google, Snap | 14
---

## Understanding the Problem

:::definition 📸 What is Instagram?
Instagram is a social network for sharing photos and videos. Users follow other accounts and scroll a home feed of recent posts from the people they follow.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create posts with a photo or video and a caption.
2. Users should be able to follow other users.
3. Users should be able to view a chronological feed of posts from the users they follow.

**Below the line (out of scope):**

- Likes, comments, and direct messages.
- Stories, Reels ranking, and search.
- Ranked (algorithmic) feeds.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. The system should be highly available, prioritising availability over consistency (a post may take a few seconds to show up in feeds).
2. Feed loads should be fast — under 500ms end to end.
3. Media should render quickly anywhere in the world.
4. The system should scale to 500M daily active users, with some accounts having 100M+ followers.

**Below the line (out of scope):**

- Content moderation.
- Analytics.

```sketch Instagram Requirements
Functional
- create post (photo/video + caption)
- follow users
- view chronological feed

Non-functional
- availability >> consistency
- feed < 500ms
- fast media globally
- 500M DAU, celebrities w/ 100M followers
```

## The Set Up

### Planning the Approach

The two hard parts here are the **feed** (a fan-out problem) and **media** (a large-blob problem). We'll get a simple design working first, then go deep on both.

### Defining the Core Entities

1. **User**: an account that posts and follows others.
2. **Post**: a caption plus a reference to a media object, owned by a user.
3. **Media**: the photo or video bytes, stored in blob storage.
4. **Follow**: a directed edge from follower to followee.

```sketch Instagram Entities
Core Entities
- User
- Post
- Media
- Follow
```

### API or System Interface

```
POST /posts
{ "mediaId": "...", "caption": "..." } -> Post

POST /media/upload-url -> { "mediaId", "uploadUrl" }

POST /users/:userId/follow

GET /feed?cursor={cursor}&limit={limit} -> Post[]
```

## High-Level Design

### 1) Users should be able to create posts

Media is large, so it should never flow through our application servers. The client asks the **Post Service** for a presigned upload URL, uploads the bytes directly to S3, then creates the post with the returned `mediaId`.

```diagram Create a post
node client 0,1 box "Client"
node gw 1,1 box "API Gateway"
node post 2.2,1 box "Post Service"
node db 3.5,1 circle "Posts DB"
node s3 1.6,2.2 circle "S3"
note 4,1 "Post|- id|- userId|- mediaId|- caption|- createdAt"
edge client <-> gw "POST /posts"
edge gw <-> post
edge post <-> db
edge client -> s3 "upload via|presigned URL"
```

1. Client requests an upload URL; the Post Service returns a presigned S3 URL and a `mediaId`.
2. Client uploads the photo straight to S3.
3. Client calls `POST /posts` with the `mediaId` and caption; the Post Service writes the Post row.

### 2) Users should be able to follow other users

A **Follow Service** writes to a Follow table keyed by `(followerId, followeeId)`. We'll want to query in both directions — "who do I follow" for building feeds and "who follows me" for fan-out — so we add a secondary index on `followeeId`. DynamoDB with a GSI or Postgres with two indexes both work.

### 3) Users should be able to view their feed

The simplest approach is fan-out on read: look up everyone I follow, fetch their recent posts, merge and sort.

```diagram Feed (fan-out on read)
node client 0,1 box "Client"
node gw 1,1 box "API Gateway"
node feed 2.2,1 box "Feed Service"
node follow 3.5,0.3 circle "Follows DB"
node db 3.5,1.7 circle "Posts DB"
edge client <-> gw "GET /feed"
edge gw <-> feed
edge feed <-> follow "1. who do I follow"
edge feed <-> db "2. recent posts"
```

This works for small accounts, but if a user follows 2,000 accounts, every feed load becomes thousands of queries. That brings us to the deep dives.

## Potential Deep Dives

### 1) How do we make feed loads fast at scale?

:::solution bad Fan-out on read for everyone
#### Approach

Compute the feed at request time by querying the latest posts for every followee and merging them.

#### Challenges

Feed reads are by far the most common operation. Doing hundreds or thousands of lookups per load makes latency unpredictable and puts enormous load on the Posts DB.
:::

:::solution good Fan-out on write (precomputed feeds)
#### Approach

When a user posts, a worker looks up their followers and appends the post ID to each follower's precomputed feed — a Redis sorted set keyed by `feed:{userId}` scored by timestamp. Reading a feed is now a single `ZREVRANGE`.

#### Challenges

Celebrities break this. A post from an account with 100M followers means 100M writes, delaying delivery and costing a fortune — most of those feeds belong to inactive users who'll never look.
:::

:::solution great Hybrid fan-out
#### Approach

Fan out on write for normal accounts, but **skip fan-out for accounts above a follower threshold** (say 100k). At read time, the Feed Service merges the user's precomputed feed with the recent posts of the few celebrities they follow, which are cheap to fetch and heavily cached.

#### Challenges

Two code paths to maintain, and the threshold needs tuning. Feeds for inactive users can also be skipped entirely and rebuilt lazily on their next login.
:::

:::pattern Pattern: Scaling Reads
Precomputing feeds trades write amplification for constant-time reads — exactly the right trade when reads outnumber writes by 100:1 or more.
:::

### 2) How do we serve media fast worldwide?

Uploaded originals land in S3. A media-processing worker (triggered by an S3 event) generates resized variants — thumbnails for the grid, medium for the feed, full size for detail view — and transcodes video. All variants are served through a **CDN**, so images are cached close to users and S3 is rarely hit directly.

:::tip
Serve the right size for the device. Sending a 4K original to a phone showing a 400px thumbnail wastes bandwidth and slows the feed far more than any backend optimisation.
:::

### 3) How do we keep the Posts DB from becoming a bottleneck?

Feed pages return post IDs, so the Feed Service must hydrate them into full posts. A distributed cache in front of the Posts table (posts rarely change, so long TTLs are safe) absorbs nearly all of these reads. Shard the Posts table by `postId` to spread writes, and shard precomputed feeds in Redis by `userId`.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node cdn 0,2.4 circle "CDN"
node gw 1,1.2 box "API Gateway"
node post 2.2,0.4 box "Post Service"
node feed 2.2,1.4 box "Feed Service|- merge celeb posts"
node follow 2.2,2.4 box "Follow Service"
node q 3.3,0.4 circle "Queue"
node workers 4.4,0.4 box "Fan-out Workers"
node redis 4.4,1.5 circle "Feed Cache|(Redis)"
node db 3.3,1.6 circle "Posts DB|+ cache"
node fdb 3.3,2.6 circle "Follows DB"
node s3 1.1,2.6 circle "S3"
edge client <-> gw
edge client <-> cdn "media"
edge cdn <-> s3
edge gw <-> post
edge gw <-> feed
edge gw <-> follow
edge post -> q
edge q -> workers
edge workers -> redis
edge feed <-> redis
edge feed <-> db
edge follow <-> fdb
edge post <-> db
```

```quiz
[
  {
    "question": "Why does pure fan-out on write break down for celebrity accounts?",
    "options": ["Their posts are larger", "A single post must be written to tens of millions of feeds", "They post too rarely", "Their followers are offline"],
    "answer": 1,
    "explanation": "Write amplification scales with follower count; 100M followers means 100M feed writes per post.",
    "section": "1-how-do-we-make-feed-loads-fast-at-scale"
  },
  {
    "question": "In a hybrid feed, when are celebrity posts merged in?",
    "options": ["At write time", "At read time", "Nightly", "Never"],
    "answer": 1,
    "explanation": "Celebrity posts skip fan-out and are merged into the precomputed feed when the user loads it."
  },
  {
    "question": "Why should clients upload media using presigned URLs?",
    "options": ["It compresses the media", "It keeps large bytes off our application servers", "It removes the need for a CDN", "It encrypts the media"],
    "answer": 1,
    "explanation": "The client streams directly to blob storage; our servers only handle small metadata requests."
  },
  {
    "question": "Which data structure works well for a precomputed feed in Redis?",
    "options": ["A sorted set scored by timestamp", "A HyperLogLog", "A Bloom filter", "A plain string"],
    "answer": 0,
    "explanation": "Sorted sets keep post IDs ordered by time and support cheap range reads for pagination."
  }
]
```
