---
title: Handling Large Blobs
subtitle: Moving and serving big files — presigned URLs, multipart and resumable uploads, blob storage, and CDN delivery.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Photos, videos, documents and backups are large, opaque byte arrays — **blobs**. They don't belong in your database, and they shouldn't stream through your application servers either. This pattern is about getting big files in and out efficiently while your services only handle small metadata.

## The Problem

The naive design uploads a file to an API server, which writes it to storage:

1. The client sends 2GB to your server.
2. Your server holds the connection (and maybe memory) for minutes.
3. Your server re-uploads the same 2GB to storage.

Servers become bandwidth bottlenecks, timeouts kill large uploads, a dropped connection restarts from zero, and you pay for the bytes twice.

## The Solution

:::solution bad Store blobs in the database
#### Approach

Save file bytes in a `BLOB` column alongside the metadata.

#### Challenges

Bloats the database, slows backups and replication, and ties expensive database storage to cheap file data.
:::

:::solution good Upload through the server to blob storage
#### Approach

Store files in object storage (S3, GCS) and keep only a reference in the database, but proxy uploads and downloads through your servers.

#### Challenges

Correct storage, but servers still carry every byte — the bandwidth and timeout problems remain.
:::

:::solution great Direct uploads with presigned URLs
#### Approach

1. The client asks your service for an upload URL; the service creates a metadata row (`status = UPLOADING`) and returns a **presigned URL** — a time-limited, signed permission to write one object.
2. The client uploads straight to blob storage.
3. Blob storage emits an event on completion (or the client confirms); the service marks the file `READY` and kicks off processing.

Downloads work the same way with presigned GET URLs, ideally through a CDN.

#### Challenges

Metadata and storage can drift (an upload that never completes) — clean up stale `UPLOADING` rows with a lifecycle job, and verify completion from storage events rather than trusting the client alone.
:::

:::solution great Multipart, resumable uploads
#### Approach

For large files, split them into chunks (5-100MB) and upload each with its own presigned URL — in parallel, and retrying only failed parts. Track completed parts so an interrupted upload resumes where it left off; finish with a "complete multipart upload" call.

#### Challenges

More client logic and state tracking, but essential for multi-GB files on flaky networks.
:::

```diagram Direct upload with presigned URLs
node client 0,1 box "Client"
node api 1.6,0.2 box "File Service|- presign URLs|- metadata"
node db 3.2,0.2 circle "Metadata DB"
node s3 1.6,1.8 circle "Blob Storage|(S3)"
node proc 3.2,1.8 box "Processing|(thumbnails, transcode)"
node cdn 0,2.4 circle "CDN"
edge client <-> api "1. get upload URL"
edge api <-> db
edge client -> s3 "2. upload bytes"
edge s3 -> proc "3. upload event"
edge proc -> db "mark READY"
edge cdn <-> s3
edge client <-> cdn "download"
```

## When to Use in Interviews

- [Dropbox](/learn/system-design/problem-breakdowns/dropbox) — chunked, resumable uploads of files up to 50GB.
- [YouTube](/learn/system-design/problem-breakdowns/youtube) — video uploads followed by transcoding.
- [Instagram](/learn/system-design/problem-breakdowns/instagram) — photo uploads and CDN delivery of resized variants.
- [WhatsApp](/learn/system-design/problem-breakdowns/whatsapp) — media attachments kept out of the chat path.

## Common Deep Dives

### How do you secure downloads?

Never make buckets public. Generate short-lived signed URLs (or signed CDN cookies) after checking the user's permissions, so a leaked link expires quickly.

### How do you process files after upload?

Trigger asynchronous workers from the storage event (resize images, transcode video, scan for malware). Store each output as its own object and update metadata when done; the client polls or is notified.

### How do you avoid storing duplicates?

Fingerprint content (e.g. SHA-256 per chunk). If a chunk already exists, skip uploading it and reference the existing object — great for backups and sync clients.

## Conclusion

Keep bytes out of your database and off your servers. Services issue presigned URLs and manage metadata; clients move bytes directly to and from blob storage, in resumable chunks for large files, with a CDN for delivery.

```quiz
[
  {
    "question": "What does a presigned URL allow?",
    "options": ["Permanent public access", "Time-limited permission to upload or download one object directly", "Database access", "Bypassing authentication forever"],
    "answer": 1,
    "explanation": "The service signs a URL scoped to one object and a short expiry."
  },
  {
    "question": "Why shouldn't uploads stream through application servers?",
    "options": ["Servers can't receive files", "They become bandwidth bottlenecks and pay for bytes twice", "It breaks HTTPS", "It disables CDNs"],
    "answer": 1,
    "explanation": "Direct uploads keep large byte transfers off your fleet."
  },
  {
    "question": "What makes a multi-GB upload resumable?",
    "options": ["Bigger timeouts", "Multipart upload with tracked chunk completion", "Compressing the file", "Using WebSockets"],
    "answer": 1,
    "explanation": "Only missing chunks are re-sent after an interruption."
  },
  {
    "question": "How should the service learn that an upload finished?",
    "options": ["Trust the client only", "From blob storage completion events (optionally with client confirmation)", "By polling every object", "It doesn't need to know"],
    "answer": 1,
    "explanation": "Storage events confirm the bytes actually landed before marking the file ready."
  }
]
```
