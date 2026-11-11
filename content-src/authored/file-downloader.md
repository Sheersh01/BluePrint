---
title: File Downloader Library
seoTitle: Design a File Downloader Library with Resume and Parallel Chunks
description: Design a client-side file downloader — parallel ranged downloads, pause and resume, retries with backoff, integrity checks, and the server support it needs.
tags: Handling Large Blobs
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Facebook | 0
---

## Understanding the Problem

:::definition ⬇️ What is a File Downloader Library?
A downloader library is the component an app uses to fetch large files — videos, game assets, offline maps — reliably over flaky networks, with progress, pause/resume and integrity checking, backed by a server that supports it.
:::

### Functional Requirements

**Core Requirements**

1. Apps should be able to enqueue downloads by URL and receive progress callbacks.
2. Users should be able to pause, resume and cancel downloads, including after an app restart.
3. Downloads should survive network interruptions and resume where they stopped.
4. Completed files should be verified against a checksum.

**Below the line (out of scope):**

- Peer-to-peer distribution.
- Uploads.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Efficient: saturate available bandwidth for large files without starving the app's other traffic.
2. Resilient: no re-downloading of completed bytes after interruptions.
3. Battery- and data-aware on mobile (e.g. Wi-Fi only option).
4. Server side scales to millions of concurrent downloads via CDN.

**Below the line (out of scope):**

- DRM.

```sketch Downloader Requirements
Functional
- enqueue + progress
- pause / resume / cancel
- resume after interruptions
- checksum verification

Non-functional
- use bandwidth well
- never refetch completed bytes
- battery / data aware
- CDN-scale serving
```

## The Set Up

### Defining the Core Entities

1. **Download task**: URL, destination, total size, ETag, status, priority.
2. **Chunk**: a byte range of the file with its own status and bytes written.
3. **Manifest**: file size, chunk checksums, overall hash (provided by the server).

### API or System Interface

```
// Client library
const id = downloader.enqueue({ url, dest, priority: "HIGH", wifiOnly: true })
downloader.onProgress(id, (bytes, total) => ...)
downloader.pause(id); downloader.resume(id); downloader.cancel(id)

// Server
HEAD /files/:id           -> Content-Length, ETag, Accept-Ranges: bytes
GET  /files/:id           Range: bytes=0-8388607  -> 206 Partial Content
GET  /files/:id/manifest  -> { size, sha256, chunks: [{ offset, length, sha256 }] }
```

## High-Level Design

### 1) Enqueue downloads and report progress

A **Download Manager** in the library keeps a persistent queue of tasks (in a small local database) and a pool of workers. Progress is the sum of bytes written across chunks, throttled to a few callbacks per second.

```diagram Client library and server
node app 0,1 box "App UI"
node mgr 1.4,1 box "Download Manager|- persistent queue|- scheduler"
node workers 2.8,1 box "Chunk Workers|parallel ranges"
node disk 1.4,2.3 circle "Local DB + File"
node cdn 4.2,1 circle "CDN"
node origin 5.4,1 box "Origin|+ manifest"
edge app <-> mgr "enqueue / progress"
edge mgr <-> workers
edge mgr <-> disk "task + chunk state"
edge workers <-> cdn "Range requests"
edge cdn <-> origin
```

### 2) Pause, resume and survive restarts

Each chunk's progress is persisted. Pausing stops workers; resuming (even after the app was killed) reloads the task and requests only the remaining bytes of each chunk with `Range` headers. The library sends `If-Range: <ETag>` so if the file changed on the server, it restarts rather than stitching two versions together.

### 3) Survive network interruptions

Failed chunk requests retry with exponential backoff and jitter. The library listens for connectivity changes and pauses on loss (or when leaving Wi-Fi if `wifiOnly`), resuming automatically.

### 4) Verify integrity

Each chunk is checked against its checksum from the manifest as it completes; a bad chunk is re-downloaded alone. When all chunks finish, the full file hash is verified before moving it from a temporary path to its destination atomically.

## Potential Deep Dives

### 1) How do we download large files fast?

:::solution bad Single stream, restart on failure
#### Approach

One GET for the whole file.

#### Challenges

A drop at 95% of a 4GB file restarts from zero; one TCP connection may not use the available bandwidth.
:::

:::solution good Resumable single stream
#### Approach

Track bytes written and resume with a `Range` request from that offset.

#### Challenges

Resilient, but still limited by one connection's throughput.
:::

:::solution great Parallel ranged chunks with adaptive concurrency
#### Approach

Split the file into chunks (e.g. 8MB) and download several in parallel, writing each at its offset in a pre-allocated file. Adjust concurrency based on observed throughput and errors (more connections on fast networks, fewer on congested or metered ones), and reassign the slowest remaining chunks near the end to avoid stragglers.

#### Challenges

Too many connections can be throttled by servers or hurt other app traffic; cap per-host concurrency.
:::

### 2) What does the server need to provide?

Serve files from a **CDN** with `Accept-Ranges: bytes`, strong ETags and correct `Content-Length`, and publish a manifest with chunk checksums. Use signed, expiring URLs for private files, and version file URLs so cached content never mixes versions. On mobile, OS background download APIs can carry transfers when the app isn't running.

### Final Design

```diagram Final Design
node app 0,1.2 box "App"
node mgr 1.4,1.2 box "Download Manager|- priorities|- wifi / battery policy"
node db 1.4,2.4 circle "Local State DB"
node workers 2.8,1.2 box "Chunk Workers|- adaptive concurrency|- backoff, If-Range"
node verify 2.8,2.4 box "Verifier|chunk + file hash"
node cdn 4.2,1.2 circle "CDN|signed URLs"
node origin 5.4,1.2 box "Origin|manifest + files"
edge app <-> mgr
edge mgr <-> db
edge mgr <-> workers
edge workers -> verify
edge workers <-> cdn
edge cdn <-> origin
```

```quiz
[
  {
    "question": "Which HTTP feature makes resuming a download possible?",
    "options": ["Cookies", "Range requests returning 206 Partial Content", "WebSockets", "CORS"],
    "answer": 1,
    "explanation": "The client asks only for the bytes it still needs."
  },
  {
    "question": "Why send If-Range with the ETag when resuming?",
    "options": ["For authentication", "So a changed file restarts instead of mixing two versions", "To compress data", "To speed up DNS"],
    "answer": 1,
    "explanation": "If the ETag no longer matches, the server returns the full new file."
  },
  {
    "question": "What do per-chunk checksums enable?",
    "options": ["Faster DNS", "Re-downloading only a corrupted chunk instead of the whole file", "Encryption", "Smaller files"],
    "answer": 1,
    "explanation": "Corruption is detected and repaired locally."
  },
  {
    "question": "Why write to a temporary path and rename on completion?",
    "options": ["To hide files", "So other code never sees a partial or unverified file", "It's faster", "For compression"],
    "answer": 1,
    "explanation": "Atomic rename finalises only verified files."
  }
]
```
