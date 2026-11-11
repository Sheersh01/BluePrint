---
title: Login Endpoint
subtitle: A twelve-line login handler with at least six security holes. Find them in the order an attacker would.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix an Insecure Login Endpoint
description: A code-review interview question — a Python login handler with SQL injection, MD5 passwords, user enumeration, forgeable tokens and no rate limiting, and how to fix each one.
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
SQL injection, password hashing, user enumeration, brute-force protection, session tokens that can't be forged, secure cookies.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| SQL built with an f-string | Escape quotes by hand | **Parameterized queries** |
| Passwords stored as MD5 | SHA-256 | **A slow password hash: Argon2id / bcrypt (salted)** |
| "No account" vs "Wrong password" | Better wording | **One generic error, same status, similar timing** |
| Unlimited attempts | CAPTCHA only | **Rate limit per account and per IP + backoff** |
| Token = base64(user id) | Encrypt it | **Random session id stored server-side, or a signed token with expiry** |
| Token in JS-readable storage | — | **`HttpOnly`, `Secure`, `SameSite` cookie** |

**Mental model (decision tree)**

```
User input in a query?
        ↓
  Parameters, never string formatting

Storing a password?
        ↓
  Slow, salted hash (Argon2id / bcrypt)

Different answers for "no user" and "wrong password"?
        ↓
  One generic response

Can someone try a million passwords?
        ↓
  Rate limits + lockout/backoff

Can a client make up its own token?
        ↓
  Random or signed, with expiry and revocation
```

## 1. The Starting Point

```python
import base64
import hashlib

@app.post("/login")
def login():
    email = request.form["email"]
    password = request.form["password"]

    user = db.query_one(f"SELECT * FROM users WHERE email = '{email}'")
    if user is None:
        return {"error": "No account with that email"}, 404

    if user.password != hashlib.md5(password.encode()).hexdigest():
        return {"error": "Wrong password"}, 401

    token = base64.b64encode(f"{user.id}:{user.email}".encode()).decode()
    return {"token": token}
```

## 2. What Most Candidates Catch ✅

### 2.1 SQL Injection

The email goes straight into the SQL string. An email of `' OR '1'='1' --` logs in as the first user in the table; worse payloads can read or drop data.

**Fix**: Parameterized queries — the driver sends the value separately from the SQL.

### 2.2 MD5 for Passwords

MD5 is fast and unsalted, so leaked hashes are cracked with lookup tables and GPUs in minutes.

**Fix**: A deliberately slow, salted password hash (next section).

## 3. What Most Candidates Miss ⚠️

### 3.1 "Fast and Secure" Is the Wrong Goal for Password Hashes

Replacing MD5 with SHA-256 still lets an attacker try billions of guesses per second. Password hashing must be **slow and salted** on purpose.

**Fix**: Argon2id (or bcrypt / scrypt) via a library, which also handles the salt and constant-time comparison.

### 3.2 User Enumeration

```
404 "No account with that email"   → this email isn't registered
401 "Wrong password"                → this email IS registered
```

Attackers use the difference to build a list of real accounts, then target them.

**Fix**: The same message and status for both cases ("Invalid email or password"), and hash a dummy password when the user doesn't exist so the response time doesn't give it away either.

### 3.3 Unlimited Attempts

Nothing stops a bot from trying 10,000 passwords against one account, or one common password against 10,000 accounts (credential stuffing).

**Fix**: Rate limits per account **and** per IP, progressive delays or temporary lockout, and alerts on spikes. Offer MFA.

### 3.4 The Token Can Be Made Up by Anyone

`base64("42:alice@example.com")` isn't a secret — it's an encoding. Anyone can create a token for user 43. It also never expires and can't be revoked.

**Fix**: A random session id (`secrets.token_urlsafe(32)`) stored server-side with an expiry — or a signed token (JWT) with a short expiry plus refresh tokens. Either way the server can verify it and it ends.

### 3.5 How the Token Reaches the Browser

Returning the token in JSON usually means it ends up in `localStorage`, readable by any injected script (XSS).

**Fix**: Set it as a cookie with `HttpOnly` (no JS access), `Secure` (HTTPS only) and `SameSite=Lax` or `Strict` (CSRF protection).

### 3.6 Smaller Things That Still Matter

- `request.form["email"]` raises a 500 if the field is missing — validate input and return 400.
- Normalize the email (trim, lowercase) so `Alice@x.com` and `alice@x.com` are the same account.
- Never log the password field.
- `SELECT *` pulls the password hash into memory and maybe into logs; select what you need.

## 4. SHA-256 Is Fine, Right?

:::info Interviewer asks
"If MD5 is broken, can we just use SHA-256 for passwords?"
:::

### ⚠️ Common Mistake

"SHA-256 is secure, so yes." SHA-256 is a fine hash for integrity — and that's the problem: it's designed to be fast.

### ✅ Correct Answer

