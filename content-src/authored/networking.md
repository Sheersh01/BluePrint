---
title: Networking & Gateways
subtitle: Load balancers, proxies, gateways, DNS, service discovery and how services talk to each other.
seoTitle: System Design Interview Questions — Networking, Traffic & Gateways
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 47 | Define | B | What is a load balancer and why is it used?
A load balancer distributes incoming requests across multiple servers. It lets you scale horizontally, improves availability by routing around unhealthy instances (health checks), and gives clients one stable endpoint while servers come and go.

Load balancers can also terminate TLS, enforce connection limits and provide sticky sessions when needed. They run at multiple layers: DNS-level (global), L4 (TCP/UDP) and L7 (HTTP).

**In the interview:** "An L7 load balancer in front of the stateless API tier, with health checks so a failing instance is removed within seconds."
:::

:::qa 48 | How | B | What are common load balancing algorithms?
- **Round robin**: each server in turn. Simple; assumes equal servers and similar requests.
- **Weighted round robin**: bigger servers get proportionally more traffic.
- **Least connections** (or least outstanding requests): send to the least busy server. Better when request costs vary.
- **IP hash / consistent hashing**: the same client or key always goes to the same server — useful for caches or sticky sessions.
- **Random with two choices**: pick two servers at random, send to the less loaded — surprisingly effective at scale.

**In the interview:** "Least outstanding requests for the API tier, consistent hashing for the cache tier so keys stay on the same node."
:::

:::qa 49 | Compare | I | Layer 4 vs Layer 7 load balancing.
**Layer 4** balancers route by IP and port at the transport layer (TCP/UDP) without looking inside packets. They're extremely fast, protocol-agnostic and handle huge connection counts — ideal for raw TCP, WebSockets, databases and as a front layer.

**Layer 7** balancers understand application protocols (HTTP, gRPC). They can route by path, host or header, terminate TLS, rewrite requests, retry, rate-limit and do canary splits — at the cost of more CPU and latency.

Often both are used: L4 at the edge spreading traffic across a fleet of L7 proxies.

**In the interview:** "L7 for HTTP APIs because I want path-based routing to services; L4 for the WebSocket gateway's long-lived connections."
:::

:::qa 50 | Compare | B | Forward proxy vs reverse proxy.
A **forward proxy** sits in front of **clients** and makes requests on their behalf to the internet. The server sees the proxy, not the client. Uses: corporate egress filtering, caching, anonymity, bypassing geo-restrictions.

A **reverse proxy** sits in front of **servers** and receives requests on their behalf. The client sees the proxy, not the backends. Uses: load balancing, TLS termination, caching, compression, hiding internal topology (Nginx, Envoy, HAProxy, CDNs).

**In the interview:** "Forward proxy protects and controls the client side; reverse proxy protects and scales the server side."
:::

:::qa 51 | How | I | What is the role of a reverse proxy?
A reverse proxy is the front door to your servers. It commonly:

- **Terminates TLS**, so backends don't manage certificates.
- **Load balances** across instances with health checks.
- **Caches** responses and serves static files.
- **Compresses** responses (gzip/brotli).
- **Hides backends** — clients never see internal hosts or ports.
- Adds **security controls**: rate limiting, request size limits, IP filtering, WAF rules.
- Handles **retries and timeouts** for upstream calls.

**In the interview:** "Envoy as the reverse proxy: TLS termination, retries with budgets, and per-route timeouts, so services stay focused on business logic."
:::

:::qa 52 | Define | B | What is an API gateway and what does it do?
An API gateway is a single entry point for client requests to many backend services. Its core job is **routing** each request to the right service; it also centralises cross-cutting concerns:

- Authentication and authorization checks.
- Rate limiting and quotas.
- Request/response transformation and protocol translation (REST ↔ gRPC).
- Aggregating several service calls into one response (backend-for-frontend).
- Logging, metrics and tracing at the edge.

It should stay thin — business logic belongs in services.

**In the interview:** "The gateway authenticates, rate-limits and routes; it never contains domain logic."

**Go deeper:** [API Gateway](/learn/system-design/deep-dives/api-gateway)
:::

:::qa 53 | Compare | I | Load balancer vs API gateway. Can they be used interchangeably?
No. A **load balancer** distributes traffic across identical instances of *one* service, focused on availability and spreading load. An **API gateway** routes requests to *different* services based on the API, and handles API concerns: auth, rate limits, transformations, versioning, quotas.

