---
title: Interview Platform
seoTitle: Design a System for Interviewing Candidates
description: Design a technical interview platform — scheduling interviews across interviewers' calendars, live video with a collaborative code editor, sandboxed code execution, structured feedback, and hiring decisions.
tags: Real-time Updates, Dealing with Contention
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🧑‍💻 What is an Interview Platform?
An interview platform (CoderPad, HackerRank Interview, or a company's internal hiring tool) handles the whole interview loop: scheduling candidates with available interviewers, running the live session with video and a shared code editor where code can be executed, collecting structured feedback from each interviewer, and supporting a final hiring decision.
:::

### Functional Requirements

**Core Requirements**

1. Recruiters should schedule interviews by finding slots where the candidate and qualified interviewers are free.
2. Candidates and interviewers should join a live session with video and a collaborative code editor.
3. Participants should be able to run code in many languages and see output.
4. Interviewers should submit structured feedback (scores per competency plus notes).
5. The hiring committee should see all feedback for a candidate and record a decision.

**Below the line (out of scope):**

- Applicant tracking (job posts, resumes).
- Take-home assessments and auto-grading (mentioned briefly).
- Offer management.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Editor changes visible to the other participant in < 200 ms; no lost edits.
2. Code execution returns in a few seconds and is fully sandboxed (candidates run arbitrary code).
3. No double-booked interviewers.
4. Candidate data and feedback are confidential with access control and audit logs.
5. Handle ~10k concurrent interviews at peak hiring season.

**Below the line (out of scope):**

- Recording and transcription (mentioned briefly).

```sketch Interview Platform Requirements
Functional
- schedule across calendars
- live video + shared editor
- run code
- structured feedback
- hiring decision

Non-functional
- edits < 200ms, none lost
- sandboxed execution in seconds
- no double booking
- confidential + audited
- 10k concurrent interviews
```

## The Set Up

### Defining the Core Entities

1. **Candidate**: profile, application, availability.
2. **Interviewer**: skills/qualifications, calendar, load limits.
3. **Interview**: candidate, interviewer(s), time, type (coding, system design), room ID.
4. **Pad**: the shared document (code, language), with history.
5. **Feedback**: interview, interviewer, scores, notes, recommendation, submitted at.

### API or System Interface

```
GET  /scheduling/slots?candidate=&type=coding&from=&to= -> candidate-compatible slots with interviewers
POST /interviews { candidateId, interviewerIds, start, type }
WS   /pads/:id            -> collaborative edit operations, cursors
POST /pads/:id/run { language, code, stdin } -> { stdout, stderr, exitCode, timeMs }
POST /interviews/:id/feedback { scores, notes, recommendation }
```

## High-Level Design

### 1) Scheduling

The **Scheduling Service** syncs interviewers' free/busy data from their calendars (Google/Microsoft APIs with webhooks for changes). For a request, it intersects the candidate's availability with qualified interviewers' free time, respecting load limits (e.g. at most 4 interviews a week). Booking reserves the slot and creates calendar events.

### 2) The live session

Participants open the interview room: video runs over **WebRTC** (an SFU for 3+ participants), and the **pad** syncs over a **WebSocket** to a collaboration server that merges edits.

```diagram Live session
node cand 0,0 box "Candidate"
node intv 0,2 box "Interviewer"
node collab 1.6,1 box "Collaboration Server|OT / CRDT"
node pads 3.2,1 circle "Pad Store"
node sfu 1.6,-0.4 box "Video SFU"
node exec 1.6,2.4 box "Execution Service"
edge cand <-> collab "edits"
edge intv <-> collab "edits"
edge collab -> pads "snapshots"
edge cand <-> sfu
edge intv <-> exec "run code"
```

### 3) Running code

"Run" sends the code to the **Execution Service**, which queues it to a pool of **sandboxed workers**. Each run happens in a fresh, isolated container or microVM with CPU, memory and time limits and no network, and the output is broadcast to everyone in the pad.

### 4) Feedback and decisions

After the interview, each interviewer submits feedback through a form with competency scores. Feedback is **hidden from other interviewers until they submit their own**, to avoid bias. The hiring committee view aggregates all feedback for the candidate, and decisions are recorded with an audit trail.

## Potential Deep Dives

### 1) How do we keep the shared editor consistent?

:::solution bad Last write wins on the whole document
#### Approach

Each client sends the full document; the server keeps the latest.

#### Challenges

Simultaneous typing overwrites the other person's changes.
:::

:::solution good Operational transformation through a server
#### Approach

Clients send operations (insert/delete at positions); the collaboration server orders them per pad and **transforms** concurrent operations so both sides converge.

#### Challenges

Each pad must be served by a single server process holding its state; failover needs a recent snapshot plus operation log.
:::

:::solution great OT/CRDT with pad affinity and an operation log
#### Approach

Route each pad to one collaboration server (consistent hashing on pad ID) that applies operations in order, persists the **operation log** and periodic snapshots, and broadcasts. If that server dies, another loads the snapshot and replays the log. Clients buffer unacknowledged operations and resend them after reconnecting, so no keystrokes are lost. A **CRDT** editor (like Yjs) is an alternative that tolerates offline edits without a central transform step.

#### Challenges

The log also gives a **playback** feature: reviewers can replay how the candidate's code evolved.
:::

### 2) How do we run untrusted code safely?

Candidates can submit anything, including fork bombs or attempts to escape. Run each execution in a **fresh microVM** (Firecracker) or gVisor-sandboxed container with no network, a read-only base image, strict CPU/memory/time limits and output size caps. Keep a **warm pool** of sandboxes per language so a run starts in milliseconds rather than seconds, and throw each sandbox away after use.

:::tip
Mention per-language images with common libraries preinstalled, and limiting runs per pad per minute so one pad can't monopolise workers.
:::

### 3) How do we avoid double-booking interviewers?

Calendars change constantly outside our system, so free/busy data can be stale. Booking takes a **short hold** on each interviewer's slot in our database (conditional insert on `(interviewerId, start)`), then creates calendar events; if a calendar API reports a conflict, the booking is rolled back and another interviewer is offered. Interviewers can decline, which triggers automatic rescheduling.

### Final Design

```diagram Final Design
node users 0,1 box "Participants"
node api 1.5,1 box "API|auth + audit"
node sched 3,-0.3 box "Scheduling Service"
node cal 4.5,-0.3 box "Calendar APIs"
node collab 3,1 box "Collaboration Servers"
node pads 4.5,1 circle "Pad Store|snapshots + ops"
node exec 3,2.3 box "Execution Service"
node sandbox 4.5,2.3 box "Sandbox Pool|microVMs"
node fb 1.5,2.3 circle "Feedback DB"
edge users <-> api
edge api <-> sched
edge sched <-> cal
edge api <-> collab "WebSocket"
edge collab <-> pads
edge collab -> exec
edge exec -> sandbox
edge api <-> fb
```

```quiz
[
  {
    "question": "Why use operational transformation or CRDTs for the code pad?",
    "options": ["They compress code", "So simultaneous edits from both people merge without overwriting each other", "To run code faster", "For syntax highlighting"],
    "answer": 1,
    "explanation": "Concurrent operations converge to the same document."
  },
  {
    "question": "How should candidate code be executed?",
    "options": ["On the API server", "In fresh, isolated sandboxes with no network and strict limits", "In the browser only", "On the interviewer's laptop"],
    "answer": 1,
    "explanation": "Arbitrary code must never reach shared infrastructure."
  },
  {
    "question": "Why hide other interviewers' feedback until you submit yours?",
    "options": ["Storage limits", "To avoid anchoring bias", "It's faster", "Legal requirement everywhere"],
    "answer": 1,
    "explanation": "Independent assessments give a fairer signal."
  },
  {
    "question": "What keeps code runs fast to start?",
    "options": ["Bigger machines", "A warm pool of pre-created sandboxes per language", "Skipping isolation", "Caching outputs"],
    "answer": 1,
    "explanation": "Sandboxes are ready before the user clicks Run."
  }
]
```
