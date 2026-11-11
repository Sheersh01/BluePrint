---
title: APIs & Integration
subtitle: REST principles, REST vs GraphQL vs gRPC, versioning and webhooks.
seoTitle: System Design Interview Questions — APIs & Integration
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 65 | Define | B | What is RESTful API design and what are its key principles?
REST models an API as **resources** identified by URLs, manipulated with standard HTTP methods.

Key principles:

- **Resource-oriented URLs**: nouns, not verbs (`/users/42/orders`).
- **HTTP methods with meaning**: GET reads (safe), POST creates, PUT replaces (idempotent), PATCH updates, DELETE removes.
- **Statelessness**: each request carries everything needed (auth token); no server-side session state required.
- **Standard status codes**: 200, 201, 400, 401, 404, 409, 429, 500.
- **Cacheability** via `Cache-Control` and ETags.
- Consistent **pagination** (cursor-based), filtering and error formats.

**In the interview:** "`POST /bookings` creates a booking, `GET /bookings/:id` reads it, with cursor pagination on list endpoints."
:::

:::qa 66 | Compare | I | REST vs GraphQL vs gRPC.
- **REST**: resources over HTTP/JSON. Universally supported, cache-friendly, easy to debug. Can over-fetch or need multiple round trips for complex screens.
- **GraphQL**: a single endpoint where clients ask for exactly the fields they need. Great for varied front-end needs and aggregating many backends; harder to cache, needs query cost limits and careful N+1 handling.
- **gRPC**: binary Protocol Buffers over HTTP/2 with generated clients, streaming and strict contracts. Very efficient for **service-to-service** calls; less convenient in browsers.

**In the interview:** "Public API: REST. Mobile app with many screen-specific needs: GraphQL via a BFF. Internal service calls: gRPC."
:::

:::qa 67 | Define | I | What is API versioning and why does it matter for backward compatibility?
API versioning lets you change an API without breaking existing clients — especially mobile apps and third parties you can't force to upgrade.

Approaches: version in the **URL** (`/v2/orders`), in a **header** (`Accept: application/vnd.api+json;version=2`), or **date-based** versions (Stripe style).

Best practices: prefer **additive, backward-compatible changes** (new optional fields) that need no new version; never remove or repurpose fields without a deprecation period; monitor usage of old versions before retiring them.

**In the interview:** "We evolve additively; a breaking change gets a new version, and v1 stays supported until traffic drops below a threshold."
:::

:::qa 68 | Define | B | What are webhooks and how are they used in integrations?
A webhook is an HTTP callback: when an event happens in one system (payment succeeded, PR merged), it sends a POST to a URL the integrating system registered. It's push-based, avoiding constant polling.

Making webhooks reliable:

- **Sign payloads** (HMAC) so receivers can verify authenticity.
- **Retry with backoff** until a 2xx response, with a dead-letter state after many failures.
- Include an **event ID** so receivers can deduplicate retried deliveries.
- Receivers should respond quickly (acknowledge, then process asynchronously).

**In the interview:** "Payment events are delivered by signed webhooks with retries; merchants dedupe by event ID."

**Go deeper:** [Payment System](/learn/system-design/problem-breakdowns/payment-system)
:::
