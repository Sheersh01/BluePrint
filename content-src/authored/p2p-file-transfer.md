---
title: P2P File Transfer
seoTitle: Design a Peer-to-Peer File Distribution System Like BitTorrent
description: Design peer-to-peer file distribution — splitting files into verified pieces, peer discovery with trackers and DHTs, piece selection strategies, and incentives to upload.
tags: Handling Large Blobs
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: Google, Atlassian, Twitch | 0
---

## Understanding the Problem

:::definition 🔁 What is P2P File Transfer?
Peer-to-peer distribution (like BitTorrent) lets many machines download a large file from each other instead of all pulling from one server. Every downloader also uploads the pieces it already has, so capacity grows with demand. Companies use the same idea internally to ship builds and container images to thousands of servers.
:::

### Functional Requirements

**Core Requirements**

1. A publisher should be able to share a file so others can download it.
2. Peers should discover other peers that have the file.
3. Peers should download pieces from many peers in parallel and verify each piece.
4. Peers should upload pieces they have to others while downloading (and after).

**Below the line (out of scope):**

- Search for content.
- Anonymity and encryption of traffic.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Scalability: distributing a 10GB file to 10,000 machines shouldn't overload the original source.
2. Integrity: corrupted or malicious data is detected and discarded.
3. Resilience: peers come and go constantly; downloads continue.
4. Efficient: aggregate bandwidth across peers is well used.

**Below the line (out of scope):**

- NAT traversal details.

```sketch P2P Requirements
Functional
- publish a file
- discover peers
- parallel verified pieces
- upload while downloading

Non-functional
- source never the bottleneck
- detect corrupt pieces
- tolerate churn
- use aggregate bandwidth
```

## The Set Up

### Defining the Core Entities

1. **Metadata file (torrent)**: file name, size, piece size, and the hash of every piece; identified by an info-hash.
2. **Piece**: a fixed-size chunk (e.g. 1-4MB) of the file.
3. **Peer**: a participant with a bitfield of pieces it has.
4. **Tracker / DHT**: services that answer "which peers have this info-hash?".

### API or System Interface

```
// Tracker
GET /announce?infoHash&peerId&port&left&event=started -> { peers: [ip:port, ...], interval }

// Peer wire protocol (TCP)
handshake(infoHash, peerId)
bitfield(pieces) / have(index)
request(index, offset, length) -> piece(index, offset, data)
```

## High-Level Design

### 1) Share a file

The publisher splits the file into pieces, hashes each one (SHA-256), and creates a metadata file listing the piece hashes. The info-hash (hash of the metadata) identifies the file everywhere. The publisher starts as the first **seed**.

### 2) Discover peers

Peers **announce** to a tracker with the info-hash and receive a list of other peers. For decentralisation, a **DHT** (Kademlia) maps info-hashes to peers without a central server; peers also exchange peer lists with each other (peer exchange).

```diagram Swarm
node tracker 2,0 box "Tracker / DHT"
node seed 0,1.4 circle "Seed|(all pieces)"
node p1 2,1.4 circle "Peer A"
node p2 4,1.4 circle "Peer B"
node p3 2,2.8 circle "Peer C"
edge p1 <-> tracker "announce"
edge p2 <-> tracker
edge seed <-> p1 "pieces"
edge p1 <-> p2
edge p1 <-> p3
edge p2 <-> p3
edge seed <-> p3
```

### 3) Download pieces in parallel and verify

A peer connects to dozens of others, learns which pieces each has (bitfields), and requests different pieces from different peers simultaneously. Every received piece is hashed and compared with the metadata; mismatches are discarded and the sender is penalised or banned.

### 4) Upload while downloading

As soon as a piece is verified, the peer announces `have(index)` and can serve it to others. This is what makes the swarm scale: every new downloader adds upload capacity.

## Potential Deep Dives

### 1) Which pieces should a peer request first?

:::solution bad Sequential order
#### Approach

Request piece 0, then 1, then 2...

#### Challenges

Everyone wants the same early pieces and nobody has unique pieces to trade; if the seed leaves, later pieces may vanish from the swarm.
:::

:::solution great Rarest-first with random first pieces and endgame mode
#### Approach

Request the pieces held by the fewest connected peers, which spreads every piece widely and keeps the swarm healthy. Start with a few random pieces so a new peer quickly has something to trade. Near completion, **endgame mode** requests the last few pieces from several peers at once and cancels duplicates.

#### Challenges

Streaming playback needs roughly sequential order — a hybrid with a sequential window is used for video.
:::

### 2) How do we encourage peers to upload?

**Tit-for-tat choking**: each peer uploads to the few peers that upload to it fastest ("unchoked"), and periodically **optimistically unchokes** a random peer to discover better partners and give newcomers a start. Free-riders who never upload get slow downloads. In a company-internal deployment, incentives aren't needed — every machine is configured to seed for a period.

### 3) How do we keep the source from becoming a bottleneck?

The original seed only needs to upload each piece roughly once; peers then share among themselves. Use rarest-first so pieces from the seed are spread to different peers, and add a few dedicated **super-seeds** (or a web seed/CDN fallback) for reliability when the swarm is small.

### Final Design

```diagram Final Design
node pub 0,0.3 box "Publisher|- pieces + hashes"
node meta 1.5,0.3 circle "Metadata|(info-hash)"
node tracker 3,0.3 box "Trackers + DHT"
node seed 0,1.8 circle "Seeds"
node peers 1.5,1.8 box "Peers|- rarest-first|- verify hashes|- tit-for-tat"
node webseed 3,1.8 circle "Web seed|(CDN fallback)"
edge pub -> meta
edge peers <-> tracker "announce"
edge pub -> seed
edge seed <-> peers
edge peers <-> webseed
edge peers <-> meta
```

```quiz
[
  {
    "question": "Why does P2P distribution scale with demand?",
    "options": ["Servers get bigger", "Every downloader also uploads pieces, adding capacity", "Files are smaller", "Trackers cache files"],
    "answer": 1,
    "explanation": "More peers means more upload bandwidth in the swarm."
  },
  {
    "question": "How are corrupted or malicious pieces detected?",
    "options": ["Peers vote", "Each piece is hashed and compared with the hash in the metadata", "TCP checksums only", "They can't be"],
    "answer": 1,
    "explanation": "Per-piece hashes make verification local and immediate."
  },
  {
    "question": "Why use rarest-first piece selection?",
    "options": ["It's alphabetical", "It spreads scarce pieces widely, keeping the swarm healthy", "It's fastest for video", "Trackers require it"],
    "answer": 1,
    "explanation": "Rare pieces are most at risk of disappearing."
  },
  {
    "question": "What does a DHT replace?",
    "options": ["Piece hashing", "The central tracker for peer discovery", "Uploading", "TCP"],
    "answer": 1,
    "explanation": "A distributed hash table maps info-hashes to peers without a central server."
  }
]
```
