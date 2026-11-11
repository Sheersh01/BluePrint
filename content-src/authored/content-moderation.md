---
title: Content Moderation
seoTitle: Design a Content Moderation System
description: Design a content moderation system — automated classifiers and hash matching on uploads, risk-based routing, human review queues, user reports, appeals and policy versioning.
tags: Managing Long Running Tasks, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🚦 What is a Content Moderation System?
A content moderation system checks what users post — text, images, video — against a platform's policies, and removes, restricts or labels content that breaks them. At scale it's a pipeline of automated detection (hash matching and ML classifiers) feeding human reviewers, who handle the uncertain cases and appeals.
:::

### Functional Requirements

**Core Requirements**

1. Every new post (text, image, video) should be checked automatically against policies.
2. Clearly violating content should be blocked or removed automatically; uncertain content should go to human review.
3. Users should be able to report content, which feeds the same pipeline.
4. Reviewers should work through prioritised queues and record decisions with a policy reason.
5. Authors should be notified and able to appeal.

**Below the line (out of scope):**

- Training the ML models themselves.
- Account-level enforcement (strikes, bans), mentioned briefly.
- Legal requests from governments.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Low latency for synchronous checks: text in < 100 ms, images within a second, before content is visible.
2. Severe harms (known illegal imagery, terrorism) must be caught before publication with very high recall.
3. Handle ~500M new posts per day, with spikes during breaking news.
4. Every decision must be auditable: which model or reviewer, which policy version.
5. Protect reviewer wellbeing (limit exposure to graphic content).

**Below the line (out of scope):**

- Perfect accuracy; the aim is balancing harm against wrongly removing legitimate speech.

```sketch Moderation Requirements
Functional
- auto-check every post
- block clear violations, queue unsure
- user reports
- prioritised review queues
- notify + appeal

Non-functional
- text < 100ms, images < 1s
- severe harms caught pre-publish
- 500M posts / day
- auditable decisions
- reviewer wellbeing
```

## The Set Up

### Defining the Core Entities

1. **Content item**: post ID, type, author, media references, status (`pending`, `published`, `restricted`, `removed`).
2. **Signal**: a score or match from one detector (e.g. `nudity: 0.92`, `hash_match: known_csam`).
3. **Case**: content needing human review, with priority, reasons and assignment.
4. **Decision**: action, policy and version, actor (model or reviewer), timestamp.
5. **Appeal**: a request to re-review a decision.

### API or System Interface

```
(internal) POST /moderate { contentId, type, text?, mediaUrls[] } -> { action: allow|block|hold, caseId? }
POST /reports { contentId, reason }
GET  /review/queues/:queue/next -> case
POST /review/cases/:id/decision { action, policyId, notes }
POST /appeals { decisionId, message }
```

## High-Level Design

### 1) Automated checks on every post

When a post is created, the **Moderation Service** runs fast checks synchronously: **hash matching** of images and video against databases of known violating media (perceptual hashes like PhotoDNA, so resized copies still match), and lightweight text classifiers. Clear violations are blocked before publishing. Heavier checks (video models, multi-modal classifiers) run **asynchronously** right after publication.

```diagram Automated checks
node post 0,1 box "Post Service"
node mod 1.6,1 box "Moderation Service"
node hash 3.2,-0.3 circle "Hash DB"
node text 3.2,1 box "Text Classifiers"
node q 1.6,2.3 box "Async Queue"
node heavy 3.2,2.3 box "Image / Video Models"
edge post <-> mod "allow / block / hold"
edge mod <-> hash
edge mod <-> text
edge mod -> q
edge q -> heavy
```

### 2) Routing by confidence

A **decision engine** combines signals with policy thresholds: high-confidence violations are actioned automatically, low scores pass, and the middle band becomes a **review case**. Thresholds differ per policy — very low for child-safety, higher for spam — and are tuned against precision and recall.

### 3) User reports

