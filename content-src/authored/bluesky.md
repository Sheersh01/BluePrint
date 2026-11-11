---
title: Bluesky
seoTitle: Design a Decentralised Social Network like Bluesky
description: Design a decentralised social network like Bluesky — user-owned data repositories on personal data servers, a relay firehose, AppView indexing, portable identity, and custom feeds.
tags: Scaling Reads, Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🦋 What is Bluesky?
Bluesky is a Twitter-like social network built on an open protocol (the AT Protocol). Instead of one company owning everyone's data, each user's posts live in a **signed data repository** on a Personal Data Server (PDS) they can choose and move between. Other services crawl all repositories to build timelines, search and custom feeds. The design question is how to get a familiar, fast social experience out of a decentralised architecture.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to post, follow, like and repost.
2. Users should see a home timeline of posts from people they follow.
3. Users should be able to move their account to a different server without losing followers or posts.
4. Anyone should be able to build and offer **custom feeds** (e.g. "science posts") that users can subscribe to.

**Below the line (out of scope):**

- Direct messages.
- Detailed moderation (labelling services, mentioned briefly).
- Media storage details.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Timelines load in < 500 ms, just like a centralised app.
2. Posts appear for followers within a few seconds.
3. Data integrity: anyone can verify a post really came from its author.
4. Scale to ~30M users and thousands of posts and likes per second, with many independently run servers.

**Below the line (out of scope):**

- Full peer-to-peer operation without any large services.

```sketch Bluesky Requirements
Functional
- post, follow, like, repost
- home timeline
- portable accounts
- custom feeds by anyone

Non-functional
- timeline < 500ms
- followers see posts in seconds
- verifiable authorship
- 30M users, many servers
```

## The Set Up

### Defining the Core Entities

1. **DID (decentralised identifier)**: a permanent account ID that points to the user's current PDS and signing key.
2. **Handle**: a human-readable name (like `alice.example.com`) mapped to the DID via DNS.
3. **Repository**: a user's signed collection of records — posts, likes, follows — stored as a Merkle tree.
4. **Record**: one item, such as `app.bsky.feed.post`.
5. **Firehose event**: a commit to any repository, streamed by relays.

### API or System Interface

```
(PDS)     POST /xrpc/com.atproto.repo.createRecord { collection, record }
(Relay)   WS   /xrpc/com.atproto.sync.subscribeRepos      -> firehose of commits
(AppView) GET  /xrpc/app.bsky.feed.getTimeline?cursor=
(AppView) GET  /xrpc/app.bsky.feed.getFeed?feed=<feed generator>
(Feed gen) GET /xrpc/app.bsky.feed.getFeedSkeleton -> [postUris]
```

## High-Level Design

### 1) Users write to their own repository

A post is a new record written to the user's repository on their **PDS**, which signs the new repository root with the user's key. The PDS only stores its own users' data; it doesn't need to know about the rest of the network.

### 2) Relays aggregate everything into a firehose

**Relays** subscribe to every PDS they know and merge all commits into one ordered stream: the **firehose**. Anyone can consume it. Because commits are signed, consumers can verify each event without trusting the relay.

```diagram Write path
node user 0,1 box "User"
node pds 1.5,1 box "PDS|user's signed repo"
node relay 3,1 box "Relay|firehose"
node appview 4.5,1 box "AppView|indexes"
node feedgen 4.5,2.3 box "Feed Generators"
edge user -> pds "createRecord"
edge pds -> relay "commits"
edge relay -> appview
edge relay -> feedgen
```

### 3) The AppView builds the social experience

The **AppView** consumes the firehose and builds the indexes a social app needs: follower graphs, like counts, threads and **home timelines**. Clients read from the AppView, which works much like a centralised Twitter backend — it's just fed by an open stream instead of private writes.

### 4) Portable identity and custom feeds

A user's **DID document** lists their current PDS. Moving servers means copying the repository to a new PDS and updating the DID document; followers follow the DID, not the server, so nothing breaks. **Feed generators** are independent services that consume the firehose, pick posts by their own logic, and return a list of post IDs; the AppView fills in the post content.

## Potential Deep Dives

### 1) How do we build home timelines from the firehose?

:::solution bad Query each followed user's PDS on read
#### Approach

When a user opens the app, fetch recent posts from every followed account's PDS.

#### Challenges

Hundreds of requests to independently run servers per timeline load — slow and unreliable.
:::

:::solution good Fan-out on read in the AppView
#### Approach

The AppView indexes all posts by author; a timeline query merges recent posts from followed authors.

#### Challenges

Users following thousands of accounts make each read expensive.
:::

:::solution great Hybrid fan-out
#### Approach

For most authors, **fan out on write** inside the AppView: when a post arrives from the firehose, insert its ID into each follower's timeline cache. For accounts with huge follower counts, skip fan-out and **merge their recent posts at read time**. Timelines are lists of post IDs in a wide-column store (ScyllaDB/Cassandra), hydrated from a post cache.

#### Challenges

Same trade-offs as Twitter, plus handling firehose bursts and replays after outages.
:::

### 2) Why separate PDS, Relay and AppView?

Each scales differently. PDSes are numerous and small (many people can run one). Relays need high bandwidth but simple logic. AppViews need large indexes and heavy read capacity. Separating them lets independent operators run each piece, while a big AppView still gives users a fast experience. Because data is signed and public, a competing AppView can be built from the same firehose — users aren't locked in.

:::tip
Make the trade-off explicit: decentralisation adds hops and duplicate storage, but buys data portability and the freedom to switch apps, feeds and moderation providers.
:::

### 3) How does moderation work without a single owner?

Moderation is layered: PDS operators can take down content they host, AppViews can choose not to show it, and independent **labelling services** publish labels ("spam", "graphic") that users subscribe to and clients apply. Users pick which labellers and feeds they trust.

### Final Design

```diagram Final Design
node client 0,1 box "Apps"
node pds 1.5,-0.3 box "PDS servers"
node did 0,-0.3 circle "DID Directory"
node relay 3,-0.3 box "Relay|firehose"
node appview 3,1 box "AppView|graph · timelines"
node store 4.5,1 circle "Timeline Store"
node feedgen 4.5,-0.3 box "Feed Generators"
node labeler 3,2.3 box "Labelers"
edge client -> pds "writes"
edge pds <-> did
edge pds -> relay
edge relay -> appview
edge relay -> feedgen
edge client <-> appview "reads"
edge appview <-> store
edge feedgen -> appview "skeletons"
edge labeler -> appview "labels"
```

```quiz
[
  {
    "question": "Where does a Bluesky user's data live?",
    "options": ["Only in the AppView", "In a signed repository on their Personal Data Server", "On the client only", "In the relay"],
    "answer": 1,
    "explanation": "The PDS stores the user's records; others index copies."
  },
  {
    "question": "What does the relay provide?",
    "options": ["Timelines", "A firehose of commits from all repositories", "User login", "Image storage"],
    "answer": 1,
    "explanation": "Relays aggregate every PDS into one stream anyone can consume."
  },
  {
    "question": "How can a user change servers without losing followers?",
    "options": ["They can't", "Followers follow a permanent DID that is updated to point to the new PDS", "By emailing followers", "By re-posting everything"],
    "answer": 1,
    "explanation": "Identity is decoupled from hosting."
  },
  {
    "question": "Why can anyone verify a post's authorship?",
    "options": ["Relays vouch for it", "Repository commits are signed with the user's key", "Posts include a password", "AppViews check IDs"],
    "answer": 1,
    "explanation": "Signatures make the data trustworthy no matter who serves it."
  }
]
```
