---
title: Authentication System
seoTitle: Design a User Login and Authentication System
description: Design website authentication — secure password storage, sessions vs. tokens, refresh tokens and revocation, MFA, and protecting login from abuse.
tags: Scaling Reads
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Google, Visa, Gusto | 0
---

## Understanding the Problem

:::definition 🔐 What is an Authentication System?
Authentication proves who a user is. A login system lets people sign up, sign in with a password (and optionally a second factor), stay signed in across requests, and sign out — while keeping credentials safe.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to sign up with email and password, and verify their email.
2. Users should be able to log in and stay logged in across requests and devices.
3. Users should be able to log out, including "log out of all devices".
4. Users should be able to reset a forgotten password and enable multi-factor authentication (MFA).

**Below the line (out of scope):**

- Social login / OAuth provider implementation.
- Fine-grained authorization (roles and permissions).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Security first: passwords stored so a database leak doesn't expose them; resistant to brute force and credential stuffing.
2. Authenticating each request must be fast (< 10ms) since every API call does it.
3. Highly available — if auth is down, the whole product is down.
4. Revocation (logout, password change) takes effect quickly.

**Below the line (out of scope):**

- Compliance certifications.

```sketch Auth Requirements
Functional
- sign up + verify email
- log in, stay logged in
- log out (all devices)
- password reset, MFA

Non-functional
- leak-resistant passwords
- request auth < 10ms
- highly available
- fast revocation
```

## The Set Up

### Defining the Core Entities

1. **User**: email, password hash, MFA settings, status.
2. **Session / refresh token**: a long-lived credential tied to a device, revocable.
3. **Access token**: a short-lived token presented on every request.
4. **Verification / reset token**: one-time, expiring tokens sent by email.

### API or System Interface

```
POST /auth/signup  { email, password }
POST /auth/login   { email, password, mfaCode? } -> { accessToken (15 min), refreshToken (cookie) }
POST /auth/refresh -> { accessToken }
POST /auth/logout  { allDevices?: true }
POST /auth/password-reset/request { email }
POST /auth/password-reset/confirm { token, newPassword }
```

## High-Level Design

### 1) Sign up

The **Auth Service** hashes the password with a slow, salted algorithm — **Argon2id** or **bcrypt** — and stores only the hash. It then emails a one-time verification link containing a random token (stored hashed, with an expiry).

```diagram Login and request authentication
node client 0,1 box "Client"
node auth 1.5,0.3 box "Auth Service|- verify password|- issue tokens"
node users 3,0.3 circle "Users DB|password hashes"
node sess 3,1.7 circle "Sessions|(refresh tokens)"
node gw 1.5,1.7 box "API Gateway|- verify JWT signature"
node api 3,2.9 box "Backend Services"
edge client <-> auth "login / refresh"
edge auth <-> users
edge auth <-> sess
edge client <-> gw "Bearer access token"
edge gw -> api "userId"
```

### 2) Log in and stay logged in

On login, verify the password hash (and MFA), then issue two credentials:

- A short-lived **access token** (a signed JWT, ~15 minutes) the gateway can verify locally with a public key — no database lookup per request.
- A long-lived **refresh token** (random, stored hashed in the Sessions table, sent as an HttpOnly, Secure cookie) used to obtain new access tokens.

### 3) Log out

Delete the session row (or all of a user's sessions). The refresh token stops working immediately; outstanding access tokens expire within minutes.

### 4) Password reset and MFA

Reset emails contain a single-use, short-lived token; using it sets a new password and revokes all sessions. MFA uses TOTP (authenticator apps) or WebAuthn passkeys checked during login.

## Potential Deep Dives

### 1) How should passwords be stored?

:::solution bad Plain text or reversible encryption
#### Approach

Store passwords directly or encrypted with a key.

#### Challenges

Any leak (or stolen key) exposes every password — and users reuse passwords elsewhere.
:::

:::solution good Fast hash with salt (SHA-256)
#### Approach

Store `sha256(salt + password)`.

#### Challenges

Salts stop rainbow tables, but fast hashes let attackers try billions of guesses per second on GPUs.
:::

:::solution great Slow, memory-hard hashing (Argon2id / bcrypt)
#### Approach

Use Argon2id (or bcrypt) with a per-user salt and a work factor tuned to ~100ms per hash. Optionally add a **pepper** stored outside the database. Rehash on login when parameters are upgraded.

#### Challenges

Login costs some CPU, so rate limiting matters even more.
:::

### 2) Sessions or tokens?

:::solution good Server-side sessions only
#### Approach

Store a session ID in a cookie and look it up in Redis on every request.

#### Challenges

Instant revocation, but every request hits the session store — a hot dependency that must scale and stay up.
:::

:::solution great Short-lived JWT access tokens + revocable refresh tokens
#### Approach

Gateways verify access tokens locally by signature (fast, no lookup). Revocation happens at refresh time, so its delay is bounded by the access-token lifetime. For urgent cases (compromised account), keep a small denylist of token IDs in a cache checked by the gateway. Rotate refresh tokens on each use and detect reuse to catch theft.

#### Challenges

Up to ~15 minutes of access after logout unless the denylist is used.
:::

### 3) How do we protect login from abuse?

Rate limit by IP, account and device fingerprint; add exponential backoff and CAPTCHA after failures; check passwords against known-breached lists at signup; send new-device alerts; and return the same generic error for "no such user" and "wrong password" so attackers can't enumerate accounts.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node rl 1.3,0.2 box "Rate Limiter|+ CAPTCHA"
node auth 2.6,0.2 box "Auth Service|- Argon2id|- MFA"
node users 4,0.2 circle "Users DB"
node sess 4,1.4 circle "Sessions|(hashed refresh)"
node gw 1.3,1.8 box "API Gateway|- JWT verify|- denylist"
node deny 2.6,2.8 circle "Denylist|(Redis)"
node mail 2.6,1.4 box "Email Service"
edge client -> rl "login"
edge rl -> auth
edge auth <-> users
edge auth <-> sess
edge auth -> mail "verify / reset"
edge client <-> gw "API calls"
edge gw <-> deny
```

```quiz
[
  {
    "question": "Why use Argon2id or bcrypt instead of SHA-256 for passwords?",
    "options": ["They are shorter", "They are deliberately slow and memory-hard, making brute force expensive", "They are reversible", "They don't need salts"],
    "answer": 1,
    "explanation": "Fast hashes allow billions of guesses per second on GPUs."
  },
  {
    "question": "Why are access tokens short-lived?",
    "options": ["To save bandwidth", "They're verified without a lookup, so short lifetimes bound how long a revoked token works", "JWTs can't be long", "For SEO"],
    "answer": 1,
    "explanation": "Revocation is enforced at refresh time."
  },
  {
    "question": "Where should a refresh token be stored in a browser?",
    "options": ["localStorage", "An HttpOnly, Secure cookie", "The URL", "A global JavaScript variable"],
    "answer": 1,
    "explanation": "HttpOnly cookies can't be read by injected scripts."
  },
  {
    "question": "Why return the same error for unknown user and wrong password?",
    "options": ["Simplicity", "To prevent attackers enumerating which accounts exist", "It's faster", "Legal requirement"],
    "answer": 1,
    "explanation": "Distinct errors leak account existence."
  }
]
```
