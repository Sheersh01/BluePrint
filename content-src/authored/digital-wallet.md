---
title: Digital Wallet
seoTitle: Design a Digital Wallet like PayPal or Venmo
description: Design a digital wallet — balances backed by a double-entry ledger, peer-to-peer transfers, top-ups and withdrawals, idempotency, and reconciliation.
tags: Dealing with Contention, Multi-step Processes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 👛 What is a Digital Wallet?
A digital wallet holds a stored balance for each user and lets them add money from a card or bank account, pay friends or merchants instantly, and withdraw back to their bank. Think PayPal, Venmo or Paytm. Moving money inside the wallet is instant because it's only an internal ledger entry; moving money in or out touches external banking rails.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to view their balance and transaction history.
2. Users should be able to top up from a card or bank account.
3. Users should be able to send money to other users instantly.
4. Users should be able to withdraw to their bank account.

**Below the line (out of scope):**

- Currency conversion.
- Credit products and interest.
- KYC onboarding flows.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Correctness above everything: money is never created, lost or double-spent.
2. Transfers complete in under a second.
3. Strong consistency for balances; history can lag slightly.
4. Scale to ~100M users and ~10k transfers per second at peak.
5. Full audit trail for regulators.

**Below the line (out of scope):**

- Sub-second withdrawals to banks (bank rails are slow by nature).

```sketch Wallet Requirements
Functional
- balance + history
- top up
- instant P2P transfers
- withdraw to bank

Non-functional
- never lose or create money
- transfers < 1s
- strongly consistent balances
- 10k TPS, auditable
```

## The Set Up

### Defining the Core Entities

1. **Account**: a user's wallet, plus internal accounts such as "card settlement" and "bank payouts".
2. **Ledger entry**: an immutable debit or credit to one account.
3. **Transaction**: a group of entries that sum to zero (a transfer debits one account and credits another).
4. **Balance**: the derived sum of an account's entries, stored for fast reads.

### API or System Interface

```
GET  /wallet -> { balance, currency }
GET  /wallet/transactions?cursor=
POST /topups { amount, paymentMethodId, idempotencyKey }
POST /transfers { toUserId, amount, note, idempotencyKey }
POST /withdrawals { amount, bankAccountId, idempotencyKey }
```

## High-Level Design

### 1) Balances and history come from a ledger

Every money movement is recorded in a **double-entry ledger**: each transaction has entries that sum to zero, so money only ever moves between accounts. A user's balance is the sum of their entries; we also store a **balance column** updated in the same database transaction so reads don't sum history.

### 2) Top-ups

The **Wallet Service** creates a pending top-up and charges the card through a **payment processor**. When the processor confirms (synchronously or by webhook), a ledger transaction debits the internal "card settlement" account and credits the user's wallet.

### 3) Instant transfers

A transfer is one database transaction: lock the sender's balance row, check it's sufficient, insert a debit for the sender and a credit for the recipient, update both balances, and commit. Because both sides are internal accounts, it completes in milliseconds.

```diagram Transfer
node app 0,1 box "App"
node wallet 1.6,1 box "Wallet Service"
node ledger 3.2,1 circle "Ledger DB|+ balances"
node pp 1.6,2.3 box "Payment Processor|cards + banks"
edge app <-> wallet "transfer (idempotency key)"
edge wallet <-> ledger "one ACID transaction"
edge wallet <-> pp "top-ups / payouts"
```

### 4) Withdrawals

Withdrawals first move funds from the user's wallet to an internal **"pending payouts"** account (so they can't be spent twice), then a payout job sends them over bank rails. If the bank rejects the payout, a reversing transaction returns the funds.

## Potential Deep Dives

### 1) How do we prevent double spending?

:::solution bad Read balance, then write
#### Approach

Read the balance in the application, check it, then write the new balance.

#### Challenges

Two concurrent transfers both read 100, both pass the check, and the user spends 200.
:::

:::solution good Row lock or conditional update
#### Approach

Inside a transaction, `SELECT ... FOR UPDATE` the sender's balance row, or use a conditional update: `UPDATE balances SET amount = amount - 50 WHERE account = A AND amount >= 50`. Zero rows updated means insufficient funds.

#### Challenges

Correct, but a single very hot account (a big merchant) serialises all its transfers.
:::

:::solution great Conditional updates + idempotency + sub-accounts for hot spots
#### Approach

Use the conditional update with an **idempotency key** stored in the same transaction, so a retried request returns the original result instead of moving money twice. For hot merchant accounts that mostly *receive* money, credit several **sub-accounts** (shards) and sweep them together periodically — credits never need a balance check.

#### Challenges

Sharded accounts need careful reporting so the merchant still sees one balance.
:::

### 2) How do we scale the ledger to 100M users?

Shard the ledger by **account ID**. A transfer between accounts on different shards can no longer be one local transaction, so run it as a **saga**: debit the sender into an internal "in-flight" account on shard A, then credit the recipient on shard B, each step idempotent and retried until done. The in-flight account always shows money that has left but not yet arrived, and it must net to zero once all sagas complete.

:::tip
Say that ledger entries are append-only. Mistakes are fixed with reversing entries, never by editing history — that's what makes the audit trail trustworthy.
:::

### 3) How do we know the books are right?

Run **reconciliation** continuously: the sum of all entries must be zero, stored balances must equal the sum of their entries, and internal settlement accounts must match the payment processor's and bank's reports each day. Any mismatch raises an alert for investigation.

### Final Design

```diagram Final Design
node app 0,1 box "App"
node gw 1.4,1 box "API Gateway|auth · rate limit"
node wallet 2.8,1 box "Wallet Service|idempotency"
node ledger 4.2,1 circle "Ledger Shards"
node saga 2.8,-0.3 box "Saga Worker|cross-shard"
node pp 2.8,2.3 box "Payment Processor"
node history 5.6,-0.3 circle "History Store"
node recon 5.6,2.3 box "Reconciliation"
edge app <-> gw
edge gw <-> wallet
edge wallet <-> ledger
edge wallet -> saga
edge saga <-> ledger
edge wallet <-> pp
edge ledger -> history "CDC"
edge ledger -> recon
```

```quiz
[
  {
    "question": "What's the core rule of a double-entry ledger?",
    "options": ["Every entry is written twice", "Each transaction's entries sum to zero, so money only moves between accounts", "Balances are stored twice", "Only banks can write"],
    "answer": 1,
    "explanation": "Zero-sum transactions make it impossible to create or lose money silently."
  },
  {
    "question": "How do we stop two concurrent transfers spending the same balance?",
    "options": ["Check in the UI", "A conditional update or row lock inside a transaction", "Retry later", "Cache the balance"],
    "answer": 1,
    "explanation": "The database enforces the balance check atomically."
  },
  {
    "question": "What protects against a retried transfer request moving money twice?",
    "options": ["Rate limiting", "An idempotency key stored with the transaction", "TLS", "Shorter timeouts"],
    "answer": 1,
    "explanation": "A repeated key returns the original result."
  },
  {
    "question": "How are mistakes in the ledger corrected?",
    "options": ["Edit the original entry", "Post a reversing transaction", "Delete the row", "Recalculate balances"],
    "answer": 1,
    "explanation": "Append-only history keeps the audit trail intact."
  }
]
```
