---
title: Google Docs
seoTitle: Design a Collaborative Editor Like Google Docs
description: Design Google Docs — real-time collaborative editing with operational transformation or CRDTs, WebSocket sessions, presence and scalable document storage.
tags: Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 4, 2026
askedAt: Google, Microsoft, Notion | 12
---

## Understanding the Problem

:::definition 📝 What is Google Docs?
Google Docs is a browser-based word processor where many people can edit the same document at the same time and see each other's changes and cursors live.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create a document.
2. Multiple users should be able to edit the same document concurrently.
3. Users should see other users' changes in real time.
4. Users should see the cursor positions and presence of other editors.

**Below the line (out of scope):**

- Rich formatting, images and comments.
- Permissions and sharing.
- Offline editing and full version history.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Edits should propagate to other collaborators with low latency (< 100ms).
2. All collaborators must converge to the same document state (eventual consistency with convergence).
3. The system should scale to millions of concurrent documents, with up to ~100 concurrent editors per document.
4. Documents must be durable — no acknowledged edit is ever lost.

**Below the line (out of scope):**

- Documents larger than a few MB.

```sketch Google Docs Requirements
Functional
- create document
- concurrent editing
- see changes in real time
- see cursors / presence

Non-functional
- < 100ms propagation
- all editors converge
- millions of docs, ~100 editors/doc
- durable edits
```

## The Set Up

### Planning the Approach

The central challenge is **concurrent edits to the same text**. If two users insert at position 5 at the same time, naively applying both produces different documents on each screen. We need an algorithm that guarantees convergence, plus an architecture that routes all editors of a document together.

### Defining the Core Entities

1. **Document**: id, title, and its current content (or a snapshot plus operations).
2. **Edit (Operation)**: an insert or delete at a position, with the document version it was based on.
3. **Cursor / Presence**: a user's position and selection in a document.
4. **Editor**: a user connected to a document.

```sketch Google Docs Entities
Core Entities
- Document
- Edit (operation)
- Cursor / Presence
- Editor
```

### API or System Interface

Creating a document is plain REST:

```
POST /docs { "title": "Untitled" } -> { "docId" }
```

Editing happens over a WebSocket, because changes flow both ways continuously:

```
WS /docs/:docId
-> { "type": "insert", "pos": 5, "text": "hi", "baseVersion": 42 }
-> { "type": "delete", "pos": 3, "len": 2, "baseVersion": 42 }
-> { "type": "cursor", "pos": 10 }
<- { "type": "op", ...transformed op..., "version": 43 }
<- { "type": "cursor", "userId": "u2", "pos": 7 }
```

## High-Level Design

### 1) Users should be able to create a document

A **Document Metadata Service** creates the document record and an empty content snapshot.

### 2) Users should be able to edit concurrently and see changes in real time

Clients connect to a **Document Service** over WebSockets. Every edit is sent to the server, which orders it, transforms it against concurrent edits, persists it and broadcasts it to the other connected editors.

```diagram Collaborative editing
node c1 0,0.4 box "Client A"
node c2 0,1.6 box "Client B"
node doc 1.6,1 box "Document Service|- order & transform ops|- broadcast"
node ops 3.1,0.4 circle "Ops Log"
node snap 3.1,1.6 circle "Snapshots"
edge c1 <-> doc "WebSocket"
edge c2 <-> doc "WebSocket"
edge doc -> ops "append op"
edge doc <-> snap
```

### 3) Users should see cursors and presence

Cursor updates are sent over the same WebSocket but are **ephemeral**: the server broadcasts them to other editors and keeps them in memory only. Losing a cursor update is harmless; the next one replaces it.

## Potential Deep Dives

### 1) How do we make concurrent edits converge?

:::solution bad Last write wins on the whole document
#### Approach

Each client sends the full document; the latest save overwrites.

#### Challenges

Concurrent edits silently erase each other. Completely unusable for real-time collaboration.
:::

:::solution great Operational Transformation (OT) with a central server
#### Approach

