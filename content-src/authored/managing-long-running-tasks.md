---
title: Managing Long Running Tasks
subtitle: Work that takes seconds to hours — async job queues, workers, status tracking, retries, and progress reporting.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Transcoding a video, generating a report, running user-submitted code, sending a million emails — some work simply takes too long to do inside an HTTP request. This pattern decouples **accepting** work from **doing** it, so users get an immediate response and the work completes reliably in the background.

## The Problem

If a request handler does a 5-minute job synchronously:

- Clients and load balancers time out (often after 30-60 seconds).
- A server crash loses the work with no record it was ever requested.
- Spiky demand ties up web servers, so even fast endpoints slow down.
- You can't scale the heavy work independently of the API.

## The Solution

:::solution bad Do it inline and raise the timeout
#### Approach

Increase every timeout to 10 minutes and process the job in the request.

#### Challenges

Doesn't survive crashes or deploys, holds connections and threads hostage, and still fails for jobs longer than the new limit.
:::

:::solution good Background threads on the web server
#### Approach

Accept the request, spawn a background thread, and return immediately.

#### Challenges

Work is lost if the server restarts, and web and worker load still compete for the same machines.
:::

:::solution great Async job queue with workers
#### Approach

1. The API validates the request, writes a **Job** record (`status = PENDING`), enqueues a message, and returns `202 Accepted` with a job ID.
2. A separate pool of **workers** consumes the queue, marks the job `RUNNING`, does the work, and stores the result (often in blob storage) with `status = SUCCEEDED` or `FAILED`.
3. The client polls `GET /jobs/:id`, or is notified via webhook, SSE or push when it finishes.

Workers scale independently on queue depth, and the queue's **visibility timeout** redelivers work if a worker crashes.

#### Challenges

At-least-once delivery means jobs may run twice — make them idempotent. Very long jobs need heartbeats to extend their visibility timeout.
:::

```diagram Async job processing
node client 0,1 box "Client"
node api 1.3,1 box "API|- 202 + jobId"
node db 1.3,2.2 circle "Jobs DB|(status)"
node q 2.6,1 circle "Queue"
node workers 3.9,1 box "Worker Pool|- heartbeat|- retries"
node blob 5.1,1 circle "Results|(S3)"
node dlq 3.9,2.2 circle "DLQ"
edge client <-> api "submit / poll"
edge api -> db
edge api -> q
edge q -> workers
edge workers -> db "status"
edge workers -> blob
edge workers -> dlq "max retries"
```

## When to Use in Interviews

- [YouTube](/learn/system-design/problem-breakdowns/youtube) — transcoding uploaded videos.
- [LeetCode](/learn/system-design/problem-breakdowns/leetcode) — running and judging submissions.
- [Job Scheduler](/learn/system-design/problem-breakdowns/job-scheduler) — executing scheduled jobs reliably.
- [ChatGPT](/learn/system-design/problem-breakdowns/chatgpt) — long LLM generations decoupled from the connection.
- [Web Crawler](/learn/system-design/problem-breakdowns/web-crawler) — fetching and parsing pages at scale.

## Common Deep Dives

### How do you report progress?

Workers periodically write progress (percent complete, current stage) to the job record or a fast store like Redis. Clients poll or subscribe via SSE. For multi-stage pipelines, model stages explicitly so progress is meaningful.

### How do you handle failures and retries?

Retry transient failures with exponential backoff and jitter, up to a maximum attempt count, then move the job to a dead-letter queue and mark it `FAILED` with an error message. Distinguish retryable errors (timeouts) from permanent ones (invalid input) so you don't retry hopeless jobs.

### How do you prevent one tenant or a burst from starving others?

Use separate queues or priorities (interactive vs. batch), per-tenant concurrency limits, and autoscaling on queue age rather than just depth.

## Conclusion

Accept quickly, process asynchronously. Persist a job record, enqueue the work, let an independently scalable worker pool process it with retries and idempotency, and give clients a way to check status or be notified.

```quiz
[
  {
    "question": "What should an API return when it accepts a long-running job?",
    "options": ["200 with the final result after waiting", "202 Accepted with a job ID", "500", "A redirect to the worker"],
    "answer": 1,
    "explanation": "The client gets an immediate acknowledgement and tracks the job by ID."
  },
  {
    "question": "What redelivers a job if its worker crashes?",
    "options": ["The client", "The queue's visibility timeout", "The load balancer", "DNS"],
    "answer": 1,
    "explanation": "Unacknowledged messages become visible again for another worker."
  },
  {
    "question": "Why must jobs be idempotent?",
    "options": ["To run faster", "At-least-once delivery means a job may execute more than once", "To save storage", "Queues require JSON"],
    "answer": 1,
    "explanation": "Idempotency makes duplicate executions harmless."
  },
  {
    "question": "Why run workers separately from web servers?",
    "options": ["Workers need GPUs always", "So heavy work scales independently and doesn't slow the API", "Web servers can't connect to queues", "For security only"],
    "answer": 1,
    "explanation": "Independent pools let each side scale on its own load signal."
  }
]
```
