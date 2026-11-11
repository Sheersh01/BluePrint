---
title: Google Calendar
seoTitle: Design a Calendar Service Like Google Calendar
description: Design Google Calendar — creating events and recurring events, inviting attendees, free/busy lookups, time zones, and reminders.
tags: Multi-step Processes
difficulty: medium
author: Editorial Team
published: Nov 10, 2026
askedAt: Google, LinkedIn | 0
---

## Understanding the Problem

:::definition 📅 What is Google Calendar?
Google Calendar lets people schedule events, invite others, see when colleagues are free, and get reminders before events start.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to create, edit and delete events, including recurring events.
2. Users should be able to invite attendees, who can accept or decline.
3. Users should be able to view their calendar for a day, week or month.
4. Users should receive reminders before events.

**Below the line (out of scope):**

- Room booking and video-call links.
- Calendar sharing permissions beyond invites.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Calendar views should load in < 200ms.
2. Strong consistency for a user's own edits (read-your-writes); invitee calendars can update within seconds.
3. Reminders must fire on time, reliably, for hundreds of millions of users.
4. Correct handling of time zones and daylight-saving changes.

**Below the line (out of scope):**

- Offline sync conflict resolution.

```sketch Calendar Requirements
Functional
- CRUD events + recurrence
- invites, accept / decline
- day / week / month views
- reminders

Non-functional
- views < 200ms
- read-your-writes
- reminders on time
- time zones + DST
```

## The Set Up

### Defining the Core Entities

1. **Event**: title, start/end (with time zone), organizer, recurrence rule (RRULE), location.
2. **Attendee**: an invite linking a user to an event, with response status.
3. **Event exception**: a modified or cancelled single occurrence of a recurring series.
4. **Reminder**: when to notify a user about an event.

### API or System Interface

```
POST  /events { "title", "start", "end", "timeZone", "rrule": "FREQ=WEEKLY;BYDAY=MO", "attendees": [] }
PATCH /events/:id?scope=THIS|FOLLOWING|ALL
GET   /calendar?from=2026-11-09&to=2026-11-16 -> Occurrence[]
POST  /events/:id/rsvp { "status": "ACCEPTED" }
```

## High-Level Design

### 1) Users should be able to create events, including recurring ones

The **Event Service** stores each event once. A recurring event stores its **recurrence rule** (RFC 5545 RRULE) rather than one row per occurrence — "every Monday forever" can't be materialised. Edits to a single occurrence are stored as **exceptions**.

```diagram Calendar services
node client 0,1 box "Client"
node gw 1.2,1 box "API Gateway"
node ev 2.5,0.3 box "Event Service"
node view 2.5,1.7 box "Calendar View|Service"
node db 3.8,1 circle "Events DB"
note 4.3,0.6 "Event|- id, organizer|- start, end, tz|- rrule|Attendee|- eventId, userId|- status"
edge client <-> gw
edge gw <-> ev "create / edit"
edge gw <-> view "GET /calendar"
edge ev <-> db
edge view <-> db
```

### 2) Users should be able to invite attendees

Creating an event writes an Attendee row for each invitee. Invitations are delivered asynchronously (email + push) via a queue, and each attendee's response updates their row.

### 3) Users should be able to view their calendar

The **Calendar View Service** fetches the user's events that overlap the requested range (their own plus those they're invited to), expands recurring events into concrete occurrences for that window, applies exceptions, and converts times into the viewer's time zone.

### 4) Users should receive reminders

Each reminder is scheduled as a job at `start - offset`. A scheduler (like the one in [Job Scheduler](/learn/system-design/problem-breakdowns/job-scheduler)) fires it and hands it to the notification system.

## Potential Deep Dives

### 1) How do we store and query recurring events efficiently?

:::solution bad Materialise every occurrence
#### Approach

Write a row for every instance of a recurring event.

#### Challenges

Infinite series can't be stored; editing "all future events" means rewriting thousands of rows.
:::

:::solution good Store the rule, expand at read time
#### Approach

Store the RRULE plus exceptions, and expand only within the requested window when rendering.

#### Challenges

To find events overlapping a range, you must know the series' overall span; store a computed `seriesEnd` (or null for infinite) so queries can filter quickly.
:::

:::solution great Rule storage + windowed materialisation cache
#### Approach

Keep the rule as the source of truth, but materialise occurrences for a rolling window (e.g. the next 6 months) into an index table used for fast range and free/busy queries. Re-materialise when the series changes.

#### Challenges

Two representations to keep in sync, but range queries become simple index scans.
:::

### 2) How do we handle time zones correctly?

Store event times as **local time plus an IANA time zone** (e.g. `09:00 America/New_York`), not just UTC. A weekly 9am meeting must stay at 9am local time across daylight-saving changes; storing UTC alone would shift it by an hour twice a year. Convert to the viewer's zone only when rendering.

:::warning
"All-day" events have no time zone — a birthday on March 3 is March 3 everywhere. Treat them as dates, not timestamps.
:::

### 3) How do we answer "when is everyone free?"

Free/busy lookups read each attendee's materialised occurrences for the window from the index, merge their busy intervals, and return the gaps. Cache per-user busy intervals for short periods; they're read far more often than they change.

### Final Design

```diagram Final Design
node client 0,1.2 box "Client"
node gw 1.2,1.2 box "API Gateway"
node ev 2.5,0.2 box "Event Service"
node view 2.5,1.4 box "Calendar View|+ free/busy"
node db 3.8,0.2 circle "Events DB|rules + exceptions"
node occ 3.8,1.5 circle "Occurrence Index|(6-month window)"
node sched 0.3,2.5 box "Reminder Scheduler"
node notif 1.7,2.8 box "Notification Service"
edge client <-> gw
edge gw <-> ev
edge gw <-> view
edge ev <-> db
edge ev -> occ "materialise"
edge view <-> occ
edge ev -> sched
edge sched -> notif
```

```quiz
[
  {
    "question": "Why store a recurrence rule instead of every occurrence?",
    "options": ["It's faster to write", "Series can be infinite and edits would rewrite many rows", "Databases can't store dates", "For encryption"],
    "answer": 1,
    "explanation": "Rules plus exceptions represent any series compactly."
  },
  {
    "question": "How should a weekly 9am meeting be stored to survive DST changes?",
    "options": ["As UTC only", "As local time plus an IANA time zone", "As a Unix timestamp per week", "As a string"],
    "answer": 1,
    "explanation": "Local time + zone keeps the meeting at 9am local year-round."
  },
  {
    "question": "How is a change to one occurrence of a recurring event stored?",
    "options": ["Delete the series", "As an exception linked to the series", "As a new user", "It isn't supported"],
    "answer": 1,
    "explanation": "Exceptions override or cancel individual occurrences."
  },
  {
    "question": "What makes free/busy lookups fast?",
    "options": ["Expanding rules on every request for every attendee", "A materialised occurrence index for a rolling window", "Asking attendees", "Polling"],
    "answer": 1,
    "explanation": "Precomputed occurrences turn free/busy into range scans."
  }
]
```