Clients send operations tagged with the version they were based on. The server holds the authoritative sequence: if an incoming op is based on an older version, it is **transformed** against every op applied since — e.g. an insert at position 5 is shifted to 7 if someone else inserted 2 characters before it. The transformed op gets the next version number and is broadcast. Clients similarly transform incoming ops against their own pending, unacknowledged ops.

#### Challenges

OT requires a single ordering authority per document, and transformation functions are subtle to get right (especially with rich text). It's what Google Docs actually uses.
:::

:::solution great CRDTs
#### Approach

Use a Conflict-free Replicated Data Type (e.g. Yjs, Automerge) where every character has a unique, ordered identifier. Operations commute, so replicas converge regardless of the order they apply ops — no central transformation needed, which also enables offline and peer-to-peer editing.

#### Challenges

CRDT metadata (identifiers and tombstones for deleted characters) can make documents larger, and garbage-collecting it is complex. A server is still useful for persistence and fan-out.
:::

### 2) How do we route all editors of a document to the same server?

OT needs one server to order each document's operations. Use **consistent hashing on docId** so every client for a document connects to the same Document Service instance. A coordination service (ZooKeeper/etcd) holds the ring; on scale-out or failure, documents move to their new owner, which loads the latest snapshot plus subsequent ops before accepting edits.

:::warning
If two servers believe they own the same document (split brain), they will assign conflicting versions. Ownership needs leases with fencing tokens so a stale owner's writes are rejected.
:::

### 3) How do we store documents durably and load them quickly?

:::solution good Store every operation forever
#### Approach

Append every op to a log keyed by `(docId, version)`; replay to build the document.

#### Challenges

Opening a document with a million edits means replaying a million ops.
:::

:::solution great Operation log + periodic snapshots (compaction)
#### Approach

Persist each op durably before acknowledging it (so no edit is lost), and periodically write a **snapshot** of the full document at version N. Loading a document reads the latest snapshot and replays only the ops after it. Old ops can be archived or deleted once covered by a snapshot.

#### Challenges

Snapshotting must not block editing — do it asynchronously from the op log.
:::

### Final Design

```diagram Final Design
node c 0,1.2 box "Clients"
node lb 1.2,1.2 box "WS Gateway|- route by docId"
node zk 1.2,0 circle "etcd|(ring, leases)"
node doc 2.5,1.2 box "Document Service|- OT per doc|- presence in memory"
node meta 2.5,2.4 box "Metadata Service"
node ops 3.8,0.6 circle "Ops Log"
node snap 3.8,1.8 circle "Snapshots"
node compact 5,1.2 box "Compactor"
edge c <-> lb
edge lb <-> zk
edge lb <-> doc
edge c <-> meta "REST"
edge doc -> ops
edge doc <-> snap
edge compact <-> ops
edge compact -> snap
```

```quiz
[
  {
    "question": "What problem do OT and CRDTs solve?",
    "options": ["Authentication", "Making concurrent edits converge to the same document", "Compressing documents", "Search"],
    "answer": 1,
    "explanation": "Both guarantee all replicas end up identical even when users edit simultaneously.",
    "section": "1-how-do-we-make-concurrent-edits-converge"
  },
  {
    "question": "Why are all editors of a document routed to the same server in an OT design?",
    "options": ["To save bandwidth", "OT needs a single authority to order operations", "Browsers require it", "To cache images"],
    "answer": 1,
    "explanation": "One owner assigns versions and transforms ops, so routing by docId (consistent hashing) is used.",
    "section": "2-how-do-we-route-all-editors-of-a-document-to-the-same-server"
  },
  {
    "question": "How do snapshots help document loading?",
    "options": ["They encrypt documents", "You replay only ops after the latest snapshot instead of the full history", "They replace the op log entirely", "They store cursors"],
    "answer": 1,
    "explanation": "Snapshots bound replay cost no matter how long the edit history grows.",
    "section": "3-how-do-we-store-documents-durably-and-load-them-quickly"
  },
  {
    "question": "Why can cursor positions be kept only in memory?",
    "options": ["They are large", "They are ephemeral — a lost update is replaced by the next one", "They must be encrypted", "Databases can't store them"],
    "answer": 1,
    "explanation": "Presence doesn't need durability; persisting it would only add load."
  }
]
```
