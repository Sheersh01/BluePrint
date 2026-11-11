---
title: User Preferences Service
seoTitle: Design the Server-Side System Behind a User Preferences UI
description: Design the backend for a user settings page — a typed preference schema with defaults, per-user overrides, fast reads by every service, cross-device sync, conflict handling, and safe schema evolution.
tags: Scaling Reads
difficulty: easy
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🎛️ What is a User Preferences Service?
Every product has a settings page: theme, language, notification choices, privacy options, default playback quality. Behind it sits a preferences service that stores each user's choices and answers "what is this user's setting for X?" for every other service — often on every request. The UI is simple; the backend has to be fast, consistent across devices, and easy for many teams to extend.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view and change their preferences in a settings UI on any device.
2. Each preference has a type, allowed values and a default; users only store overrides.
3. Other services (notifications, feed, emails) should read a user's preferences quickly.
4. Changes should apply across all the user's devices within seconds.
5. Product teams should be able to add new preferences without database migrations.

**Below the line (out of scope):**

- Organisation-level policies that override users (mentioned briefly).
- Feature flags and experiments (a related but separate system).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Reads are extremely frequent (~1M/s across services) and must take < 5 ms.
2. A user's own change is visible to them immediately (read-your-writes).
3. Highly available: if the service is down, callers fall back to defaults rather than failing.
4. Some preferences are legally significant (marketing consent), so changes are audited.

**Below the line (out of scope):**

- Strong global consistency for other users' views of a preference.

```sketch Preferences Requirements
Functional
- view + change settings anywhere
- typed schema with defaults
- fast reads for other services
- sync across devices
- new prefs without migrations

Non-functional
- ~1M reads/s, < 5ms
- read-your-writes
- fall back to defaults
- audited consent changes
```

## The Set Up

### Defining the Core Entities

1. **Preference definition**: key (`notifications.email.marketing`), type, allowed values, default, owner team, sensitivity.
2. **User preferences**: user ID → map of overridden keys and values, plus a version number.
3. **Change record**: who changed what, from and to, when, from which device.

### API or System Interface

```
GET   /me/preferences -> { values (defaults merged), version }
PATCH /me/preferences { changes: { key: value }, baseVersion }
(internal) GET /users/:id/preferences?keys=a,b,c        (low latency)
(internal) event: preferences.changed { userId, keys, version }
GET   /preference-schema -> definitions for building the settings UI
```

## High-Level Design

### 1) A schema registry for preferences

Teams register preference **definitions** in a schema registry (in code or config, reviewed like code). The settings UI is rendered from the schema, so a new preference appears without frontend work, and the API validates every write against it.

### 2) Storing only overrides

Each user's record is a small document of **overrides** keyed by user ID in a key-value store (DynamoDB/Cassandra). Reading merges overrides over defaults. Storing only overrides means changing a default applies to everyone who hasn't chosen otherwise, and new preferences need no data migration.

```diagram Read path
node svc 0,1 box "Other Services"
node client 1.6,1 box "Client Library|local cache"
node api 3.2,1 box "Preferences API"
node cache 3.2,-0.3 circle "Cache"
node kv 4.8,1 circle "Overrides KV"
node schema 4.8,-0.3 circle "Schema Registry"
edge svc <-> client
edge client <-> api "miss"
edge api <-> cache
edge api <-> kv
edge api <-> schema "defaults"
```

### 3) Fast reads for other services

Services read through a **client library** that caches each user's merged preferences in memory for a short TTL and listens for `preferences.changed` events to invalidate. If the service can't be reached, the library returns the **defaults** from a bundled copy of the schema.

### 4) Cross-device sync

A write increments the record's **version** and publishes a change event. The user's other devices receive a push (or refetch on focus) and update. The writing device applies the change immediately and reads back from the primary, giving read-your-writes.

## Potential Deep Dives

### 1) How do we handle two devices changing settings at once?

:::solution bad Overwrite the whole document
#### Approach

Each device sends its full preference set; the latest write replaces the record.

#### Challenges

Changing the theme on a phone while a laptop changes the language loses one of the changes.
:::

:::solution good Per-key patches
#### Approach

Send only the changed keys and merge them into the stored document.

#### Challenges

Two devices changing the *same* key race silently.
:::

:::solution great Per-key patches with versions
#### Approach

Patches include the client's **base version**; the server applies non-conflicting keys and, for the same key changed since that version, uses **last-writer-wins per key** with server timestamps (fine for settings) and returns the new full state so the client refreshes. For a few keys where conflicts matter, reject with `409` and let the UI ask the user.

#### Challenges

Keep the policy simple — for settings, per-key LWW is almost always what users expect.
:::

### 2) How do we handle ~1M reads per second?

Most reads come from backend services, not the settings UI. In-process caching in the client library absorbs most traffic, a distributed cache absorbs the rest, and the key-value store handles misses with single-key lookups. Change events invalidate caches promptly, so TTLs can be long-ish (minutes) without serving stale values for long.

:::tip
Mention the safe-default rule: when in doubt (service down, unknown key), behave as the privacy-safe default — for example, treat marketing consent as "no".
:::

### 3) How do we evolve preferences safely?

Definitions are **versioned**: renaming a key is done by adding a new key with a migration that reads the old value on access, then retiring the old one. Removing a preference stops it showing in the UI while ignoring stored values. Sensitive preferences (consent, privacy) record every change in an **audit log** with timestamp and source, which is needed for regulations like GDPR.

### Final Design

```diagram Final Design
node ui 0,1 box "Settings UI"
node svc 0,-0.3 box "Backend Services|+ client lib"
node api 1.5,1 box "Preferences API|validate + merge"
node schema 1.5,-0.3 circle "Schema Registry"
node kv 3,1 circle "Overrides KV"
node cache 3,-0.3 circle "Cache"
node bus 4.5,1 box "Change Events"
node devices 6,1 box "Other Devices"
node audit 3,2.3 circle "Audit Log"
edge ui <-> api
edge svc <-> api
edge api <-> schema
edge api <-> kv
edge api <-> cache
edge kv -> bus
edge bus -> devices
edge api -> audit
```

```quiz
[
  {
    "question": "Why store only overrides rather than every preference per user?",
    "options": ["It's harder", "Changing a default applies to everyone and new preferences need no migration", "Overrides are encrypted", "Databases require it"],
    "answer": 1,
    "explanation": "Defaults live in the schema; users store only their choices."
  },
  {
    "question": "What should a service do if the preferences service is down?",
    "options": ["Fail the request", "Use defaults from the bundled schema", "Retry forever", "Use another user's settings"],
    "answer": 1,
    "explanation": "Preferences must never become a single point of failure."
  },
  {
    "question": "How do we avoid losing one of two concurrent changes to different settings?",
    "options": ["Overwrite the document", "Send per-key patches that merge", "Lock the user account", "Ignore the second change"],
    "answer": 1,
    "explanation": "Only changed keys are applied."
  },
  {
    "question": "Why audit consent preferences?",
    "options": ["For speed", "Regulations require proof of when and how consent was given or withdrawn", "To show in the UI", "It's free"],
    "answer": 1,
    "explanation": "Consent changes have legal significance."
  }
]
```
