---
title: Multi-step Processes
subtitle: Coordinating workflows that span services, external systems and long waits — sagas, orchestration, and durable execution.
section: patterns
category: Patterns
author: Editorial Team
published: Nov 4, 2026
---

Placing an order means charging a card, reserving inventory, booking shipping and sending an email — four systems, any of which can fail, time out, or take days. A ride request waits for a human driver to accept. A payment waits for a bank. These are **multi-step processes**, and the hard part isn't the happy path; it's guaranteeing the process always finishes in a consistent state.

## The Problem

A naive implementation chains calls in one request handler:

```
function placeOrder(order):
    charge(order)            // succeeds
    reserveInventory(order)  // server crashes here
    requestShipment(order)
```

If the server crashes after charging but before reserving, the customer has paid for nothing. Retrying the whole function charges them twice. There's no distributed transaction spanning Stripe, your inventory database and FedEx — you need a different approach.

## The Solution

:::solution bad Do it all in one request with try/catch
#### Approach

Call each step in sequence and attempt cleanup in a `catch`.

#### Challenges

A crash skips the `catch` entirely. Long waits (a driver accepting) can't fit in a request. There's no record of how far you got.
:::

:::solution good Choreography with events
#### Approach

Each service performs its step and emits an event (`PaymentCompleted`) that triggers the next service (`Inventory` listens and reserves). Failures emit events that trigger **compensating actions** (refund the payment).

#### Challenges

Simple for two or three steps, but the overall flow lives nowhere — it's scattered across services, hard to visualise, debug or change.
:::

:::solution great Orchestrated saga with durable state
#### Approach

A central **orchestrator** owns the workflow as an explicit state machine persisted in a database: `CHARGED → RESERVED → SHIPPED`. It invokes each step, records the result, and on failure runs compensations in reverse order. If the orchestrator crashes, it reloads state and resumes. Every step is idempotent so retries are safe.

#### Challenges

You build and operate the orchestrator, including timers, retries and versioning of in-flight workflows.
:::

:::solution great Durable execution engines (Temporal, Step Functions)
#### Approach

Write the workflow as ordinary code; the engine persists every step's result in an event history and replays it after a crash, so the function effectively never dies. It provides retries, timers ("wait 3 days"), signals (a driver accepted) and visibility out of the box.

#### Challenges

Workflow code must be deterministic, and you take on a new piece of infrastructure — usually worth it once workflows are long-lived or have many steps.
:::

```diagram Orchestrated order saga
node orch 2,1 box "Order Orchestrator|- persisted state"
node pay 0.5,0 box "Payment Service"
node inv 0.5,2 box "Inventory Service"
node ship 3.6,0 box "Shipping Service"
node mail 3.6,2 box "Email Service"
node db 2,2.3 circle "Workflow State"
edge orch <-> pay "1. charge|(refund on fail)"
edge orch <-> inv "2. reserve"
edge orch <-> ship "3. ship"
edge orch -> mail "4. confirm"
edge orch <-> db
```

## When to Use in Interviews

- [Uber](/learn/system-design/problem-breakdowns/uber) — matching waits for a driver to accept, with timeouts and retries.
- [Payment System](/learn/system-design/problem-breakdowns/payment-system) — charges that span processors and banks.
- [Robinhood](/learn/system-design/problem-breakdowns/robinhood) — orders submitted to an external exchange.
- [Online Auction](/learn/system-design/problem-breakdowns/online-auction) — closing an auction and notifying the winner.

## Common Deep Dives

### How do you make each step safe to retry?

Pass an idempotency key (usually the workflow ID plus step name) to every downstream call, and have services return the original result for repeated keys. Retries become free.

### How do you handle human-in-the-loop waits?

Persist the workflow in a waiting state with a timer. A signal (driver accepted) resumes it; the timer firing (no answer in 10 seconds) moves it to the next driver. Never hold a thread or request open while waiting.

### What happens to in-flight workflows when you deploy new code?

Version workflow definitions. Running instances continue on the old version (or a migration path), while new instances use the new one — otherwise replays or state transitions may break.

## Conclusion

Model the process explicitly, persist its state after every step, make every step idempotent, and define compensations for failure. For anything long-lived or complex, a durable execution engine removes most of the plumbing.

```quiz
[
  {
    "question": "Why can't a single request handler reliably run a multi-step process?",
    "options": ["Handlers are too slow", "A crash mid-way leaves partial work with no record of progress", "HTTP doesn't allow multiple calls", "It uses too much memory"],
    "answer": 1,
    "explanation": "Without durable state, you can't resume or compensate after a crash."
  },
  {
    "question": "What is a compensating action?",
    "options": ["A retry", "A step that undoes an earlier completed step, like a refund", "A cache refresh", "A database index"],
    "answer": 1,
    "explanation": "Sagas restore consistency by reversing completed steps when a later one fails."
  },
  {
    "question": "What is the main drawback of event choreography for complex flows?",
    "options": ["It's too centralised", "The overall flow is scattered across services and hard to reason about", "It requires a database per step", "It can't handle failures"],
    "answer": 1,
    "explanation": "Orchestration makes the workflow explicit in one place."
  },
  {
    "question": "Why must Temporal workflow code be deterministic?",
    "options": ["For security", "The engine replays history to rebuild state after failures", "To reduce cost", "It runs on GPUs"],
    "answer": 1,
    "explanation": "Replay must make the same decisions to reach the same state."
  }
]
```
