---
title: API Design Cheat Sheet
subtitle: The conventions interviewers expect in five minutes of API design — and the small details that separate a good answer from a great one.
section: tips
category: Tips & Tricks
seoTitle: API Design Cheat Sheet for System Design Interviews
description: REST conventions, pagination, idempotency, async operations, auth and errors — the API details that come up in system design interviews.
author: Editorial Team
published: Nov 11, 2026
---

The API step is short, but it's where interviewers check that you think about the contract between client and server. Aim for one endpoint per functional requirement, then sprinkle in the details below where they matter.

## The Basics

| Do | Example |
|---|---|
| Plural resource nouns, verbs come from the HTTP method | `POST /bookings`, `GET /bookings/{id}` |
| `GET` reads, `POST` creates, `PUT`/`PATCH` updates, `DELETE` removes | `PATCH /posts/{id} { title }` |
| Nest only for true ownership | `GET /events/{id}/seats` |
| Request body for data, path for identity | `POST /urls { longUrl }` — not `POST /urls/{longUrl}` |
| Return the created resource (or its id) | `POST /posts → 201 { id, … }` |
| Version the API | `/v1/…` or a header |

## Identity Comes From the Token

```
❌ POST /users/{userId}/posts        (anyone can post as anyone)
✅ POST /posts                        Authorization: Bearer <token>
```

The server reads the user from the session or JWT. Putting `userId` in the path or body for the *current* user is the most common API mistake in interviews.

## Pagination

| Approach | How | Use when | Problem |
|---|---|---|---|
| Offset | `?offset=40&limit=20` | Small, static lists; "jump to page 7" | Slow for deep pages; items shift when new ones arrive |
| Cursor | `?cursor=abc&limit=20` → `{ items, nextCursor }` | Feeds, timelines, infinite scroll | Can't jump to an arbitrary page |

**Default to cursor pagination** for anything that changes in real time. The cursor usually encodes the last item's sort key (e.g. `createdAt` + `id`).

## Making Writes Safe to Retry

```
POST /payments
Idempotency-Key: 7f3c…
{ amount: 100, currency: "INR" }
```

The server stores the key with the result; a retry with the same key returns the stored result instead of acting twice. Mention this for payments, orders, bookings — anything a double-click or timeout could duplicate. See [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios).

## Long-Running Work

Don't hold an HTTP request open for minutes.

```
POST /exports            → 202 Accepted { jobId }
GET  /exports/{jobId}    → { status: "running" | "done", url? }
```

Then let the client poll, or push completion via WebSocket, server-sent events or a webhook.

## Uploads and Downloads of Big Files

```
POST /uploads            → { uploadUrl (pre-signed), fileId }
PUT  <uploadUrl>          (client → object storage directly)
POST /uploads/{fileId}/complete
```

Large bytes go straight to object storage via pre-signed URLs; your servers only handle metadata. Chunked/multipart uploads let big files resume.

## Real-Time

| Need | Use |
|---|---|
| Server pushes occasional updates | Server-sent events (SSE) |
| Two-way, frequent messages (chat, games) | WebSockets |
| Updates every few seconds are fine | Polling / long polling |
| Notify another *server* | Webhooks |

## Status Codes Worth Using

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | OK / Created / OK with no body |
| 202 | Accepted — work continues asynchronously |
| 400 / 422 | Bad input |
| 401 / 403 | Not signed in / not allowed |
| 404 | Not found (also good for "not yours" to avoid leaking existence) |
| 409 | Conflict — seat already taken, version mismatch |
| 429 | Rate limited — include `Retry-After` |
| 503 | Temporarily unavailable — safe to retry later |

## Concurrency in the API

For "edit the same thing at the same time" problems, use optimistic concurrency:

```
GET  /docs/42            → { …, version: 7 }
PUT  /docs/42            If-Match: 7   → 200, or 409 if someone saved version 8 first
```

## REST, GraphQL or gRPC?

| Choice | Pick it when |
|---|---|
| REST | Default for public/client APIs — say this and move on |
| GraphQL | Many client types need different shapes of the same data |
| gRPC | Internal service-to-service calls where performance matters |

:::tip
Don't spend more than one sentence on this unless the interviewer asks. "REST for the client API, gRPC between internal services" is a complete answer.
:::