Reports go into the same pipeline as a signal. Many reports on the same item are **deduplicated** into one case whose priority rises with report volume and the reporters' track record.

### 4) Human review and appeals

Reviewers pull cases from **queues** split by policy area and language. The tool shows the content, signals and relevant policy, and records the decision. Appeals create a new case routed to a different, often more senior, reviewer.

## Potential Deep Dives

### 1) How do we prioritise the review queue?

:::solution bad First in, first out
#### Approach

Review cases in arrival order.

#### Challenges

A viral harmful video waits behind thousands of low-risk spam reports while it spreads.
:::

:::solution good Priority by severity
#### Approach

Order cases by policy severity, so self-harm or violence cases come before spam.

#### Challenges

Ignores reach: a borderline post seen by millions matters more than one seen by five people.
:::

:::solution great Expected harm = severity × probability × reach
#### Approach

Compute a **priority score** from the policy's severity, the model's violation probability, and **predicted views** in the next hours (current velocity, author's follower count). Re-score cases as their reach grows. While a high-priority case waits, apply interim measures such as **limiting distribution** (no recommendations) so harm doesn't grow during review.

#### Challenges

Needs a reliable reach prediction and constant monitoring that low-reach cases still get reviewed eventually.
:::

### 2) How do we scale to 500M posts a day?

Keep synchronous checks cheap (hashes and small text models on CPU) and push expensive models onto an asynchronous, autoscaled **GPU inference** fleet fed by a queue partitioned by content type. During spikes, queues absorb the backlog while synchronous checks keep blocking known severe content. Near-duplicate detection means one decision can be applied to thousands of re-uploads of the same media.

:::tip
Mention that once a reviewer removes something, its hash goes into the hash database — so every future re-upload is caught automatically.
:::

### 3) How do we make decisions auditable and consistent?

Policies are **versioned**; every decision records the policy version, the model versions and signals, or the reviewer ID. Quality teams **re-review samples** of decisions to measure reviewer accuracy and agreement, and disagreements feed policy clarifications and model training data. Reviewer tools blur graphic media by default and cap exposure time per shift.

### Final Design

```diagram Final Design
node post 0,1 box "Post Service"
node mod 1.5,1 box "Moderation Service|decision engine"
node hash 1.5,-0.3 circle "Hash DB"
node q 3,1 box "Async Queue"
node gpu 4.5,1 box "GPU Models"
node cases 3,2.4 box "Case Service|priority queues"
node tool 4.5,2.4 box "Review Tool"
node log 6,1 circle "Decision Log"
node reports 0,2.4 box "User Reports"
edge post <-> mod
edge mod <-> hash
edge mod -> q
edge q -> gpu
edge gpu -> log
edge mod -> cases
edge reports -> cases
edge cases <-> tool
edge tool -> log
```

```quiz
[
  {
    "question": "Why use perceptual hashes rather than exact file hashes?",
    "options": ["They're shorter", "They still match media that has been resized or slightly altered", "They're encrypted", "They're faster to compute"],
    "answer": 1,
    "explanation": "Re-uploads are often modified copies of known violating media."
  },
  {
    "question": "What goes to human review?",
    "options": ["Everything", "Content in the uncertain middle band of model confidence, plus reports", "Nothing", "Only text"],
    "answer": 1,
    "explanation": "Clear cases are automated; humans handle ambiguity."
  },
  {
    "question": "What's a good way to prioritise review cases?",
    "options": ["First in, first out", "Expected harm: severity × probability × predicted reach", "Alphabetically", "By author name"],
    "answer": 1,
    "explanation": "Viral harmful content is reviewed before low-reach spam."
  },
  {
    "question": "Why record the policy version with every decision?",
    "options": ["For marketing", "For audits, appeals and measuring consistency as policies change", "To speed up review", "It's required by the CDN"],
    "answer": 1,
    "explanation": "Decisions must be explainable against the rules that applied at the time."
  }
]
```
