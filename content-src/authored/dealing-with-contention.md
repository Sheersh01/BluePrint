---
title: Dealing with Contention
subtitle: What to do when many users race to change the same thing — locks, atomic updates, optimistic concurrency, and serialising work.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Two people click "Book" on the last concert seat. A thousand bidders hit the same auction in its final second. Ten thousand buyers fight over a flash-sale inventory counter. **Contention** is when concurrent operations compete to modify the same piece of data — and getting it wrong means double bookings, oversold stock and lost updates.

## The Problem

The classic bug is **read-check-write**:

```
remaining = SELECT remaining FROM inventory WHERE id = 1   -- both read 1
if remaining > 0:
    UPDATE inventory SET remaining = remaining - 1           -- both write 0
    create_order()                                            -- two orders!
```

Each request is correct on its own. Interleaved, they both pass the check before either writes. Any time your logic reads a value, decides, and then writes, you have a race unless something makes the sequence atomic.

## The Solution

:::solution good Pessimistic locking
#### Approach

Lock the row before reading it so others wait: `SELECT ... FOR UPDATE` inside a transaction, then check and write, then commit to release the lock.

#### Challenges

Correct and easy to reason about, but contenders queue on the lock. Never hold a database lock across user think-time (like a checkout page) — use a reservation with a TTL instead.
:::

:::solution great Atomic conditional updates
#### Approach

Let the database check and write in one statement:

```
UPDATE inventory SET remaining = remaining - 1
WHERE id = 1 AND remaining > 0;
-- 1 row updated = success, 0 rows = sold out
```

No lock is held across round trips, and losers fail fast.

#### Challenges

Only works when the whole decision fits in a single conditional statement.
:::

:::solution great Optimistic concurrency control (versioning)
#### Approach

Read the row with a `version` column, compute the change, then `UPDATE ... SET ..., version = version + 1 WHERE id = ? AND version = :readVersion`. If zero rows changed, someone else won — re-read and retry.

#### Challenges

Excellent when conflicts are rare. Under heavy contention, retries pile up and waste work.
:::

:::solution great Distributed locks with a TTL
#### Approach

When the contended resource spans systems, or you need to hold it for minutes (a seat during checkout), acquire a lock in Redis with `SET key owner NX EX 600`. The TTL releases it automatically if the user abandons.

#### Challenges

Lock-service failover can grant a lock twice; protect critical writes with **fencing tokens** (a monotonically increasing number checked by the database) and keep the database constraint as the final safety net.
:::

:::solution great Serialise through a single owner
#### Approach

Route all operations for one entity to one place — a queue partition keyed by entity ID, or an actor/owner process — which handles them one at a time. No concurrent writers means no race.

#### Challenges

Throughput per entity is bounded by one consumer, and you need to handle ownership changes safely.
:::

```diagram Choosing a contention strategy
node q 0,1 box "Can the decision be|one conditional|statement?"
node atomic 1.6,0.2 box "Atomic|conditional update"
node rare 1.6,1.8 box "Conflicts rare?"
node occ 3.1,1.2 box "Optimistic|concurrency"
node hold 3.1,2.4 box "Hold for minutes or|across systems?"
node lock 4.6,1.8 box "Distributed lock|+ TTL + fencing"
node pess 4.6,3 box "Pessimistic lock|or single owner"
edge q -> atomic "yes"
edge q -> rare "no"
edge rare -> occ "yes"
edge rare -> hold "no"
edge hold -> lock "yes"
edge hold -> pess "no"
```

## When to Use in Interviews

- [Ticketmaster](/learn/system-design/problem-breakdowns/ticketmaster) — reserving seats without double booking.
- [Online Auction](/learn/system-design/problem-breakdowns/online-auction) — accepting only bids higher than the current max.
- [Flash Sale](/learn/system-design/problem-breakdowns/flash-sale) — never overselling a tiny inventory.
- [Uber](/learn/system-design/problem-breakdowns/uber) — not offering one driver two rides at once.
- [Payment System](/learn/system-design/problem-breakdowns/payment-system) — never charging twice.

## Common Deep Dives

### How do you handle extreme contention on one item?

Filter demand before it reaches the hot row: a waiting room or queue admits requests at a sustainable rate, an in-memory atomic counter (Redis `DECR`) absorbs the burst, and the database records the outcome asynchronously. You can also split the resource into shards (ten counters of 100 units each) to spread the load.

### What about contention across services?

When a single operation spans several databases, there is no shared transaction. Use a saga with compensating actions, or reserve resources with TTLs in each service and confirm them in a final step.

### Why keep a database constraint if you already lock?

Locks can fail in subtle ways (expired TTLs, failovers). A unique constraint or a `CHECK (remaining >= 0)` is cheap insurance that turns a silent data bug into a loud error.

## Conclusion

Spot the read-check-write. Prefer making the decision atomic in the database; reach for optimistic concurrency when conflicts are rare, distributed locks with TTLs when holding resources across time or systems, and a single owner when one entity is extremely hot.

```quiz
[
  {
    "question": "What is the core bug behind most contention problems?",
    "options": ["Slow networks", "A non-atomic read-check-write sequence", "Too many indexes", "Small caches"],
    "answer": 1,
    "explanation": "Concurrent requests read the same state before any of them writes, so all pass the check."
  },
  {
    "question": "When is optimistic concurrency control a good fit?",
    "options": ["When conflicts are rare", "When every request conflicts", "Only for caches", "Never"],
    "answer": 0,
    "explanation": "Version checks avoid locks; retries are cheap only if conflicts are uncommon."
  },
  {
    "question": "Why add a TTL to a distributed lock?",
    "options": ["To make it faster", "So it is released automatically if the holder crashes or abandons", "To encrypt it", "To replicate it"],
    "answer": 1,
    "explanation": "Without a TTL a crashed holder could block the resource forever."
  },
  {
    "question": "What do fencing tokens protect against?",
    "options": ["Network partitions between clients", "A stale lock holder writing after its lock was granted to someone else", "Slow queries", "Cache misses"],
    "answer": 1,
    "explanation": "The storage layer rejects writes carrying an older token than the latest it has seen."
  }
]
```
