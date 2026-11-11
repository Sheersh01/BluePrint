---
title: ATM
seoTitle: Design an ATM System
description: Design an ATM system — card and PIN authentication, the ATM state machine, withdrawals with authorisation holds, cash dispensing and reconciliation, handling network failures mid-transaction, and security.
tags: Dealing with Contention, Multi-step Processes
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🏧 What is an ATM System?
An ATM lets bank customers withdraw cash, check balances and deposit money with a card and PIN. Two systems cooperate: the **ATM machine** (card reader, keypad, cash dispenser, running a state machine) and the bank's **back end** (authentication, accounts, authorisation). The interesting problems are what happens when the network fails mid-withdrawal, or the dispenser jams after the account was already debited. It's often asked as object-oriented design and as a distributed transaction problem.
:::

### Functional Requirements

**Core Requirements**

1. Customers insert a card and enter a PIN to authenticate.
2. Customers can check their balance and withdraw cash (within limits).
3. Customers can deposit cash or cheques.
4. The machine prints or displays a receipt.
5. The bank reconciles each machine's cash and transactions.

**Below the line (out of scope):**

- Cards from other banks via card networks (mentioned briefly).
- Bill payments and transfers.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Correctness: the account is debited exactly once if and only if cash is dispensed.
2. Security: PINs never travel or are stored in plain text; machines resist tampering.
3. Availability: each ATM responds within a few seconds; the bank back end is highly available.
4. Auditability: every step is logged on the machine and at the bank.

**Below the line (out of scope):**

- High throughput (an ATM handles one customer at a time).

```sketch ATM Requirements
Functional
- card + PIN
- balance + withdraw
- deposit
- receipt
- reconciliation

Non-functional
- debit iff cash dispensed
- PIN never in plain text
- responsive, highly available back end
- fully auditable
```

## The Set Up

### Defining the Core Entities

1. **ATM**: ID, location, cash cassettes (denominations and counts), state.
2. **Card**: number, linked account(s), status.
3. **Account**: balance, daily withdrawal limit, holds.
4. **Transaction**: ATM, card, type, amount, status (`authorised`, `dispensed`, `completed`, `reversed`), timestamps.

In object-oriented terms: `ATM` has a `CardReader`, `Keypad`, `Screen`, `CashDispenser`, `ReceiptPrinter`, and an `ATMState` (state pattern: `Idle`, `CardInserted`, `Authenticated`, `Dispensing`…); a `BankClient` talks to the back end.

### API or System Interface

```
(ATM -> bank) authenticate { cardNumber, encryptedPinBlock } -> sessionToken
(ATM -> bank) authorise { txnId, account, amount } -> approved | declined
(ATM -> bank) complete { txnId, dispensedAmount }
(ATM -> bank) reverse { txnId, reason }
(ATM -> bank) balance { account }
```

## High-Level Design

### 1) Authentication

The card is read; the PIN is entered on an **encrypting PIN pad** that encrypts it immediately into a PIN block using keys inside tamper-resistant hardware. The bank's **hardware security module (HSM)** verifies the PIN without it ever existing in plain text in software. Three wrong attempts retain or block the card.

### 2) Withdrawal as a two-step transaction

The ATM sends **authorise** with a unique transaction ID. The bank checks balance and limits and places a **hold** for the amount. Only after approval does the ATM dispense; it then sends **complete** with the amount actually dispensed, turning the hold into a debit. If dispensing fails, the ATM sends **reverse**, releasing the hold.

```diagram Withdrawal
node atm 0,1 box "ATM|state machine"
node switch 1.6,1 box "Bank Switch|ATM gateway"
node hsm 1.6,-0.3 box "HSM|PIN verify"
node core 3.2,1 box "Core Banking|accounts + holds"
node log 3.2,2.3 circle "Transaction Log"
edge atm <-> switch "authorise / complete / reverse"
edge switch <-> hsm
edge switch <-> core
edge core -> log
```

### 3) The ATM state machine

The machine moves through `Idle → CardInserted → PinEntry → Authenticated → SelectingTransaction → Dispensing → PrintingReceipt → EjectingCard → Idle`. Each state accepts only valid inputs, and every transition is written to the machine's **local journal** (also printed on a journal roll in older ATMs).

