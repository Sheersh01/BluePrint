---
title: Blogging Platform
seoTitle: Design a Blogging Platform Like Medium
description: Design a blogging platform — writing and publishing posts with drafts, serving read-heavy articles fast via caching and static rendering, comments, and follower feeds.
tags: Scaling Reads
difficulty: easy
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition ✍️ What is a Blogging Platform?
A blogging platform like Medium or WordPress.com lets writers draft and publish articles, and lets readers read, comment on and follow writers.
:::

### Functional Requirements

**Core Requirements**

1. Writers should be able to create drafts, edit them, and publish posts with images.
2. Readers should be able to read published posts by URL.
3. Readers should be able to comment on posts.
4. Readers should be able to follow writers and see a feed of new posts.

**Below the line (out of scope):**

- Monetisation and paywalls.
- Recommendations.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Extremely read-heavy (1000:1); post pages load in < 200ms worldwide.
2. Highly available reads; publishing can take a few seconds to propagate.
3. Drafts must never be lost while writing.
4. SEO-friendly pages (server-rendered HTML).

**Below the line (out of scope):**

- Spam detection.

```sketch Blogging Requirements
Functional
- drafts, edit, publish w/ images
- read by URL
- comments
- follow + feed

Non-functional
- read-heavy, < 200ms globally
- available reads
- never lose drafts
- SEO-friendly HTML
```

## The Set Up

### Defining the Core Entities

1. **Post**: author, title, slug, body (rich text / markdown), status (draft/published), timestamps.
2. **Revision**: saved versions of a draft.
3. **Comment**: post, author, text, parent comment.
4. **Follow**: reader → writer.

### API or System Interface

```
POST  /posts -> { postId } (draft)
PATCH /posts/:id { title, body } (autosave)
POST  /posts/:id/publish -> { url }
GET   /@author/:slug -> HTML page
POST  /posts/:id/comments { text, parentId? }
GET   /feed?cursor -> Post[]
```

## High-Level Design

### 1) Writers draft and publish

The editor autosaves to the **Post Service** every few seconds, storing revisions so nothing is lost. Images upload directly to blob storage via presigned URLs. Publishing marks the post published and triggers rendering.

```diagram Write and read paths
node writer 0,0.3 box "Writer|editor + autosave"
node post 1.5,0.3 box "Post Service"
node db 3,0.3 circle "Posts DB"
node render 3,1.6 box "Renderer|HTML on publish"
node cdn 1.5,1.6 circle "CDN"
node reader 0,1.6 box "Reader"
edge writer <-> post
edge post <-> db
edge post -> render "published"
edge render -> cdn "push / purge"
edge reader <-> cdn "GET /@author/slug"
```

### 2) Readers read posts

Published posts rarely change, so render them to HTML at publish time (or on first request) and serve them from a **CDN**. Edits re-render and purge that URL. Dynamic bits (comment counts, "you follow this author") load separately via small API calls.

### 3) Comments

Comments are stored per post and loaded via the API with cursor pagination, cached briefly per post since most readers see the same first page.

### 4) Follow feed

When a writer publishes, a worker adds the post to followers' feeds (fan-out on write is fine — publishing is rare compared to reading), stored as capped lists in a cache.

## Potential Deep Dives

### 1) How do we serve posts fast to a global audience?

:::solution bad Render from the database on every request
#### Approach

Query the post and render HTML per page view.

#### Challenges

Wasted work at 1000:1 read ratios and slow for distant readers.
:::

:::solution good Application cache
#### Approach

Cache rendered HTML in Redis near the app servers.

#### Challenges

Faster, but readers far from the region still pay network latency.
:::

:::solution great Static rendering + CDN with targeted purge
#### Approach

Generate HTML at publish time (incremental static regeneration), cache it at the CDN edge with long TTLs, and purge just that URL on edits. Personalised fragments load client-side so the page itself stays cacheable for everyone.

#### Challenges

Purge latency means an edit may take seconds to appear everywhere — acceptable here.
:::

### 2) How do we never lose a draft?

Autosave frequently with small diffs, store revisions server-side with optimistic concurrency (a version number) to detect conflicting edits from two tabs, and keep a local copy in the browser so writing continues offline and syncs when the connection returns.

### Final Design

```diagram Final Design
node writer 0,0.3 box "Writers"
node reader 0,1.7 box "Readers"
node cdn 1.4,1.7 circle "CDN|static HTML"
node api 1.4,0.3 box "Post + Comment API"
node db 2.8,0.3 circle "Posts DB|+ revisions"
node render 2.8,1.7 box "Renderer + Purger"
node s3 4.2,0.3 circle "Images (S3)"
node feed 4.2,1.7 box "Feed Workers|-> follower feeds"
edge writer <-> api
edge reader <-> cdn
edge reader <-> api "comments, feed"
edge api <-> db
edge api -> render
edge render -> cdn
edge writer -> s3
edge api -> feed
```

```quiz
[
  {
    "question": "Why render posts to HTML at publish time?",
    "options": ["For security", "Posts are read far more than written, so render once and serve many times", "Databases can't store HTML", "Writers prefer it"],
    "answer": 1,
    "explanation": "Pre-rendered pages are cheap to cache and serve."
  },
  {
    "question": "How do you keep post pages cacheable while showing personalised info?",
    "options": ["Disable caching", "Load personalised fragments separately via small API calls", "Render per user", "Use cookies in the cache key"],
    "answer": 1,
    "explanation": "The page stays identical for everyone; personalised bits load client-side."
  },
  {
    "question": "Why is fan-out on write fine for follower feeds here?",
    "options": ["Writers have few followers", "Publishing is rare compared to reading", "Feeds are small", "It's required"],
    "answer": 1,
    "explanation": "Infrequent publishes keep write amplification affordable."
  },
  {
    "question": "What protects drafts from being lost?",
    "options": ["Manual save only", "Frequent autosave with server-side revisions and a local copy", "Email backups", "Caching"],
    "answer": 1,
    "explanation": "Revisions plus local persistence survive crashes and disconnects."
  }
]
```