Use a **password hashing function** built to be slow and memory-hard, with a per-password salt: Argon2id, bcrypt or scrypt. Tune the cost so one hash takes tens of milliseconds — invisible to a user, crippling to an attacker trying billions.

:::tip Say this
"General-purpose hashes like SHA-256 are designed to be fast, which helps attackers. I'd use Argon2id or bcrypt through a well-known library — it's deliberately slow and salts each password — and rehash old MD5 passwords the next time each user logs in."
:::

## 5. Migrating Millions of MD5 Passwords

:::info Interviewer asks
"We already have 5 million users with MD5 hashes. How do we move to Argon2 without forcing everyone to reset?"
:::

Two common approaches:

- **Rehash on login:** when a user logs in successfully with their MD5 hash, compute the Argon2 hash from the plain password they just sent and replace the old one. Inactive accounts keep MD5 until they return (or are forced to reset after a deadline).
- **Wrap now:** immediately replace every stored hash with `argon2(md5_hash)`, then verify with `argon2(md5(password))`. Every account is protected today, without waiting for logins.

## 6. Sessions or JWTs?

:::info Interviewer asks
"Should the login return a JWT or a session id?"
:::

| | Server-side session | JWT (signed token) |
|---|---|---|
| Verify | Look up the id (Redis) | Check the signature, no lookup |
| Revoke / log out everywhere | Delete the session — instant | Hard; needs short expiry + a denylist |
| Size | Small random string | Larger; carries claims |
| Good for | Web apps, anything needing instant revocation | Stateless APIs between services |

Either is fine if it can't be forged, expires, and is stored in a secure cookie. Saying *why* you pick one is the point.

## 7. Master Interview Answer

:::tip Say this
"The query is built with an f-string, so it's open to SQL injection. Passwords are unsalted MD5, which cracks in minutes. The two different error messages let attackers enumerate accounts, nothing limits login attempts, and the token is just base64 of the user id, so anyone can forge one and it never expires. I'd use parameterized queries, Argon2id or bcrypt with rehash-on-login for old passwords, one generic error with similar timing, rate limits per account and IP, and a random session id stored server-side with an expiry, sent as an HttpOnly, Secure, SameSite cookie."
:::

## 8. The Fixed Code

```python
import secrets
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

ph = PasswordHasher()                                 # Argon2id with sane defaults
DUMMY_HASH = ph.hash("not-a-real-password")   # same timing for unknown emails
SESSION_TTL_S = 60 * 60 * 24 * 7
GENERIC_ERROR = ({"error": "Invalid email or password"}, 401)

@app.post("/login")
@rate_limit(per_ip="20/minute",
            per_key=lambda: normalized_email(), key_limit="5/minute")
def login():
    email = normalized_email()
    password = request.form.get("password", "")
    if not email or not password:
        return {"error": "Email and password are required"}, 400

    user = db.query_one(
        "SELECT id, password_hash FROM users WHERE email = %s", email)   # parameterized

    try:
        ph.verify(user.password_hash if user else DUMMY_HASH, password)
    except VerifyMismatchError:
        return GENERIC_ERROR
    if user is None:
        return GENERIC_ERROR

    if ph.check_needs_rehash(user.password_hash):     # e.g. after raising the cost
        db.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                   ph.hash(password), user.id)

    session_id = secrets.token_urlsafe(32)            # unguessable
    redis.set(f"session:{session_id}", user.id, ex=SESSION_TTL_S)

    resp = make_response({"status": "ok"})
    resp.set_cookie("session", session_id, max_age=SESSION_TTL_S,
                    httponly=True, secure=True, samesite="Lax")
    return resp


def normalized_email():
    return request.form.get("email", "").strip().lower()
```

**What changed:** parameterized query; Argon2id with automatic salting and constant-time verify; a dummy hash so unknown emails take the same time; one generic error; rate limits per IP and per account; a random, expiring, revocable session in an `HttpOnly`, `Secure`, `SameSite` cookie; input validation and email normalization.

## 9. The Full Learning Escalation

```
SQL injection
    ↓
Password hashing (slow + salted)
    ↓
User enumeration (messages + timing)
    ↓
Brute force / credential stuffing
    ↓
Unforgeable, expiring tokens
    ↓
Cookie security (XSS / CSRF)
    ↓
MFA, account recovery
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design the authentication system for the whole company — web, mobile and service-to-service."
:::

See [Authentication System](/learn/system-design/problem-breakdowns/authentication-system), and [Q76: OAuth 2.0](/learn/system-design/questions/security#q-76) and [Q79: common web vulnerabilities](/learn/system-design/questions/security#q-79) in the Questions bank.

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| SQL injection | Parameterized queries |
| Weak password hashes | Argon2id / bcrypt, rehash on login |
| User enumeration | Generic error + equal timing |
| Brute force | Rate limits per account and IP, backoff, MFA |
| Forgeable token | Random session id or signed token, with expiry |
| Token stolen via XSS | HttpOnly, Secure, SameSite cookie |
| Missing fields → 500 | Validate input → 400 |