They overlap (modern L7 load balancers can route by path; gateways can balance load), but in a typical design they work together: clients → API gateway → (internal load balancing) → service instances. The gateway itself runs behind a load balancer.

**In the interview:** "Gateway for API concerns and routing; load balancing happens behind it, per service."
:::

:::qa 54 | How | B | How does DNS work?
DNS translates names (`api.example.com`) into IP addresses:

1. The client asks its **recursive resolver** (ISP or public resolver).
2. On a cache miss, the resolver asks a **root** server, which points to the **TLD** server (`.com`).
3. The TLD server points to the domain's **authoritative** name servers.
4. The authoritative server returns the record (A/AAAA/CNAME), which is cached at each level according to its **TTL**.

In system design, DNS also does coarse traffic management: geo-routing, weighted records, and failover by health checks — limited by TTLs and client caching.

**In the interview:** "Low TTLs on the API record so DNS-based regional failover takes effect within a minute."
:::

:::qa 55 | Define | B | What is the role of a firewall in network security?
A firewall controls which network traffic is allowed in and out, based on rules about sources, destinations, ports and protocols. It enforces a perimeter and **segmentation** — for example, only the load balancer can reach app servers, and only app servers can reach the database.

Forms include network firewalls and cloud security groups (L3/L4 rules), host firewalls, and **web application firewalls** (WAFs) that inspect HTTP traffic for attacks like SQL injection.

**In the interview:** "Security groups allow the database port only from the app tier's subnet; a WAF in front of the public API blocks common attack patterns."
:::

:::qa 56 | Define | I | What is service discovery? Client-side vs server-side discovery.
Service discovery lets services find each other's current network locations as instances scale, move and fail. Instances register in a **registry** (Consul, etcd, Kubernetes, Eureka), with health checks removing dead ones.

- **Client-side discovery**: the caller queries the registry and picks an instance itself (with its own load balancing). Fewer hops, but every client needs discovery logic.
- **Server-side discovery**: the caller sends requests to a load balancer or router, which consults the registry. Simpler clients, one extra hop.

Kubernetes services and service meshes make this mostly transparent.

**In the interview:** "In Kubernetes, services resolve via cluster DNS and the mesh sidecar handles load balancing — effectively server-side discovery."
:::

:::qa 57 | Compare | B | Synchronous vs asynchronous communication in microservices.
**Synchronous** (REST, gRPC): the caller waits for a response. Simple and immediate, but couples availability and latency — if the callee is slow or down, the caller is too, and long call chains multiply failures.

**Asynchronous** (message queues, events): the caller publishes and moves on; consumers process later. Decouples services, absorbs spikes and tolerates downtime — but adds eventual consistency, harder debugging and the need for idempotent consumers.

**In the interview:** "Sync where the user needs the answer now (checking a price); async for side effects (sending emails, updating search, analytics)."
:::

:::qa 58 | Define | B | What are the different ways a web server can communicate with another web server?
- **Synchronous APIs**: REST/HTTP, gRPC, GraphQL, SOAP — request/response.
- **Asynchronous messaging**: message queues (SQS, RabbitMQ), logs/streams (Kafka), pub/sub.
- **Shared datastore**: one writes, another reads (a database, cache or blob storage) — simple but couples schemas.
- **Webhooks**: one server calls another's endpoint when an event happens.
- **Long-lived connections**: WebSockets or streaming RPCs for continuous exchange.

**In the interview:** "Services own their data; they talk via gRPC for queries and Kafka events for state changes — never by reading each other's databases."
:::

:::qa 59 | How | I | What is rate limiting/API throttling and how do you implement it?
Rate limiting caps how many requests a client can make in a time window, protecting services from abuse and overload and enforcing quotas.

Algorithms:

- **Fixed window** counters: simple; allows bursts at window edges.
- **Sliding window log/counter**: smoother and more accurate.
- **Token bucket**: tokens refill at a steady rate; allows short bursts up to the bucket size. The common default.
- **Leaky bucket**: processes requests at a constant rate, smoothing bursts.

Implementation: counters in **Redis** (atomic `INCR` with expiry or a Lua script) shared by all gateway instances; respond with **429 Too Many Requests** and a `Retry-After` header.

**In the interview:** "Token bucket per API key in Redis at the gateway, returning 429 with Retry-After."

**Go deeper:** [Rate Limiter](/learn/system-design/problem-breakdowns/rate-limiter)
:::
