---
title: User Feedback System
seoTitle: Design a User Feedback System
description: Design a user feedback system — in-app feedback and surveys, attachments and context capture, spam filtering, automatic categorisation and deduplication, routing to teams, and closing the loop with users.
tags: Scaling Writes
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 💡 What is a User Feedback System?
A user feedback system collects what users say about a product — bug reports, feature requests, ratings, survey answers — from inside the app, the website and support channels. It captures useful context automatically (app version, device, screen), sorts and groups feedback so teams can see trends, routes it to the right owners, and lets users hear back when something is fixed.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to submit feedback (text, optional screenshot, rating) from any app or the website.
2. The system should capture context automatically: user, app version, device, page, recent errors.
3. Feedback should be categorised (bug, feature request, praise), tagged by product area, and grouped with similar items.
4. Product teams should see dashboards of trends, search feedback, and link items to tickets.
5. Users should be notified when their reported issue is resolved.

**Below the line (out of scope):**

- Live chat support.
- App store review scraping (mentioned briefly).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Submitting feedback never slows the app and works on poor connections (queued and retried).
2. No feedback lost once the user hits submit.
3. Privacy: screenshots and logs may contain personal data, so access is restricted and data is retained only as long as needed.
4. Scale to ~1M submissions per day, with spikes after releases or outages.

**Below the line (out of scope):**

- Real-time dashboards (minutes of delay is fine).

```sketch Feedback Requirements
Functional
- submit text, screenshot, rating
- auto-capture context
- categorise, tag, group
- dashboards, search, tickets
- notify on resolution

Non-functional
- never slows the app
- nothing lost
- privacy for screenshots + logs
- 1M / day, release spikes
```

## The Set Up

### Defining the Core Entities

1. **Feedback item**: ID, user, channel, text, rating, attachments, context, status.
2. **Attachment**: screenshot or log file in object storage.
3. **Cluster**: a group of similar items (e.g. "checkout button unresponsive on Android 15").
4. **Ticket link**: cluster or item linked to an issue in the team's tracker.

### API or System Interface

```
POST /feedback { clientId, text, rating?, category?, context } -> { feedbackId, uploadUrls[] }
PUT  {uploadUrl}                                  (screenshot direct to storage)
GET  /feedback?area=&category=&from=&q=           (internal dashboard)
POST /clusters/:id/link { ticketUrl }
(event) ticket resolved -> notify linked users
```

## High-Level Design

### 1) Submitting feedback

The in-app SDK collects the text and context, generates a **client ID** (for idempotent retries), and stores the submission locally until the server acknowledges it. The **Feedback API** writes the item and returns **pre-signed URLs** for attachments, which the client uploads directly to object storage.

### 2) Processing

Each new item is published to a queue. A **processing pipeline** filters spam, redacts obvious personal data in text (emails, card numbers), classifies the category and product area with a text classifier, computes an **embedding**, and assigns the item to an existing **cluster** if it's similar enough, or starts a new one.

```diagram Processing
node app 0,1 box "App SDK|offline queue"
node api 1.6,1 box "Feedback API"
node s3 1.6,-0.3 circle "Attachments"
node q 3.2,1 box "Queue"
node proc 4.8,1 box "Processing|spam · classify · cluster"
node db 4.8,2.3 circle "Feedback Store"
edge app -> api "submit"
edge app -> s3 "upload"
edge api -> q
edge q -> proc
edge proc -> db
```

### 3) Dashboards and routing

Items are indexed for search and aggregated into trends (volume per cluster per day, rating by version). Rules route clusters to owning teams; a sudden spike in a cluster after a release raises an alert.

### 4) Closing the loop

When a team links a cluster to a ticket and the ticket is resolved, a webhook from the tracker triggers notifications to everyone who reported that issue ("Thanks — this is fixed in version 5.2").

## Potential Deep Dives

### 1) How do we make feedback useful at scale?

:::solution bad A shared inbox
#### Approach

Send all feedback to an inbox that people read.

#### Challenges

A million items a day can't be read; duplicates hide the real volume of each issue.
:::

:::solution good Manual tagging and keyword rules
#### Approach

Triage agents tag items, with keyword rules for common topics.

#### Challenges

Slow and inconsistent, and keywords miss paraphrases.
:::

:::solution great Classification + embedding clusters + trend detection
#### Approach

Classify each item automatically, and **cluster** by embedding similarity so 3,000 different phrasings of the same bug become one cluster with a count. Show clusters ranked by volume and growth, broken down by version and device. Alert owners when a cluster spikes, especially after a release. Humans review and merge clusters, which also trains the classifier.

#### Challenges

Clusters drift over time; periodically recluster and let humans pin canonical clusters.
:::

### 2) How do we handle sensitive attachments?

Screenshots and logs may include personal data. Attachments are stored encrypted with short-lived signed URLs for viewing, accessible only to roles that need them, and deleted after a retention period. The SDK can **blur sensitive fields** in screenshots before upload (marked input fields), and text is scanned to redact identifiers before indexing.

:::tip
Mention that context capture should be consented and documented: "include logs" is a toggle the user can see.
:::

### 3) How do we cope with spikes?

After a bad release, submissions can jump 50×. The API is stateless and only writes a small record plus queue message, so it scales easily; heavy processing (classification, embeddings) runs asynchronously from the queue and can lag a few minutes without losing anything. Duplicate submissions from retries are dropped by client ID.

### Final Design

```diagram Final Design
node app 0,1 box "Apps + Web"
node api 1.5,1 box "Feedback API"
node s3 1.5,-0.3 circle "Attachments|encrypted"
node q 3,1 box "Queue"
node proc 4.5,1 box "Processing Pipeline"
node db 4.5,-0.3 circle "Feedback Store"
node idx 6,-0.3 circle "Search + Trends"
node dash 6,1 box "Team Dashboards"
node tracker 6,2.3 box "Issue Tracker"
node notify 4.5,2.3 box "Notify Users"
edge app -> api
edge app -> s3
edge api -> q
edge q -> proc
edge proc -> db
edge db -> idx
edge idx -> dash
edge dash <-> tracker "link"
edge tracker -> notify "resolved"
```

```quiz
[
  {
    "question": "Why upload screenshots directly to object storage with pre-signed URLs?",
    "options": ["It's more secure by default", "It keeps large uploads off the API servers", "Screenshots are small", "Browsers require it"],
    "answer": 1,
    "explanation": "The API only handles small records."
  },
  {
    "question": "How do we avoid losing feedback on a bad connection?",
    "options": ["Ask the user to retry", "The SDK queues it locally and retries with a client ID for deduplication", "Send it by email", "Drop it"],
    "answer": 1,
    "explanation": "Idempotent retries make delivery reliable."
  },
  {
    "question": "What does clustering feedback by embeddings achieve?",
    "options": ["Encryption", "Groups many phrasings of the same issue so its real volume is visible", "Faster uploads", "Smaller storage"],
    "answer": 1,
    "explanation": "Teams see one issue with a count instead of thousands of items."
  },
  {
    "question": "How is the loop closed with users?",
    "options": ["It isn't", "When a linked ticket is resolved, reporters are notified", "Users check a website", "Monthly newsletters"],
    "answer": 1,
    "explanation": "Linking clusters to tickets enables targeted notifications."
  }
]
```
