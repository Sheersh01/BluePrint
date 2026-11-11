---
title: Rate Limiter Middleware
subtitle: An in-memory rate limiter that works on a laptop and breaks in production. Find the five reasons why.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix an In-Memory Rate Limiter
description: A code-review interview question — an in-memory Python rate limiter that fails across servers, under concurrency and at window boundaries, and how to fix it with Redis.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
Per-process vs shared state, atomic counters, memory growth, window-boundary bursts, failure modes when the limiter's own store is down.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| Limit is per server, not per user | Sticky sessions | **Shared counter store (Redis)** |
| Concurrent requests race on the counter | `threading.Lock` | **Atomic `INCR` (a lock only protects one process)** |
| Old windows pile up in memory | A cleanup thread | **`EXPIRE` on every key** |
| 2× the limit at a window boundary | Smaller windows | **Sliding window or token bucket** |
| Redis is down | Reject everything | **Decide per endpoint: fail open or fail closed** |

**Mental model (decision tree)**

```
State shared by many servers?
        ↓
  External store (Redis)

Read → modify → write on a counter?
        ↓
  Atomic increment

Data that's only useful for a while?
        ↓
  TTL

Burst at the edge of a fixed window?
        ↓
  Sliding window / token bucket

Dependency of the limiter fails?
        ↓
  Explicit fail-open / fail-closed policy
```

## 1. The Starting Point

```python
import time

LIMIT = 100           # requests per minute
request_counts = {}   # "user_id:window" -> count

def is_allowed(user_id):
    window = int(time.time()) // 60
    key = f"{user_id}:{window}"

    count = request_counts.get(key, 0)
    if count >= LIMIT:
        return False

    request_counts[key] = count + 1
    return True

@app.before_request
def rate_limit():
    if not is_allowed(current_user.id):
        return {"error": "Too many requests"}, 429
```

## 2. What Most Candidates Catch ✅

### 2.1 Return a Proper 429

It does return 429 — good. Add a `Retry-After` header (seconds until the window resets) and the usual `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers so well-behaved clients can back off.

### 2.2 Unauthenticated Traffic

`current_user.id` doesn't exist for logged-out requests (login, sign-up, password reset — exactly the endpoints attackers hit). Rate-limit those by IP or by API key.

## 3. What Most Candidates Miss ⚠️

### 3.1 The Counter Lives in One Process

`request_counts` is a Python dict in one process. In production you run many:

```
20 API servers × 4 worker processes = 80 separate dicts
→ a user can make 80 × 100 = 8,000 requests a minute
```

And every deploy or restart resets every counter.

**Fix**: Keep counters in a shared store such as Redis.

### 3.2 Read-Modify-Write Race

```
Thread A: get → 99          Thread B: get → 99
Thread A: set 100 ✅         Thread B: set 100 ✅   ← 101 requests allowed
```

**Fix**: An atomic increment (`INCR`) — the store increments and returns the new value in one step.

### 3.3 Memory Leak

A new key is created for every user every minute, and nothing ever deletes old ones. Memory grows forever.

**Fix**: Give each key a TTL equal to the window.

### 3.4 Burst at the Window Boundary

```
12:00:59  → 100 requests  (window 12:00, allowed)
12:01:00  → 100 requests  (window 12:01, allowed)
= 200 requests in 2 seconds
```

**Fix**: Sliding window (count the last 60 seconds) or a token bucket (smooth refill).

### 3.5 No Plan When the Store Is Down

Once the limiter depends on Redis, Redis being down must not take the whole API down — or silently remove brute-force protection from login.

**Fix**: An explicit policy per endpoint (see Section 6).

## 4. Many Servers

:::info Interviewer asks
"We run 20 API servers behind a load balancer. Does this limiter still enforce 100 requests per minute per user?"
:::

### ⚠️ Common Mistake

"Use sticky sessions so a user always hits the same server." It's fragile (servers come and go, so users move), uneven, and still breaks on restarts.

### ✅ Correct Answer — Shared, Atomic Counters

```
INCR   rl:{user}:{window}      → returns the new count atomically
EXPIRE rl:{user}:{window} 60   → the key disappears after the window
```

Run both in one transactional pipeline (`MULTI`/`EXEC`) or a Lua script, so a crash can't leave a key without a TTL.

:::tip Say this
"In-process state doesn't work once there's more than one process. I'd keep counters in Redis and use INCR with an expiry in one atomic step, so every server sees the same count and old windows clean themselves up."
:::

## 5. Smoother Limits

:::info Interviewer asks
"A user sends 100 requests at 12:00:59 and another 100 at 12:01:00. Is that acceptable?"
:::

Usually not. Two standard fixes:

| Algorithm | How it works | Good for |
|---|---|---|
| Sliding window log | Store request timestamps in a sorted set; count those in the last 60 s | Exact limits, low volume per user |
| Sliding window counter | Weighted mix of the current and previous fixed window | Cheap, approximately exact |
| Token bucket | A bucket refills at a steady rate; each request takes a token | Allowing short bursts but capping the average |

Each is a small Lua script in Redis, so the read-and-update stays atomic.

## 6. Redis Goes Down

:::info Interviewer asks
"Redis is down. What does your middleware do?"
:::

Decide per endpoint, and say it out loud:

| Endpoint | Policy | Why |
|---|---|---|
| Normal API reads | **Fail open** (allow) | An outage of the limiter shouldn't become an outage of the product |
| Login, OTP, password reset | **Fail closed** or fall back to a local, stricter limit | Brute-force protection matters more than availability |

Put a short timeout on the Redis call and a circuit breaker around it, so a slow Redis doesn't add latency to every request.

## 7. Master Interview Answer

:::tip Say this
"The counter lives in one process, so with many servers the real limit is multiplied, and restarts reset it. The read-then-write isn't atomic, old windows are never deleted, and a fixed window lets twice the limit through at the boundary. I'd move counters to Redis with an atomic INCR plus EXPIRE — or a token-bucket Lua script for smoother limits — limit logged-out traffic by IP, return Retry-After headers, and set an explicit fail-open or fail-closed policy per endpoint for when Redis is unavailable."
:::

## 8. The Fixed Code

```python
import time
import redis

