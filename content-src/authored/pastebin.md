---
title: Pastebin
seoTitle: Design a Text Sharing Service Like Pastebin
description: Design Pastebin — storing text snippets, generating short shareable links, expiring pastes, and serving reads cheaply from blob storage and a CDN.
tags: Scaling Reads, Handling Large Blobs
difficulty: easy
author: Editorial Team
published: Nov 10, 2026
askedAt: Amazon, Vanta, Nutanix | 0
---

## Understanding the Problem

:::definition 📋 What is Pastebin?
Pastebin lets anyone paste a block of text — code, logs, notes — and get back a short link they can share. Anyone with the link can read it until it expires.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create a paste (up to 10MB of text) and receive a unique short URL.
2. Users should be able to read a paste by visiting its URL.
3. Users should be able to set an optional expiration time.

**Below the line (out of scope):**

- User accounts, editing and syntax highlighting.
- Private pastes with passwords.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Reads should be fast (< 200ms) and highly available.
2. Paste URLs must be unique and hard to guess.
3. Storage must be durable — a paste never disappears before it expires.
4. Scale to 10M new pastes per day and a 10:1 read-to-write ratio.

**Below the line (out of scope):**

- Abuse and spam detection.

```sketch Pastebin Requirements
Functional
- create paste (<= 10MB) -> short URL
- read paste by URL
- optional expiration

Non-functional
- fast, available reads
- unique, unguessable IDs
- durable until expiry
- 10M pastes/day
```

## The Set Up

### Defining the Core Entities

1. **Paste**: an ID, the content (or a pointer to it), size, created and expiry times.
2. **User**: optional creator (anonymous by default).

### API or System Interface

```
POST /pastes
{ "content": "...", "expiresIn": "1d" } -> { "id": "x7Kp2q", "url": "https://paste.example/x7Kp2q" }

GET /pastes/:id -> { "content": "...", "createdAt": "...", "expiresAt": "..." }
```

## High-Level Design

### 1) Users should be able to create a paste

The **Paste Service** generates an ID, writes the content to **blob storage** (S3) keyed by that ID, and stores small metadata (ID, size, expiry, S3 key) in a database. Content can be up to 10MB, so it doesn't belong in a database row.

```diagram Create and read a paste
node client 0,1 box "Client"
node api 1.3,1 box "Paste Service"
node db 2.6,0.3 circle "Metadata DB"
node s3 2.6,1.7 circle "S3|content"
node cdn 0,2.3 circle "CDN"
note 3.1,0.3 "Paste|- id|- s3Key|- size|- expiresAt"
edge client <-> api "POST /pastes"
edge api <-> db
edge api <-> s3
edge client <-> cdn "GET /pastes/:id"
edge cdn <-> s3
```

### 2) Users should be able to read a paste

Reads look up the metadata (to check expiry) and return the content. Because pastes never change after creation, they are perfect for caching: serve them through a **CDN** with a TTL that never exceeds the paste's remaining lifetime.

### 3) Pastes should expire

Store `expiresAt` and check it on every read (return `404`/`410` once passed). Use S3 lifecycle rules or a periodic cleanup job to delete expired content so storage doesn't grow forever.

## Potential Deep Dives

### 1) How do we generate unique, unguessable IDs?

:::solution bad Auto-increment IDs
#### Approach

Use the database's sequence and encode it in base62.

#### Challenges

IDs are sequential, so anyone can enumerate every paste — a real problem when people paste secrets by accident.
:::

:::solution good Random IDs with collision checks
#### Approach

Generate 8 random base62 characters (62^8 ≈ 218 trillion possibilities) and insert with a uniqueness constraint; retry on the rare collision.

#### Challenges

Very low collision probability at this scale; the retry path is simple. A cryptographically secure RNG makes IDs hard to guess.
:::

:::solution great Pre-generated key service
#### Approach

A background **Key Generation Service** fills a table with unused random IDs. Writers claim a batch of keys and use them locally, so the write path never waits on collision checks.

#### Challenges

More moving parts; keys claimed by a crashed server are simply lost, which is harmless.
:::

### 2) How do we keep reads fast and cheap?

Pastes are immutable, so cache aggressively. The CDN serves popular pastes from the edge; behind it, an in-memory cache holds hot metadata. Small pastes (under a few KB) can be inlined in the metadata row to avoid a second fetch from S3, while large ones stream straight from blob storage.

:::tip
Compress content before storing it. Plain text compresses 5-10×, which cuts storage and transfer costs dramatically.
:::

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node cdn 1.2,2.3 circle "CDN"
node api 1.3,1.2 box "Paste Service"
node kgs 1.3,0 box "Key Generation|Service"
node cache 2.6,0.5 circle "Cache"
node db 3.8,0.5 circle "Metadata DB"
node s3 2.6,2 circle "S3|(compressed)"
node gc 3.8,2 box "Expiry Cleanup"
edge client <-> api
edge client <-> cdn
edge cdn <-> s3
edge api <-> kgs "claim IDs"
edge api <-> cache
edge cache <-> db
edge api <-> s3
edge gc -> s3
edge gc -> db
```

```quiz
[
  {
    "question": "Why store paste content in blob storage instead of the database?",
    "options": ["Databases can't store text", "Pastes can be up to 10MB, which bloats rows and is cheaper in object storage", "For strong consistency", "To make IDs shorter"],
    "answer": 1,
    "explanation": "Large immutable blobs belong in object storage; the database keeps small metadata."
  },
  {
    "question": "What is the risk of sequential paste IDs?",
    "options": ["They are too long", "Anyone can enumerate every paste", "They collide often", "They break CDNs"],
    "answer": 1,
    "explanation": "Random IDs prevent people from iterating through other users' pastes."
  },
  {
    "question": "Why are pastes ideal for CDN caching?",
    "options": ["They are encrypted", "They never change after creation", "They are small", "They have no expiry"],
    "answer": 1,
    "explanation": "Immutable content can be cached safely; just cap the TTL at the remaining lifetime."
  },
  {
    "question": "How should expired pastes be handled?",
    "options": ["Never delete them", "Check expiresAt on read and clean up storage periodically", "Delete the whole database daily", "Rely on the browser"],
    "answer": 1,
    "explanation": "Read-time checks enforce expiry immediately; lifecycle jobs reclaim storage."
  }
]
```