### 4) Reconciliation

When cash is replenished, the cassettes are counted. The bank compares the machine's journal and cassette counts with its own transaction records; discrepancies (jams, retracted notes) are investigated with the journal.

## Potential Deep Dives

### 1) What if the network fails mid-withdrawal?

:::solution bad Debit first, dispense later
#### Approach

Debit the account immediately on request, then dispense.

#### Challenges

If the dispenser jams or the machine crashes, the customer is debited with no cash.
:::

:::solution good Hold, then complete or reverse
#### Approach

Authorise places a hold; complete or reverse finalises it.

#### Challenges

If the network fails after authorisation, the bank doesn't know whether cash was dispensed.
:::

:::solution great Idempotent messages + journal + automatic reversal
#### Approach

Every message carries the **transaction ID**, so retries are idempotent. If the ATM doesn't receive the authorisation response in time, it **doesn't dispense** and sends a reversal (store-and-forward until delivered). If it dispensed but couldn't send completion, it retries completion from its **durable journal** after reconnecting. On the bank side, holds without a completion within a timeout are flagged and matched against the machine's journal during reconciliation, and are reversed if the journal shows no dispense.

#### Challenges

The dispenser's sensors (notes presented, taken, retracted) must be reliable, as they decide what was actually dispensed.
:::

### 2) How do we secure the ATM?

PINs are encrypted in the PIN pad and verified only in HSMs; keys are rotated using the bank's key hierarchy. Communication uses mutually authenticated TLS over a private network or VPN. The ATM software is **locked down** (allow-listed processes, signed updates, disabled USB), and the safe and dispenser detect tampering. Fraud monitoring watches for skimming patterns (many cards used once at one machine, then elsewhere).

:::tip
Mention cards from other banks: the ATM sends the request to the card network, which routes it to the issuing bank — the same authorise/complete/reverse pattern applies across organisations.
:::

### 3) How should the object-oriented design look?

Use the **state pattern** for the ATM so each state class handles only its valid actions; a **chain of responsibility** for the dispenser to pick notes from denominations (e.g. greedy by largest note, falling back if a cassette is empty); interfaces for hardware (`CashDispenser`, `CardReader`) so they can be mocked in tests and swapped across manufacturers; and a `TransactionManager` that owns the authorise-dispense-complete flow.

### Final Design

```diagram Final Design
node atm 0,1 box "ATM|state machine + journal"
node net 1.5,1 box "Private Network|mTLS"
node switch 3,1 box "ATM Switch"
node hsm 3,-0.3 box "HSM"
node card 4.5,-0.3 box "Card Networks"
node core 4.5,1 box "Core Banking"
node recon 4.5,2.3 box "Reconciliation"
node fraud 3,2.3 box "Fraud Monitoring"
edge atm <-> net
edge net <-> switch
edge switch <-> hsm
edge switch <-> card "other banks"
edge switch <-> core
edge core -> recon
edge switch -> fraud
```

```quiz
[
  {
    "question": "Why authorise a hold before dispensing instead of debiting immediately?",
    "options": ["Holds are free", "If dispensing fails, the hold can be released without a debit", "Banks prefer holds", "Faster"],
    "answer": 1,
    "explanation": "The account is debited only after cash is dispensed."
  },
  {
    "question": "What should the ATM do if it gets no authorisation response?",
    "options": ["Dispense anyway", "Not dispense, and send a reversal until delivered", "Keep the card", "Restart"],
    "answer": 1,
    "explanation": "Unknown outcomes are resolved safely with idempotent reversals."
  },
  {
    "question": "Where is the PIN verified?",
    "options": ["In the ATM software in plain text", "Inside a hardware security module, from an encrypted PIN block", "On the receipt", "By the card network in plain text"],
    "answer": 1,
    "explanation": "The PIN never exists unencrypted outside secure hardware."
  },
  {
    "question": "Which design pattern fits the ATM's flow?",
    "options": ["Singleton", "State pattern", "Observer only", "Decorator"],
    "answer": 1,
    "explanation": "Each state handles only the actions valid in that state."
  }
]
```
