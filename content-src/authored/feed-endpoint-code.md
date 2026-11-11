---
title: Feed Endpoint
subtitle: A home-feed endpoint that's fine with 10 test users and falls over with real ones. Count the queries, then fix them.
section: code-review
category: Code Review
seoTitle: Code Review Interview — Fix N+1 Queries and Pagination in a Feed Endpoint
description: A code-review interview question — a Python feed endpoint with N+1 queries, in-memory sorting, unbounded page sizes and offset pagination, and how to fix it with joins, cursors and denormalized counts.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info Core focus
N+1 queries, doing work in the database instead of in Python, limits and indexes, cursor pagination, denormalized counters, authorization.
:::

## Quick Reference (Learn This First)

| Problem | Wrong Instinct | Correct Solution |
|---|---|---|
| One query per followee / per post | Add a cache in front | **Batch: one query with `IN` / `JOIN`** |
| Loads every post, then slices in Python | Faster server | **`ORDER BY … LIMIT` in SQL, with an index** |
| Client chooses `page_size=100000` | Trust the client | **Cap the page size** |
| Items repeat or vanish while scrolling | Ignore it | **Cursor (keyset) pagination** |
| `COUNT(*)` of likes per post per request | Index the likes table | **Denormalized `like_count` column / counter** |
| `user_id` comes from the query string | — | **Take identity from the session/token** |

**Mental model (decision tree)**

```
Query inside a loop?
        ↓
  Batch it (IN / JOIN)

Sorting or slicing in application code?
        ↓
  ORDER BY + LIMIT in the database

User controls the size?
        ↓
  Cap it

Data changes while paging?
        ↓
  Cursor pagination

Aggregate recomputed on every read?
        ↓
  Store it (counter)
```

## 1. The Starting Point

```python
@app.get("/feed")
def get_feed():
    user_id = request.args["user_id"]
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 20))

    following = db.query(
        "SELECT followee_id FROM follows WHERE follower_id = %s", user_id)

    posts = []
    for f in following:
        posts += db.query("SELECT * FROM posts WHERE author_id = %s", f.followee_id)

    posts.sort(key=lambda p: p.created_at, reverse=True)
    result = posts[(page - 1) * page_size : page * page_size]

    for p in result:
        p.author = db.query_one("SELECT * FROM users WHERE id = %s", p.author_id)
        p.like_count = db.query_one(
            "SELECT COUNT(*) FROM likes WHERE post_id = %s", p.id)[0]

    return [serialize(p) for p in result]
```

## 2. What Most Candidates Catch ✅

### 2.1 Too Many Queries

There's a query inside a loop — "this will be slow". Correct; the next section counts exactly how slow.

### 2.2 `SELECT *`

It fetches every column (including large ones like post bodies or user bios) when the feed needs a few. Select the columns you use.

## 3. What Most Candidates Miss ⚠️

### 3.1 Count the Queries (N+1, Three Times Over)

For a user following 500 accounts, one page of 20 posts:

```
1   query  for follows
500 queries for posts (one per followee)
20  queries for authors
20  queries for like counts
= 541 queries for one page
```

**Fix**: Batch every loop into one query.

### 3.2 Loading Everything to Show 20

The loop loads **every post ever written** by every followee into memory, sorts them in Python, and throws all but 20 away. A user following a few prolific accounts makes the server load hundreds of thousands of rows per request.

**Fix**: Let the database sort and limit: `ORDER BY created_at DESC LIMIT 20`, backed by an index on `(author_id, created_at)`.

### 3.3 The Client Picks the Page Size

`page_size=1000000` is one request away. That's a cheap denial-of-service.

**Fix**: Cap it (e.g. `min(page_size, 50)`).

### 3.4 Offset Pagination on a Live Feed

```
Load page 1 (posts 1–20)
3 new posts are published
Load page 2 (offset 20) → posts 18–37   ← 18, 19, 20 shown twice
```

And `OFFSET 10000` still makes the database walk past 10,000 rows.

**Fix**: Cursor pagination — "give me 20 posts older than the last one I saw".

### 3.5 `COUNT(*)` on Every Read

Counting likes on every feed load scans the likes table for every post, for every user, every time — and viral posts have millions of likes.

**Fix**: Store `like_count` on the post (updated when likes change, or by an async counter), and read it with the post.

### 3.6 Anyone Can Read Anyone's Feed

`user_id` comes from the query string. Change the number, read someone else's feed.

**Fix**: Take the user from the authenticated session or token.

## 4. How Many Queries?

:::info Interviewer asks
"A user follows 2,000 accounts. How many database queries does one page of this endpoint make, and how would you get that down?"
:::

### ⚠️ Common Mistake

"Put a cache in front of it." A cache hides the problem for repeat requests and makes the first one — and every cache miss — just as slow.

### ✅ Correct Answer — Batch, Then Let the Database Do the Work

