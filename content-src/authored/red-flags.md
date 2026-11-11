---
title: Red Flags and What to Do Instead
subtitle: The habits that quietly sink system design interviews, why interviewers notice them, and the stronger move for each.
section: tips
category: Tips & Tricks
seoTitle: Common System Design Interview Mistakes
description: The most common system design interview mistakes — jumping to solutions, buzzword designs, ignoring failures — and what strong candidates do instead.
author: Editorial Team
published: Nov 11, 2026
---

Interviewers rarely fail candidates for not knowing a technology. They fail them for patterns of behaviour that suggest they couldn't design a real system with a team. Read this list the night before.

## Process

| Red flag | Why it hurts | Instead |
|---|---|---|
| Drawing boxes in the first minute | You may solve the wrong problem | Spend ~5 minutes on requirements first |
| Asking 15 clarifying questions | Looks like stalling | Ask 2–3 that change the design, assume the rest out loud |
| Listing every possible feature | Nothing gets designed in depth | Pick 3–4 core features, name what's out of scope |
| Running out of time before deep dives | Depth is where seniority shows | Watch the clock; move fast through the basics |
| Long silences | The interviewer can't follow you | Think aloud, even when unsure |
| Ignoring hints | Signals you'd be hard to work with | Treat every question as a nudge: "Good point — that breaks when…" |

## Design

| Red flag | Why it hurts | Instead |
|---|---|---|
| Buzzword architecture (Kafka + Kubernetes + microservices for a todo app) | Complexity without a reason | Add each component only when a requirement needs it, and say which one |
| "Highly available, scalable and fast" as NFRs | Fits every system, says nothing | Specific, quantified, prioritized qualities |
| One giant database for everything with no reasoning | Misses the access patterns | Choose storage per access pattern ([Choosing a Database](/learn/system-design/tips/choosing-a-database)) |
| Caching without mentioning invalidation | The hard part is skipped | Say how entries are invalidated and what staleness is acceptable |
| Sharding without a partition key | Hand-waving | Name the key and check it for hot spots |
| Ignoring failures | Real systems fail constantly | For each critical call: timeout, retry, idempotency, what if it's down? |
| Optimizing before the design works | Can't evaluate trade-offs | Get a simple end-to-end flow first, then evolve it |
| Trusting the client (`userId` in the body, client-side prices) | Security hole | Identity from the token, prices and permissions computed server-side |

## Communication

| Red flag | Why it hurts | Instead |
|---|---|---|
| "We'll just use X" with no reason | Sounds memorized | "X, because our access pattern is Y; the trade-off is Z" |
| Only one option ever considered | Looks inflexible | Compare two options briefly, then commit |
| Arguing with the interviewer | Poor collaboration signal | Acknowledge, then explain your reasoning or adapt |
| Pretending to know a technology | Easily exposed by one follow-up | "I haven't used it in production, but I'd expect…" |
| Unlabeled diagram arrows | The flow is unreadable | Label arrows with the call or event they carry |
| Never summarizing | The interviewer has to piece it together | Recap the design and its trade-offs at the end |

## Level Calibration

| Level | Interviewers expect you to… |
|---|---|
| Mid-level | Produce a working, reasonable design; go deep when prompted; know the basics of caching, databases and queues |
| Senior | Drive the interview; find the hard parts yourself; discuss trade-offs and failure handling without being asked |
| Staff+ | See past the textbook answer; reason about operations, cost, evolution and organizational constraints; simplify where others add |

:::tip
The single best habit: after every decision, say the trade-off. "I'll use a cache here; the trade-off is up to 60 seconds of staleness, which is fine for view counts." That one sentence is what interviewers write down.
:::
