---
title: Telemedicine
seoTitle: Design a Telemedicine Platform
description: Design a telemedicine platform — provider scheduling and booking, virtual waiting rooms, secure video visits, clinical notes and prescriptions, and HIPAA-grade security and auditing.
tags: Dealing with Contention, Real-time Updates
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🩺 What is a Telemedicine Platform?
A telemedicine platform (Teladoc, Practo, Doxy.me) lets patients book and attend medical appointments by video. It combines a booking system, a video call service, and a lightweight medical record: visit notes, prescriptions and documents. Because it handles health data, privacy, security and audit trails are core requirements, not extras.
:::

### Functional Requirements

**Core Requirements**

1. Patients should be able to find providers by specialty and book an available time slot.
2. Patients should join a virtual waiting room and then a secure video visit with the provider.
3. Providers should be able to write visit notes and send prescriptions electronically.
4. Patients should be able to see their visit history, notes and prescriptions.

**Below the line (out of scope):**

- Insurance claims and billing.
- Lab orders and integrations with hospital EHR systems (mentioned briefly).
- On-demand urgent care queues.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Security and privacy: health data encrypted in transit and at rest, strict access control, full audit logging (HIPAA/GDPR).
2. A time slot can never be double-booked.
3. Video calls with low latency (< 300 ms) and good quality on weak connections.
4. High availability during clinic hours; a failed call must be recoverable quickly.

**Below the line (out of scope):**

- Massive scale — ~100k visits per day is a large platform.

```sketch Telemedicine Requirements
Functional
- find providers, book slots
- waiting room + video visit
- notes + e-prescriptions
- patient history

Non-functional
- HIPAA-grade security + audits
- no double booking
- low-latency video
- available during clinic hours
```

## The Set Up

### Defining the Core Entities

1. **Provider**: specialty, licences (by state/country), schedule, timezone.
2. **Patient**: identity, demographics, consent records.
3. **Slot**: provider, start, end, status (`open`, `held`, `booked`).
4. **Appointment**: patient, provider, slot, status, video room ID.
5. **Clinical record**: visit notes, prescriptions, attachments — owned by the patient's chart.

### API or System Interface

```
GET  /providers?specialty=&state=&date= -> providers with open slots
POST /appointments { slotId, patientId, reason, idempotencyKey }
POST /appointments/:id/join -> { roomToken, iceServers }
POST /appointments/:id/notes { soapNote }
POST /prescriptions { appointmentId, medication, dose, pharmacyId }
GET  /patients/me/records
```

## High-Level Design

### 1) Finding providers and booking

