---
title: Retrying an External API
subtitle: Two helper functions that call third-party APIs "with retries". One can hang forever; the other can pay someone five times.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix Unsafe Retries Around an External API
description: A code-review interview question — Python helpers that retry external API calls with no timeout, no backoff, retries on bad requests and non-idempotent POSTs, and how to fix them.
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
Timeouts, which errors are retryable, exponential backoff with jitter, retry budgets, idempotency for writes, circuit breakers.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| A call hangs forever | Retry more | **Connect + read timeouts on every call** |
| Retrying errors that will never succeed | Retry everything | **Retry only timeouts, connection errors, 5xx, 429** |
| All clients retry in sync | Sleep 1 s | **Exponential backoff + jitter** |
| Retries never stop | `while True` | **Max attempts and an overall deadline** |
| Retrying a payout pays twice | Fewer retries | **Idempotency key on the POST** |
| A dependency is down for minutes | Keep retrying | **Circuit breaker + fallback** |

**Mental model (decision tree)**

```
Network call?
        ↓
  Timeout, always

It failed — will retrying help?
        ↓
  Only for transient errors (timeout, 5xx, 429)

How often?
        ↓
  Exponential backoff + jitter, bounded

Does the call change something?
        ↓
  Idempotency key (or don't retry)

Failing for a long time?
        ↓
  Circuit breaker
```

## 1. The Starting Point

```python
import time
import requests

def get_exchange_rate(currency):
    while True:
        try:
            resp = requests.get(f"https://rates.example.com/v1/rates/{currency}")
            return resp.json()["rate"]
        except Exception:
            time.sleep(1)


def send_payout(account_id, amount):
    for attempt in range(5):
        try:
            resp = requests.post("https://payouts.example.com/v1/payouts",
                                 json={"account": account_id, "amount": amount})
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        time.sleep(1)
    raise Exception("Payout failed")
```

## 2. What Most Candidates Catch ✅

### 2.1 `while True` Never Gives Up

If the rates service is down for an hour, every request that calls `get_exchange_rate` hangs for an hour, tying up a worker each.

**Fix**: Bound the attempts and the total time.

### 2.2 `except Exception` Hides Bugs

A typo, a `KeyError` because the response format changed, or a `TypeError` in our own code is silently retried forever instead of surfacing as an error.

**Fix**: Catch the specific network exceptions you mean to retry.

## 3. What Most Candidates Miss ⚠️

### 3.1 No Timeout at All

`requests` has **no default timeout**. A server that accepts the connection and never responds blocks the call forever — retries never even start.

**Fix**: `timeout=(connect, read)` on every call, e.g. `(2, 5)`.

### 3.2 Retrying Things That Will Never Work

`send_payout` retries any non-200: a `400 Invalid account` or `401 Unauthorized` is retried five times and will fail five times.

| Response | Retry? |
|---|---|
| Timeout / connection error | Yes (but see 3.4 for POSTs) |
| 500, 502, 503, 504 | Yes |
| 429 Too Many Requests | Yes, after `Retry-After` |
| 400, 401, 403, 404, 409, 422 | **No** — fix the request |

### 3.3 Synchronized Retries

Every client sleeps exactly 1 second, so after an outage they all retry at the same moment — a thundering herd that can knock the recovering service over again.

**Fix**: Exponential backoff (0.2 s, 0.4 s, 0.8 s…) with random jitter.

### 3.4 Retrying a Payout Can Pay Twice

```
POST /payouts  → payout created ✅ → response lost (timeout)
POST /payouts  → second payout created ✅
```

**Fix**: Send an `Idempotency-Key` that stays the same across retries of the same payout, so the provider returns the first result instead of paying again. If the provider doesn't support idempotency, don't blindly retry: query the payout status first.

### 3.5 `resp.json()` on an Error Page

A 502 from a proxy returns HTML; `.json()` raises, the broad `except` swallows it, and the real cause (the 502) is lost.

**Fix**: Check the status code before parsing; log what actually happened.

### 3.6 The Exchange Rate Doesn't Need a Live Call Every Time

Rates change slowly. Calling the API per request multiplies load and latency.

**Fix**: Cache the rate for a short time (say 60 s) and fall back to the last known value if the provider is down, if the business allows it.

## 4. Which Errors Should Be Retried?

:::info Interviewer asks
"Your retry wrapper retries on any failure. What's wrong with that?"
:::

### ⚠️ Common Mistake

"Retries make the system more reliable, so retry everything." Retrying permanent errors wastes time, multiplies load during outages, and delays the real error.

### ✅ Correct Answer

Retry only **transient** failures — timeouts, connection resets, 5xx, 429 — with backoff, and fail fast on client errors.