r = redis.Redis(socket_timeout=0.05)     # never let the limiter add real latency

def is_allowed(key: str, limit: int = 100, window_s: int = 60):
    window = int(time.time()) // window_s
    redis_key = f"rl:{key}:{window}"

    pipe = r.pipeline(transaction=True)  # MULTI … EXEC: atomic
    pipe.incr(redis_key)
    pipe.expire(redis_key, window_s)
    count, _ = pipe.execute()

    retry_after = window_s - int(time.time()) % window_s
    return count <= limit, max(limit - count, 0), retry_after


FAIL_CLOSED = {"/login", "/otp", "/password-reset"}

@app.before_request
def rate_limit():
    key = f"user:{current_user.id}" if current_user.is_authenticated \
        else f"ip:{request.remote_addr}"
    try:
        allowed, remaining, retry_after = is_allowed(key)
    except redis.RedisError:
        if request.path in FAIL_CLOSED:
            return {"error": "Please try again shortly"}, 503
        return None                       # fail open for everything else

    if not allowed:
        return ({"error": "Too many requests"}, 429,
                {"Retry-After": str(retry_after), "X-RateLimit-Remaining": "0"})
```

**What changed:** shared counters in Redis; atomic `INCR` + `EXPIRE`; per-IP limits for anonymous traffic; `Retry-After`; a fail-open/fail-closed policy with a tight timeout. For smoother limits, swap `is_allowed` for a token-bucket Lua script.

## 9. The Full Learning Escalation

```
Correct 429 responses
    ↓
Shared state across servers
    ↓
Atomic counters
    ↓
TTL / memory
    ↓
Window algorithms
    ↓
Failure policy of the limiter itself
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design a rate limiting service used by every team in the company, with different limits per customer and per endpoint."
:::

That's [Rate Limiter](/learn/system-design/problem-breakdowns/rate-limiter) — rules configuration, where the limiter sits (gateway vs sidecar), and Redis sharding for hot keys. Related: [AI Model API](/learn/system-design/problem-breakdowns/ai-model-api) for token-based quotas.

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Multiple servers / processes | Shared store (Redis) |
| Counter race | Atomic INCR (or Lua) |
| Memory growth | TTL per key |
| Boundary bursts | Sliding window / token bucket |
| Logged-out traffic | Limit by IP or API key |
| Clients don't know when to retry | `Retry-After` header |
| Limiter store down | Fail open (most APIs) / fail closed (auth) + timeout |
