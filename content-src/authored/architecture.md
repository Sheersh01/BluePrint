---
title: Architecture & Operations
subtitle: Monoliths and microservices, containers, serverless, orchestration, circuit breakers and observability.
seoTitle: System Design Interview Questions — Architecture, Deployment & Observability
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 69 | Compare | B | Monolithic vs microservices architecture.
A **monolith** is one deployable application containing all features. It's simple to build, test, deploy and debug, with in-process calls and one database — but large monoliths slow teams down, scale only as a whole, and one bad deploy affects everything.

**Microservices** split the system into independently deployable services, each owning its data. Teams move independently and services scale separately — at the cost of network calls, distributed failures, data consistency across services, and heavy operational tooling (CI/CD, observability, service discovery).

**In the interview:** "Microservices solve organisational scaling problems; they create technical ones. I'd split only where team or scaling boundaries are clear."
:::

:::qa 70 | Decide | I | Should you choose microservices or a monolith? When do you split?
Start with a **well-structured modular monolith** unless you already have many teams or clear scaling differences. Split a piece out when:

- A **team** needs to deploy it independently and keeps colliding with others.
- It has very **different scaling or resource needs** (e.g. video transcoding vs. the web app).
- It needs **different reliability or security** isolation (payments).
- Its **domain boundary** is stable and well understood (a bounded context).

Don't split just for "cleanliness" — premature microservices create a distributed monolith.

**In the interview:** "Modular monolith first; extract the transcoding pipeline because it scales differently, and payments because it needs isolation."
:::

:::qa 71 | Define | B | What is containerization and what are its benefits?
Containerization packages an application with its dependencies, libraries and configuration into an image that runs as an isolated process sharing the host's OS kernel (Docker, containerd).

Benefits:

- **Consistency**: the same image runs in dev, CI and production ("works on my machine" goes away).
- **Lightweight and fast** compared to VMs — start in seconds, dense packing on hosts.
- **Isolation** of dependencies and resources (CPU/memory limits).
- **Portability** across clouds and on-prem.
- Foundation for **orchestration**, auto-scaling and immutable deployments.

**In the interview:** "Each service ships as a container image built once in CI and promoted unchanged through environments."
:::

:::qa 72 | Define | B | What is serverless architecture? Advantages and limitations?
Serverless means running code without managing servers — functions (AWS Lambda, Cloud Functions) or managed services that scale automatically and bill per use.

**Advantages**: no infrastructure management, automatic scaling (including to zero), pay only for execution, fast to build event-driven glue.

**Limitations**: **cold starts** add latency, execution time and memory limits, harder local testing and debugging, vendor lock-in, cost can exceed servers at sustained high load, and connection-heavy workloads (databases) need pooling proxies.

**In the interview:** "Serverless for spiky, event-driven work like image thumbnails; long-running, latency-sensitive services stay on containers."
:::

:::qa 73 | Define | I | What is the role of orchestration tools like Kubernetes?
Orchestrators run containers across a cluster of machines and keep them in the desired state:

- **Scheduling** containers onto nodes with enough resources.
- **Self-healing**: restarting crashed containers, replacing failed nodes, health checks.
- **Scaling**: horizontal pod autoscaling based on CPU or custom metrics.
- **Service discovery and load balancing** between pods.
- **Rolling updates and rollbacks** with no downtime.
- **Configuration and secrets** management.

The core idea is **declarative desired state**: you describe what should run, and controllers continuously reconcile reality toward it.

**In the interview:** "Kubernetes runs the services with rolling deploys and autoscaling; stateful databases stay on managed services."

**Go deeper:** [Database Control Plane](/learn/system-design/problem-breakdowns/database-control-plane)
:::

:::qa 74 | Define | B | What is a distributed ledger and how does it relate to blockchain?
A distributed ledger is a database replicated across many participants that agree on the same ordered record of transactions, without relying on one central authority to maintain it.

A **blockchain** is one kind of distributed ledger: transactions are grouped into blocks, each cryptographically linked to the previous one (a chain of hashes), making history tamper-evident. Participants agree on new blocks via a consensus mechanism (proof of work, proof of stake, or BFT protocols in permissioned chains).

In most company systems, a central database with an append-only audit log solves the same trust problem far more cheaply.

**In the interview:** "Unless multiple mutually distrusting parties must share the ledger, a double-entry ledger in Postgres with an immutable audit log is the right tool."
:::

:::qa 75 | Define | I | What is a circuit breaker?
A circuit breaker stops a service from repeatedly calling a failing dependency, preventing cascading failures and giving the dependency time to recover.

States:

- **Closed**: calls flow normally; failures are counted.
- **Open**: after failures exceed a threshold, calls fail fast immediately (or return a fallback) without hitting the dependency.
- **Half-open**: after a cooldown, a few trial calls are allowed; success closes the circuit, failure reopens it.

Combine with timeouts, retries with backoff, and bulkheads (isolated resource pools).

**In the interview:** "Calls to the recommendation service sit behind a circuit breaker; when it opens, we show popular items instead."
:::

:::qa 86 | Define | I | What is observability?
Observability is how well you can understand a system's internal state from its outputs — crucial for debugging problems you didn't anticipate. It rests on three signals:

- **Metrics**: numeric time series (request rate, error rate, latency percentiles, saturation) for dashboards and alerts.
- **Logs**: detailed, timestamped event records, ideally structured (JSON) with request IDs.
- **Traces**: the path of a single request across services, showing where time was spent.

Good practice: correlate all three with shared IDs, alert on user-facing symptoms (SLOs) rather than causes, and keep cardinality under control.

**In the interview:** "Every request gets a trace ID propagated through logs and spans; alerts fire on SLO burn rate, not CPU."

**Go deeper:** [Metrics Monitoring](/learn/system-design/problem-breakdowns/metrics-monitoring) · [Distributed Tracing](/learn/system-design/problem-breakdowns/distributed-tracing)
:::