:::tip Say this
"I'd retry only transient errors — timeouts, connection failures, 5xx and 429 — with exponential backoff and jitter, a maximum number of attempts and an overall deadline. Client errors like 400 or 401 won't succeed on retry, so I'd fail fast and surface them."
:::

## 5. Retrying Writes

:::info Interviewer asks
"The payout request timed out. Is it safe to retry?"
:::

Only if the request is idempotent. A timeout means **unknown** — the payout may have been created.

```
payout_id = "PO-8231"   (generated by us, before the first attempt)

POST /payouts  Idempotency-Key: PO-8231   → timeout
POST /payouts  Idempotency-Key: PO-8231   → 200, the original payout (not a new one)
```

:::tip Say this
"A timeout on a write means the outcome is unknown. I generate the payout id before the first attempt and send it as an idempotency key, so a retry returns the original result instead of paying twice. If the provider doesn't support that, I query the payout's status before deciding to retry, and reconcile anything still unknown."
:::

## 6. The Provider Is Down for 20 Minutes

:::info Interviewer asks
"The rates provider is down for 20 minutes. What happens to our service with your retry logic?"
:::

Every request spends its full retry budget waiting on a dead dependency, so latency spikes and workers pile up. Add a **circuit breaker**: after N consecutive failures, stop calling the provider for a cool-down period and fail immediately (or serve the cached rate), then let a single trial request through to see whether it has recovered.

## 7. Master Interview Answer

:::tip Say this
"Neither call has a timeout, so a hung server blocks forever. The rate fetch retries forever and the payout retries every non-200, including errors that can never succeed. Both catch every exception, which hides bugs, and both sleep a fixed second, so clients retry in lockstep. Worst of all, the payout POST is retried without an idempotency key, so a lost response can pay someone twice. I'd add connect and read timeouts, retry only transient errors with exponential backoff and jitter under an attempt and time budget, send an idempotency key with the payout, cache the exchange rate, and put a circuit breaker around each provider."
:::

## 8. The Fixed Code

```python
import random
import time
import uuid
import requests

TIMEOUT = (2, 5)                              # connect, read (seconds)
RETRYABLE_STATUS = {429, 500, 502, 503, 504}

def call_with_retries(method, url, *, max_attempts=4, deadline_s=10, **kwargs):
    start = time.monotonic()
    for attempt in range(1, max_attempts + 1):
        try:
            resp = requests.request(method, url, timeout=TIMEOUT, **kwargs)
            if resp.status_code not in RETRYABLE_STATUS:
                resp.raise_for_status()       # 4xx → raise immediately, no retry
                return resp
            retry_after = float(resp.headers.get("Retry-After", 0))
        except (requests.ConnectionError, requests.Timeout):
            retry_after = 0
        if attempt == max_attempts or time.monotonic() - start > deadline_s:
            raise ProviderUnavailable(url)
        backoff = min(0.2 * 2 ** attempt, 3.0)
        time.sleep(max(retry_after, random.uniform(0, backoff)))   # full jitter


@cached(ttl_s=60)                             # rates change slowly
@circuit_breaker(name="rates", failure_threshold=5, reset_after_s=30)
def get_exchange_rate(currency):
    resp = call_with_retries("GET", f"https://rates.example.com/v1/rates/{currency}")
    return resp.json()["rate"]


def send_payout(account_id, amount, payout_id=None):
    payout_id = payout_id or str(uuid.uuid4())   # stored with our record before calling
    resp = call_with_retries(
        "POST", "https://payouts.example.com/v1/payouts",
        json={"account": account_id, "amount": str(amount)},
        headers={"Idempotency-Key": payout_id})
    return resp.json()
```

**What changed:** timeouts on every call; retries only for transient errors; exponential backoff with jitter; attempt and time limits; `Retry-After` respected; an idempotency key on the payout; caching and a circuit breaker for the rates provider; money sent as a string, not a float.

## 9. The Full Learning Escalation

```
Infinite loop / broad except
    ↓
Timeouts
    ↓
Retryable vs permanent errors
    ↓
Backoff + jitter
    ↓
Idempotent writes ("timeout = unknown")
    ↓
Circuit breakers + caching
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design the payouts system that sits behind this API — it must never pay anyone twice."
:::

See [Payment System](/learn/system-design/problem-breakdowns/payment-system), [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios) and the [API Design Cheat Sheet](/learn/system-design/tips/api-design-cheat-sheet).

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Hangs forever | Connect + read timeouts |
| Retries forever | Max attempts + deadline |
| Hides bugs | Catch only network exceptions |
| Retries 4xx | Retry only timeouts, 5xx, 429 |
| Thundering herd | Exponential backoff + jitter |
| Duplicate writes | Idempotency key / status query |
| Long outage | Circuit breaker + cached fallback |
