---
title: Video Conferencing
seoTitle: Design a Video Conferencing System Like Zoom
description: Design video calls — signaling, WebRTC media, peer-to-peer vs. SFU architectures, simulcast and adaptive bitrate, and scaling large meetings.
tags: Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
---

## Understanding the Problem

:::definition 🎥 What is Video Conferencing?
Video conferencing systems like Zoom and Google Meet let groups of people join a meeting and exchange live audio, video and screen shares with sub-second delay.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create a meeting and join it via a link.
2. Participants should send and receive live audio and video.
3. Participants should be able to share their screen.
4. Meetings should support up to ~100 participants with video and larger audiences in view-only mode.

**Below the line (out of scope):**

- Recording and transcription.
- Chat and reactions.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Very low latency: < 200ms mouth-to-ear for natural conversation.
2. Adapt to varying network quality — degrade video before audio.
3. Highly available; a server failure shouldn't drop entire meetings.
4. Scale to millions of concurrent participants globally.

**Below the line (out of scope):**

- End-to-end encryption details.

```sketch Video Conferencing Requirements
Functional
- create + join meetings
- live audio / video
- screen share
- ~100 video participants

Non-functional
- < 200ms latency
- adapt to bad networks
- survive server failures
- millions concurrent
```

## The Set Up

### Defining the Core Entities

1. **Meeting**: ID, host, settings, assigned media server(s).
2. **Participant**: user in a meeting with connection state.
3. **Media stream / track**: audio, video or screen track published by a participant.

### API or System Interface

```
POST /meetings -> { meetingId, joinUrl }
POST /meetings/:id/join -> { mediaServer, token, iceServers }

// Signaling over WebSocket
-> offer / answer (SDP), ICE candidates, mute/unmute
// Media over WebRTC (SRTP over UDP)
```

## High-Level Design

### 1) Create and join meetings

A **Meeting Service** stores meeting metadata and, on join, assigns the meeting to a **media server** in a region near most participants, returning connection details and a short-lived token.

### 2) Send and receive audio and video

A **signaling service** (WebSocket) lets clients exchange session descriptions and network candidates to set up **WebRTC** connections. Media flows over UDP for low latency; STUN/TURN servers help clients behind NATs connect.

```diagram SFU architecture
node a 0,0.3 box "Participant A"
node b 0,1.7 box "Participant B"
node sig 1.6,1 box "Signaling Service|(WebSocket)"
node sfu 3.2,1 box "SFU Media Server|- forward streams|- pick quality layer"
node c 4.8,0.3 box "Participant C"
node d 4.8,1.7 box "Participant D"
edge a <-> sig
edge b <-> sig
edge a <-> sfu "send 1, receive N"
edge b <-> sfu
edge sfu <-> c
edge sfu <-> d
```

### 3) Share screens

A screen share is just another video track, typically encoded for sharp text at a low frame rate, and given priority in bandwidth allocation.

### 4) Support larger meetings

Media servers forward streams instead of mixing them; for very large meetings, cascade multiple servers and switch view-only attendees to a broadcast path.

## Potential Deep Dives

### 1) Peer-to-peer, MCU or SFU?

:::solution bad Full-mesh peer-to-peer
#### Approach

Every participant sends their stream directly to every other participant.

#### Challenges

Upload bandwidth and CPU grow with N−1 encodes/sends per person — it falls apart beyond 3-4 people.
:::

:::solution good MCU (mixing server)
#### Approach

A server decodes all streams, composites them into one video, re-encodes and sends a single stream to each participant.

#### Challenges

Very expensive server CPU, added latency from transcoding, and inflexible layouts.
:::

:::solution great SFU (selective forwarding unit) with simulcast
#### Approach

Each participant uploads one stream (in several quality layers via **simulcast**); the SFU forwards packets without decoding, choosing per receiver which layer to send based on their bandwidth and layout (high quality for the active speaker, thumbnails for others). Server cost is mostly bandwidth, and latency stays low.

#### Challenges

Downstream bandwidth grows with visible participants, so clients only subscribe to the streams they display.
:::

### 2) How do we handle poor networks?

Use congestion control feedback to estimate available bandwidth per receiver; the SFU drops to lower simulcast layers or pauses video for that receiver, while audio always gets priority. Forward error correction and packet retransmission handle loss; jitter buffers smooth timing. If UDP is blocked, fall back to TURN over TCP/TLS.

### 3) How do we scale and stay available?

Place media servers in many regions and route each meeting to one near its participants. For globally spread meetings, **cascade** SFUs across regions — each participant connects locally and SFUs exchange streams over the backbone. Monitor server health; on failure, clients rejoin a new SFU through signaling within seconds.

### Final Design

```diagram Final Design
node clients 0,1.2 box "Clients|WebRTC"
node meet 1.5,0 box "Meeting Service|- assign region"
node sig 1.5,1.2 box "Signaling|(WebSocket)"
node turn 1.5,2.4 circle "STUN / TURN"
node sfu1 3,0.4 box "SFU (Region A)"
node sfu2 3,1.8 box "SFU (Region B)"
node db 1.5,-1.1 circle "Meetings DB"
edge clients <-> meet
edge clients <-> sig
edge clients <-> turn
edge clients <-> sfu1 "media"
edge sfu1 <-> sfu2 "cascade"
edge meet <-> db
```

```quiz
[
  {
    "question": "Why does full-mesh P2P fail for larger meetings?",
    "options": ["Browsers ban it", "Each participant must upload a separate stream to every other participant", "It has high server cost", "It requires TURN"],
    "answer": 1,
    "explanation": "Upload bandwidth grows linearly with participants."
  },
  {
    "question": "What does an SFU do?",
    "options": ["Mixes video into one stream", "Forwards streams without decoding, choosing quality per receiver", "Records meetings", "Handles login"],
    "answer": 1,
    "explanation": "Forwarding keeps latency and server CPU low."
  },
  {
    "question": "What is simulcast?",
    "options": ["Broadcasting to TV", "Sending the same video at several quality layers so receivers can get the one they can handle", "Recording", "Audio only"],
    "answer": 1,
    "explanation": "The SFU picks a layer per receiver."
  },
  {
    "question": "When network quality drops, what should be preserved first?",
    "options": ["Video resolution", "Audio", "Screen share frame rate", "Thumbnails"],
    "answer": 1,
    "explanation": "Conversation survives without video, not without audio."
  }
]
```