```sql
SELECT p.id, p.author_id, p.body, p.created_at, p.like_count,
       u.name AS author_name, u.avatar_url
FROM posts p
JOIN follows f ON f.followee_id = p.author_id
JOIN users  u ON u.id = p.author_id
WHERE f.follower_id = %(me)s
  AND (p.created_at, p.id) < (%(cursor_time)s, %(cursor_id)s)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 20;
```

One query, an index on `posts (author_id, created_at)`, and no sorting in Python.

:::tip Say this
"It's an N+1 problem in three places — about 2,000 queries for the posts alone. I'd replace the loops with one query that joins follows, posts and users, sorts and limits in the database using an index on author and time, and reads a stored like count instead of counting per post."
:::

## 5. Pagination

:::info Interviewer asks
"New posts keep arriving while the user scrolls. What goes wrong with page numbers, and what would you use instead?"
:::

Offsets shift as rows are inserted, so items repeat or get skipped, and deep offsets get slower. Use a **cursor**: the client sends back the `(created_at, id)` of the last post it saw, and the next query asks for posts strictly older than that. The `id` breaks ties between posts with the same timestamp.

```
GET /feed?limit=20                     → { posts: [...], next_cursor: "1731300000.123:98765" }
GET /feed?limit=20&cursor=1731300000.123:98765
```

## 6. At Twitter Scale

:::info Interviewer asks
"This works for thousands of users. What changes for 200 million?"
:::

Joining across everyone you follow on every read stops scaling when users follow thousands of accounts and read far more than they write. The standard answer is to **precompute feeds**: when someone posts, push the post id into each follower's feed list (fan-out on write), and pull posts from celebrities at read time (fan-out on read) so one celebrity post doesn't trigger 50 million writes. See [FB News Feed](/learn/system-design/problem-breakdowns/fb-news-feed).

## 7. Master Interview Answer

:::tip Say this
"This endpoint has N+1 queries in three places — posts per followee, an author per post and a like count per post — so one page can run hundreds or thousands of queries. It also loads every post into memory to sort and slice in Python, lets the client choose any page size, uses offset pagination that repeats items while new posts arrive, and trusts a user id from the query string. I'd take the user from the session, replace the loops with one joined query that sorts and limits in the database using an index on author and time, store like counts on the post, cap the page size, and use cursor pagination. At large scale I'd move to precomputed feeds with fan-out on write."
:::

## 8. The Fixed Code

```python
from datetime import datetime, timezone

MAX_PAGE_SIZE = 50

@app.get("/feed")
@login_required
def get_feed():
    me = current_user.id                                    # identity from the session
    limit = min(int(request.args.get("limit", 20)), MAX_PAGE_SIZE)
    cursor_time, cursor_id = decode_cursor(request.args.get("cursor"))

    rows = db.query(
        """
        SELECT p.id, p.author_id, p.body, p.created_at, p.like_count,
               u.name AS author_name, u.avatar_url
        FROM posts p
        JOIN follows f ON f.followee_id = p.author_id
        JOIN users  u ON u.id = p.author_id
        WHERE f.follower_id = %s
          AND (p.created_at, p.id) < (%s, %s)
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT %s
        """,
        me, cursor_time, cursor_id, limit + 1)             # one extra row = "has more"

    page, has_more = rows[:limit], len(rows) > limit
    next_cursor = encode_cursor(page[-1].created_at, page[-1].id) if has_more else None
    return {"posts": [serialize(r) for r in page], "next_cursor": next_cursor}


def decode_cursor(raw):
    if not raw:
        return datetime.max, 2**63 - 1                      # start from the newest
    ts, post_id = raw.split(":")
    return datetime.fromtimestamp(float(ts), tz=timezone.utc), int(post_id)
```

**What changed:** identity from the session; one query instead of hundreds; sorting and limiting in SQL (index on `posts(author_id, created_at)`); a stored `like_count`; a capped page size; cursor pagination with a tie-breaker; fetching `limit + 1` rows to know whether there's a next page.

## 9. The Full Learning Escalation

```
SELECT *
    ↓
N+1 queries
    ↓
Sort / limit in the database + indexes
    ↓
Caps on client input
    ↓
Cursor pagination
    ↓
Denormalized counters
    ↓
Precomputed feeds (fan-out)
```

## 10. Next Challenge — HLD

:::info Interviewer asks
"Design the home timeline for Twitter."
:::

See [Twitter](/learn/system-design/problem-breakdowns/twitter) and [FB News Feed](/learn/system-design/problem-breakdowns/fb-news-feed), plus [Like Counter](/learn/system-design/problem-breakdowns/like-counter) for counting at scale.

## Appendix: Problem → Solution Cheat Sheet

| Problem | Solution |
|---|---|
| Query in a loop (N+1) | One batched query (`IN` / `JOIN`) |
| Sorting/slicing in Python | `ORDER BY … LIMIT` + index |
| `SELECT *` | Select needed columns |
| Unbounded page size | Cap it |
| Shifting pages | Cursor (keyset) pagination |
| Count per read | Stored counter |
| `user_id` from the client | Identity from session/token |
| Huge scale | Precomputed feeds, fan-out on write/read |
