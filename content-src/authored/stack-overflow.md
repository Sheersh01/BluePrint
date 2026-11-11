---
title: Stack Overflow
seoTitle: Design a Q&A Platform or Forum like Stack Overflow or Quora
description: Design a question-and-answer forum — posting questions and answers, voting and reputation, ranking answers, tags and search, and serving a read-heavy workload.
tags: Scaling Reads, Dealing with Contention
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 💬 What is a Q&A Platform?
A question-and-answer platform (Stack Overflow, Quora, or any forum with threads and replies) lets users post questions, answer them, and vote on both. Votes decide which answers rise to the top and earn authors **reputation**, which in turn unlocks moderation privileges. Most traffic is anonymous visitors arriving from search engines to read an existing question.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to post questions with tags, and answers to questions.
2. Users should be able to upvote and downvote questions and answers, and the asker can accept an answer.
3. Users should view a question page with answers ranked by votes.
4. Users should be able to search questions and browse by tag.
5. Users earn reputation from votes on their posts.

**Below the line (out of scope):**

- Comments, edits and revision history (discussed briefly).
- Badges, bounties and chat.
- Spam and moderation queues.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Read-heavy: ~100:1 reads to writes; question pages should load in < 200 ms globally.
2. Vote counts and reputation can be eventually consistent (seconds).
3. A user can vote only once per post.
4. Scale to ~50M questions and ~1B page views per month.

**Below the line (out of scope):**

- Real-time updates to an open question page (nice to have).

```sketch Q&A Requirements
Functional
- post questions + answers
- vote, accept answer
- question page ranked by votes
- search + tags
- reputation

Non-functional
- 100:1 reads, < 200ms pages
- counts eventually consistent
- one vote per user per post
- 1B views / month
```

## The Set Up

### Defining the Core Entities

1. **User**: profile and reputation.
2. **Question**: title, body, tags, author, score, answer count, accepted answer.
3. **Answer**: question, body, author, score.
4. **Vote**: user, post, direction (+1/-1).
5. **Tag**: name, question count.

### API or System Interface

```
POST /questions { title, body, tags[] }
POST /questions/:id/answers { body }
GET  /questions/:id -> { question, answers[] (sorted) }
POST /posts/:id/votes { direction: up|down|none }
POST /questions/:id/accept { answerId }
GET  /search?q=&tags=&sort=relevance|votes|newest
GET  /tags/:tag/questions?sort=&cursor=
```

## High-Level Design

### 1) Posting questions and answers

The **Post Service** writes questions and answers to a relational database (Postgres or SQL Server). Posts are small text documents, and the data is highly relational (questions → answers → votes → users), which suits SQL well.

### 2) Voting and accepting

A vote is a row in `votes` with a unique key `(userId, postId)`, so each user votes once; changing a vote updates that row. Each vote also adjusts the post's `score` and enqueues a **reputation event** for the author.

### 3) Viewing a question page

The page needs the question, its answers sorted by accepted-first then score, and author names. That's one indexed query on `answers(questionId, score)`. Since most visitors are anonymous, the **rendered page is cached** at the CDN and in Redis for a short time and invalidated when the question changes.

```diagram Question page
node visitor 0,1 box "Visitor"
node cdn 1.5,1 box "CDN|anonymous pages"
node web 3,1 box "Web / Post Service"
node cache 3,-0.3 circle "Page Cache"
node db 4.5,1 circle "SQL DB"
edge visitor <-> cdn
edge cdn <-> web "miss"
edge web <-> cache
edge web <-> db
```

### 4) Search and tags

Posts are indexed into **Elasticsearch** via CDC, with title, body, tags and score as fields. Searches combine text relevance with score and recency. Tag pages are served from an index on `(tag, createdAt)` / `(tag, score)`.

## Potential Deep Dives

### 1) How do we serve a read-heavy workload cheaply?

:::solution bad Query the database for every page view
#### Approach

Render each question page from the database on every request.

#### Challenges

A popular question linked from a search engine gets thousands of identical queries a second.
:::

:::solution good Cache data in Redis
#### Approach

Cache question and answer data in Redis, with short TTLs, and render per request.

#### Challenges

Still renders every page and serves everything from origin servers.
:::

:::solution great Edge-cached pages for anonymous users
#### Approach

The vast majority of views are logged-out readers who all see the same page. Serve them **fully rendered HTML from the CDN** with a TTL of a minute or so, purged when the question changes. Logged-in users get the same cached page plus a small personalised fragment (their vote state, reputation) loaded separately. Database load becomes proportional to writes, not reads.

#### Challenges

Vote counts on cached pages can be a minute stale — acceptable for this product.
:::

### 2) How do we keep vote counts and reputation correct?

Store votes as rows (source of truth) and **denormalised counters** (`score` on posts, `reputation` on users) for fast reads. The vote insert and score change happen in one transaction. Reputation is updated **asynchronously** from vote events, since a popular answer may receive many votes and the author's row would otherwise be a hot spot. A nightly job recomputes reputation from the votes table to correct any drift.

:::tip
Mention vote fraud: detect voting rings (users who repeatedly upvote each other) in a batch job and reverse those votes and their reputation.
:::

### 3) How do we rank answers?

Default order is **accepted answer first, then score, then age**. Score alone favours early answers, so offer "newest" and "trending" (recent votes weighted more). On Quora-like feeds, a ranking model also considers the answerer's expertise on the topic and reader engagement.

### Final Design

```diagram Final Design
node user 0,1 box "Users"
node cdn 1.4,1 box "CDN"
node web 2.8,1 box "Web + Post Service"
node redis 2.8,-0.3 circle "Redis"
node db 4.2,1 circle "SQL Primary|+ replicas"
node bus 4.2,2.4 box "Events"
node rep 5.6,2.4 box "Reputation Worker"
node es 5.6,-0.3 circle "Search Index"
edge user <-> cdn
edge cdn <-> web
edge web <-> redis
edge web <-> db
edge db -> bus "CDC"
edge bus -> rep
edge db -> es "CDC"
edge web <-> es "search"
```

```quiz
[
  {
    "question": "How do we enforce one vote per user per post?",
    "options": ["Client-side checks", "A unique key on (userId, postId) in the votes table", "Rate limiting", "Cookies"],
    "answer": 1,
    "explanation": "The database rejects duplicates; changing a vote updates the row."
  },
  {
    "question": "Why cache fully rendered pages at the CDN?",
    "options": ["Search engines require it", "Most views are anonymous readers who all see the same page", "It's more secure", "It reduces writes"],
    "answer": 1,
    "explanation": "Edge caching makes database load depend on writes, not reads."
  },
  {
    "question": "Why update reputation asynchronously?",
    "options": ["Reputation doesn't matter", "To avoid a hot row when a popular answer gets many votes", "It's required by SQL", "To save storage"],
    "answer": 1,
    "explanation": "Events batch updates; a nightly recompute corrects drift."
  },
  {
    "question": "What's the default answer order?",
    "options": ["Alphabetical", "Accepted first, then by score", "Random", "Newest first only"],
    "answer": 1,
    "explanation": "Other sorts are offered because score favours early answers."
  }
]
```