Providers publish recurring availability, which is expanded into **slots**. Search filters providers by specialty and **licence jurisdiction** (a provider can only treat patients located where they're licensed). Booking atomically changes the slot from `open` to `booked` and creates the appointment.

### 2) Waiting room and video visit

At visit time, the patient opens the appointment and enters a **waiting room** (a presence channel over WebSocket); the provider sees who's waiting and admits them. Both sides get a short-lived **room token** and connect with **WebRTC**. For one-to-one calls, media flows peer-to-peer when possible, via a **TURN relay** when firewalls block it, or through an **SFU** for multi-party visits (interpreter, family member).

```diagram Visit
node patient 0,1 box "Patient App"
node api 1.6,1 box "Appointment Service"
node room 1.6,-0.3 box "Waiting Room|presence (WS)"
node signal 3.2,-0.3 box "Signalling"
node media 3.2,2.3 box "TURN / SFU"
node provider 4.8,1 box "Provider App"
edge patient <-> api
edge patient <-> room
edge room <-> signal
edge patient <-> media "WebRTC media"
edge media <-> provider
```

### 3) Notes and prescriptions

Providers write structured visit notes (SOAP format) during or after the call; notes are **signed and locked**, with later changes made as addenda. Prescriptions are sent to the patient's pharmacy through an **e-prescribing network** integration, with status tracked asynchronously.

### 4) Patient records

The patient's chart aggregates visits, notes and prescriptions. Reads go through an **authorization layer** that checks the relationship (patient themselves, treating provider, delegated caregiver) and logs every access.

## Potential Deep Dives

### 1) How do we prevent double booking?

:::solution bad Check then insert
#### Approach

Check the slot is open, then create the appointment.

#### Challenges

Two patients booking the last afternoon slot simultaneously both succeed.
:::

:::solution good Conditional update
#### Approach

`UPDATE slots SET status = 'booked', patient = ? WHERE id = ? AND status = 'open'`, in the same transaction as inserting the appointment.

#### Challenges

Patients filling in intake forms may lose the slot halfway through.
:::

:::solution great Short holds with expiry
#### Approach

When a patient starts booking, place a **hold** (`status = 'held'`, `heldUntil = now + 5 min`) with the conditional update; confirm it when intake completes. A sweeper (or a check on read) releases expired holds. Idempotency keys make retries safe, and a unique constraint on `(providerId, start)` for booked appointments backs it up.

#### Challenges

Holds briefly hide slots from others, so keep the window short.
:::

### 2) How do we meet HIPAA-grade security?

Encrypt everything in transit (TLS, SRTP for media) and at rest with keys in a KMS. Use **least-privilege access** with role- and relationship-based checks on every record read, and write an **immutable audit log** of who accessed what and when. Keep health data in dedicated, segregated stores; never put it in logs, analytics or push notification text ("You have a new message" rather than the diagnosis). Sign Business Associate Agreements with any vendor (video, SMS) that touches health data.

:::tip
Mention data residency: some countries require health data to stay in-country, so deploy regional stacks with region-pinned storage.
:::

### 3) What happens when a call drops?

WebRTC connections monitor quality; clients reduce video resolution under poor bandwidth and fall back to **audio-only** before dropping. If the connection fails, both clients automatically rejoin the same room with their still-valid token. A **phone dial-in** fallback lets the visit continue by audio over the phone network.

### Final Design

```diagram Final Design
node patient 0,1 box "Patient App"
node gw 1.4,1 box "API Gateway|auth + audit"
node appt 2.8,-0.3 box "Scheduling Service"
node sdb 4.2,-0.3 circle "Slots DB"
node video 2.8,1 box "Video Service|signalling · TURN · SFU"
node rec 2.8,2.3 box "Records Service"
node ehr 4.2,2.3 circle "Encrypted Records"
node erx 2.8,3.5 box "e-Prescribing"
node audit 1.4,2.3 circle "Audit Log"
node provider 5.6,1 box "Provider App"
edge patient <-> gw
edge gw <-> appt
edge appt <-> sdb
edge gw <-> video
edge gw <-> rec
edge rec <-> ehr
edge rec -> erx
edge video <-> provider
edge gw -> audit
```

```quiz
[
  {
    "question": "How do we prevent two patients booking the same slot?",
    "options": ["Show fewer slots", "A conditional update from open/held to booked", "Ask the provider", "Refresh the page"],
    "answer": 1,
    "explanation": "The database guarantees only one booking succeeds."
  },
  {
    "question": "Why use a TURN server in a video visit?",
    "options": ["To record calls", "To relay media when firewalls block peer-to-peer connections", "To encrypt notes", "To book slots"],
    "answer": 1,
    "explanation": "TURN keeps calls working on restrictive networks."
  },
  {
    "question": "Why shouldn't push notifications include diagnoses?",
    "options": ["They're too long", "Notification content can appear on lock screens and pass through third parties", "Phones can't show medical words", "It's slower"],
    "answer": 1,
    "explanation": "Minimise exposure of protected health information."
  },
  {
    "question": "Why are signed visit notes changed only through addenda?",
    "options": ["To save storage", "To keep an accurate, auditable medical record", "Editors are expensive", "Notes can't be edited technically"],
    "answer": 1,
    "explanation": "Medical records must show what was known and recorded at the time."
  }
]
```
