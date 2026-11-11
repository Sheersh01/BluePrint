---
title: Security
subtitle: OAuth, least privilege, encryption, common web vulnerabilities and securing service-to-service traffic.
seoTitle: System Design Interview Questions — Security
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 76 | Define | B | What is OAuth 2.0 and how does it enable secure authorization?
OAuth 2.0 is a framework that lets an application access a user's resources on another service **without receiving the user's password**. The user authenticates with the provider (e.g. Google) and grants specific **scopes**; the app receives an **access token** (and often a refresh token) limited to those permissions.

The common flow for web and mobile apps is **Authorization Code with PKCE**: redirect to the provider, user consents, the app exchanges a short-lived code for tokens server-side. **OpenID Connect** adds an ID token on top for authentication ("Sign in with Google").

**In the interview:** "OAuth is delegated authorization — scoped, revocable tokens instead of shared passwords; OIDC layers login on top."

**Go deeper:** [Authentication System](/learn/system-design/problem-breakdowns/authentication-system)
:::

:::qa 77 | Define | B | What is the principle of least privilege?
Least privilege means every user, service and process gets only the minimum permissions needed to do its job, for only as long as needed. If something is compromised, the damage is limited.

In practice: per-service IAM roles scoped to specific resources, read-only database users for read-only services, no shared admin credentials, short-lived credentials instead of long-lived keys, network segmentation, and regular access reviews.

**In the interview:** "The thumbnail worker can read the uploads bucket and write the thumbnails bucket — nothing else."
:::

:::qa 78 | Compare | B | Encryption at rest vs encryption in transit. Why are both important?
**Encryption in transit** protects data while it moves across networks (TLS/HTTPS, mTLS between services), preventing eavesdropping and tampering.

**Encryption at rest** protects stored data — disks, databases, backups, object storage — so stolen disks, snapshots or misconfigured backups don't expose plaintext. Keys are managed in a KMS, ideally with rotation and envelope encryption.

You need both because they defend different attack paths: network interception versus storage theft. Neither protects against a compromised application with legitimate access — that's what access control is for.

**In the interview:** "TLS everywhere including internal traffic, and KMS-managed encryption at rest for databases, buckets and backups."
:::

:::qa 79 | How | I | What are common web app vulnerabilities and how do you mitigate them?
- **SQL injection**: untrusted input concatenated into queries. Mitigate with parameterised queries/ORMs and least-privilege DB users.
- **XSS**: injected scripts run in other users' browsers. Mitigate with output encoding, frameworks that escape by default, Content Security Policy, and HttpOnly cookies.
- **CSRF**: a malicious site triggers actions with a user's cookies. Mitigate with SameSite cookies, CSRF tokens, and checking Origin headers.
- **Broken authentication**: weak passwords, session fixation, credential stuffing. Mitigate with slow password hashing, MFA, rate limiting, secure session handling.
- Also: broken access control (check authorization on every request), SSRF, insecure dependencies.

**In the interview:** "Parameterised queries, escaped output plus CSP, SameSite cookies, and authorization checks on every endpoint — not just in the UI."
:::

:::qa 80 | Scenario | I | How do you secure communication between multiple microservices?
- **mTLS** between services: encrypts traffic and authenticates both sides with certificates — usually handled by a **service mesh** (Istio, Linkerd) that rotates certificates automatically.
- **Service identity and authorization**: policies like "only checkout may call payments", enforced by the mesh or each service.
- **Propagated user context**: the API gateway validates the user's token and passes a signed JWT (or claims) downstream, so services can authorize actions per user.
- **Network segmentation**: services reachable only from where they need to be.
- **Secrets management**: credentials from a vault, never in code or images.

**In the interview:** "The mesh gives every service mTLS identity; authorization policies allowlist callers, and user identity travels as a signed JWT from the gateway."
:::
