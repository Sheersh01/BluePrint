---
title: Subscription Payment Plans
subtitle: One subscription, four ways to pay for it — upfront, monthly, free entry or a loan — across Razorpay, Stripe, PayU and cards. High-level and low-level design.
section: real-life
category: Real-Life Questions
tags: Multi-step Processes, Dealing with Contention
seoTitle: Design Subscription Payment Plans with Multiple Gateways (Real Interview Question, HLD + LLD)
description: A real interview question — design a subscription service with upfront, monthly, free and loan-based payment plans over multiple payment gateways, with both architecture and Java class design.
difficulty: medium
author: Editorial Team
published: Nov 11, 2026
---

:::info
**The question, as it was asked:** A user can subscribe to a service in 4 ways. Payment plan 1: pay upfront (one down payment). Payment plan 2: monthly subscription. Payment plan 3: backdoor entry, which is 0 payment. Payment plan 4: loan + a small entry fee, then loan installments. Gateways which can be used to pay: Razorpay, Stripe, PayU, card.
:::

## Understanding the Problem

:::definition 💳 What are we building?
The checkout and billing system behind a paid service — think an online program or premium membership — where the same subscription can be bought four different ways, and payments can go through several payment gateways. The interesting part isn't charging a card once; it's keeping **access** and **money** in sync over months of renewals, installments, failures and retries.
:::

This prompt is short and could be asked as a high-level design round *or* a low-level (class design) round. This page covers both: the architecture first, then the classes and Java code. Start by stating your assumptions:

**Assumptions**

- **Upfront** buys the full term (say 12 months) for one payment.
- **Monthly** charges now, then automatically every month until cancelled.
- **"Backdoor" entry (0 payment)** means access without paying: complimentary seats, partner or employee access, scholarships, promo codes. It skips the payment step, which makes it the plan most open to abuse.
- **Loan** is financed by a partner lender (an NBFC or BNPL provider): the user pays a small **entry fee** now, the lender approves a loan and pays us, and the user repays the lender in **installments**. We don't lend money ourselves (that would need a lending licence).
- **Gateways:** Razorpay, Stripe and PayU are full gateways. "Card" is a direct card processor integration. The user's card details never touch our servers — gateways give us tokens.
- **Scale:** ~1M subscribers, peaks of a few hundred checkouts per second during sales. This is a **correctness** problem far more than a scale problem.

### Functional Requirements

**Core Requirements**

1. Users should be able to choose a plan and check out.
2. Users should be able to pay through any supported gateway.
3. Access should follow payment status (activate, suspend, end).
4. Monthly charges and installments should be collected automatically.
5. Users should be able to finance a subscription with a loan.
6. Authorized staff should be able to grant 0-payment access.

**Below the line (out of scope):**

- Tax calculation and invoice formatting.
- Refund policies beyond the cases discussed.
- The lender's own credit decisioning.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. **Money correctness:** never charge twice for the same thing, never lose a successful payment, and activate access exactly once.
2. **Resilience to gateway failures:** one gateway being slow or down must not stop people from subscribing.
3. **Extensibility:** adding a fifth gateway or a new plan type shouldn't mean rewriting checkout.
4. **Security and compliance:** no raw card data stored (PCI scope stays with the gateways), signed webhooks, auditable 0-payment grants.
5. **Auditability:** every money movement and every access change can be explained later.

**Below the line (out of scope):**

- Sub-second checkout latency (a few seconds for a payment is normal).

```sketch Requirements on the whiteboard
Plans: upfront | monthly | free (backdoor) | loan
Gateways: Razorpay | Stripe | PayU | card

Must have
- never double charge, never lose a payment
- access follows payment state
- gateway down → still sell
- new plan / gateway = new class, not a rewrite
- no card data stored, audit everything
```

## The Set Up

### Defining the Core Entities

1. **Plan:** id, type (`UPFRONT`, `MONTHLY`, `FREE`, `LOAN`), price, term, entry fee, installment count.
2. **Subscription:** user, plan, status (`PENDING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`), current access period.
3. **Scheduled charge:** subscription, amount, due date, purpose (`FULL`, `MONTHLY`, `ENTRY_FEE`), status.
4. **Payment attempt:** charge, gateway, gateway reference, idempotency key, status (`CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`).
5. **Payment method / mandate:** a gateway token for a saved card or a recurring mandate (never the card number).
6. **Loan:** subscription, lender, amount, status (`APPLIED`, `APPROVED`, `DISBURSED`, `REPAYING`, `DEFAULTED`, `CLOSED`).
7. **Access grant:** for 0-payment access — who granted it, why, approved by whom, expiry.
8. **Ledger entry:** double-entry record of every money movement.

**Key insight:** every plan is just a different **payment schedule** — a list of charges over time.

| Plan | Charges due now | Charges later | Who pays us |
|---|---|---|---|
| Upfront | 1 × full price | none | User, via gateway |
| Monthly | 1 × monthly price | 1 × monthly price every month | User, via saved mandate |
| Free entry | none | none | Nobody — requires an approved grant |
| Loan | 1 × entry fee | none for us (installments go to the lender) | User (entry fee) + lender (disbursement) |

Once you see that, the rest of the system — checkout, billing, access — doesn't care which plan it is.

### API or System Interface

```
GET  /v1/plans                                   -> Plan[]

POST /v1/subscriptions        Idempotency-Key: <uuid>
     { planId, gateway?: "razorpay" | "stripe" | "payu" | "card" }
     -> { subscriptionId, status, payment?: { attemptId, checkout: { redirectUrl | sdkParams } } }

GET  /v1/subscriptions/{id}                      -> Subscription (+ schedule)
POST /v1/subscriptions/{id}/cancel

POST /v1/webhooks/{gateway}                      (signed, from Razorpay/Stripe/PayU/card processor)
POST /v1/webhooks/lenders/{lender}               (loan approved / disbursed / defaulted)

POST /v1/grants               (staff only)  { userId, planId, reason, expiresAt }
POST /v1/grants/{id}/approve  (a second staff member)
POST /v1/redeem               { code }           (single-use promo codes)
```

The user comes from the auth token. The client never sends an amount — prices come from the plan on the server.

## High-Level Design

### 1) Users should be able to choose a plan and check out

The **Subscription Service** reads the plan from a **Plan Catalog**, creates the subscription as `PENDING`, and asks the plan for its **payment schedule**. If something is due now, it hands that charge to the **Payment Orchestrator**; otherwise (free entry) it goes straight to activation checks. The `Idempotency-Key` on the request means a double-click or retry returns the same subscription instead of creating two.

### 2) Users should be able to pay through any supported gateway

The **Payment Orchestrator** creates a **payment attempt** and picks a gateway through a **router** (user's choice, payment method, currency, gateway health, cost). Each gateway sits behind the same **adapter** interface, so the orchestrator never contains Razorpay- or Stripe-specific code.

The gateway returns a checkout session (redirect URL or SDK parameters). The user pays on the gateway's page or SDK — card details go straight to the gateway, so we stay out of PCI scope. The gateway then calls our **webhook endpoint**; we verify the signature, look up the attempt by its gateway reference, and move it to `SUCCEEDED` or `FAILED`.

```diagram Checkout and payment
node user 0,1 box "User"
node subs 1.4,1 box "Subscription|Service"
node orch 2.8,1 box "Payment|Orchestrator"
node router 2.8,2.3 box "Gateway Router|health · cost"
node gw 4.4,1 box "Razorpay · Stripe|PayU · Card"
node db 1.4,-0.3 circle "Payments DB"
edge user -> subs "POST /subscriptions"
edge subs -> orch "charge due now"
edge orch -> router
edge orch <-> gw "checkout / signed webhook"
edge subs -> db
```

:::warning
Never activate access because the browser was redirected to a "success" page — users can fake that URL. Only the gateway's signed webhook (or a server-side status check) is the truth.
:::

### 3) Access should follow payment status

When a payment succeeds, the orchestrator records it and emits a `PaymentSucceeded` event (via an outbox). The Subscription Service consumes it, moves the subscription `PENDING → ACTIVE`, and an **Entitlement Service** grants access for the paid period. Products check entitlements with a fast cached lookup (`userId → active until`) instead of asking the payment system.

The subscription is a **state machine**, and every transition is explicit:

| From | Event | To |
|---|---|---|
| `PENDING` | Payment succeeded (or loan disbursed, or grant approved) | `ACTIVE` |
| `PENDING` | Payment failed / abandoned | `CANCELLED` |
| `ACTIVE` | Renewal charge failed | `PAST_DUE` |
| `PAST_DUE` | Retry succeeded or card updated | `ACTIVE` |
| `PAST_DUE` | Retries exhausted after the grace period | `SUSPENDED` |
| `SUSPENDED` | User pays the outstanding amount | `ACTIVE` |
| `ACTIVE` | Term ends (upfront) or user cancels | `EXPIRED` / `CANCELLED` |

Any transition not in the table is rejected — that's what stops a late "payment failed" webhook from cancelling a subscription that was already paid on retry.

### 4) Monthly charges and installments should be collected automatically

For monthly plans, the first checkout also creates a **recurring mandate** with the gateway (a saved token the gateway lets us charge later; in India, an RBI-compliant e-mandate). A **Billing Scheduler** stores future charges in a `scheduled_charges` table. Workers pick up charges that are due, charge the saved mandate through the same orchestrator, and update the subscription:

- success → extend the access period;
- failure → `PAST_DUE`, start **dunning** (retry after 1, 3 and 7 days, email the user to update their card), keep access during a short grace period, then `SUSPENDED`.

### 5) Users should be able to finance a subscription with a loan

1. The user pays the **entry fee** through the normal checkout.
2. A **Loan Service** submits an application to the partner **lender** through a lender adapter (KYC and credit checks happen on the lender's side).
3. The lender approves and **disburses** the plan price to us; their webhook moves the loan to `DISBURSED` and the subscription to `ACTIVE`.
4. The user repays the lender in installments. The lender reports status to us; if the loan **defaults**, the contract decides what happens to access (commonly: suspend after a grace period).

If the lender **rejects** the application, the entry fee is refunded automatically (or kept, if the terms say it's a non-refundable processing fee — decide and say so). This is a small **saga**: each step has a compensating action.

### 6) Authorized staff should be able to grant 0-payment access

0-payment access never touches a gateway, so it needs its own controls instead:

- Staff create an **access grant** with a reason and an expiry; a **second person approves** it (maker–checker) before access is activated.
- Promo codes are **single-use**, expire, are tied to a campaign with a cap, and redemption is rate-limited per user and IP.
- Every grant and redemption is written to an **audit log**, and finance gets a report of all free access.

## Potential Deep Dives

### 1) How do we make sure a user is never charged twice and access is activated exactly once?

:::solution bad Trust the redirect and retry on failure
#### Approach

Activate the subscription when the browser lands on the success page; if the gateway call times out, call it again.

#### Challenges

Success URLs can be forged, users can close the tab before the redirect, and retrying after a timeout can charge the user twice because the first charge may have gone through.
:::

:::solution good Idempotency keys and webhooks
#### Approach

Each payment attempt has its own idempotency key that we send to the gateway, so a retry of the same attempt can't create a second charge. Access is activated from the signed webhook, not the redirect.

#### Challenges

Webhooks can arrive twice, out of order, or before our own API call returns; a crash between "payment saved" and "subscription activated" can leave a paid user without access.
:::

:::solution great Payment state machine + unique gateway reference + outbox + reconciliation
#### Approach

- Store every attempt with a **unique** `(gateway, gateway_reference)` and only allow forward state transitions (`PENDING → SUCCEEDED` happens once; a second `SUCCEEDED` webhook is a no-op).
- Record webhook **event ids** with a unique constraint so duplicates are ignored.
- Update the payment and write a `PaymentSucceeded` event to an **outbox** in the same transaction; the subscription is activated by consuming that event, idempotently.
- Run **reconciliation** jobs: query gateways for attempts stuck in `PENDING`/`UNKNOWN`, and compare daily settlement reports against our ledger.

#### Challenges

More tables and background jobs — but this is exactly what payment teams run. See [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios) for the 21 failure cases this covers.
:::

### 2) What if a gateway is slow or down?

:::solution bad Retry the same payment on another gateway right away
#### Approach

If Razorpay times out, immediately send the payment to Stripe instead.

#### Challenges

A timeout means **unknown**, not failed. Razorpay may have charged the user, and now Stripe charges them again.
:::

:::solution great Health-based routing for new attempts, status checks for unknown ones
#### Approach

- The router tracks each gateway's success rate and latency and puts a **circuit breaker** around each one; new checkouts go to healthy gateways.
- An attempt that timed out is marked `UNKNOWN` and its status is **queried** from the same gateway before anything else happens. Only a definite failure lets the user retry, as a *new* attempt, possibly on another gateway.
- Recurring charges use the gateway that holds the mandate; if it's down, the charge is retried later instead of switching gateways (mandates aren't portable).

#### Challenges

Routing rules need care (some methods, like UPI or a particular card network, are only on some gateways), and reconciliation must cover every gateway.
:::

### 3) How do we run renewals and installments reliably?

The billing scheduler is a classic job-scheduler problem:

- Charges live in a `scheduled_charges` table indexed by `due_at`. Workers claim due rows with `SELECT … FOR UPDATE SKIP LOCKED`, so many workers run in parallel without picking the same charge.
- Each scheduled charge id **is** the idempotency key for its payment, so a worker crash and retry can't charge twice.
- Renewal runs are spread across the day (not all at midnight) to avoid gateway rate limits.
- Dunning is just more scheduled charges with a retry policy, plus notifications.

### 4) How do we stop abuse of the 0-payment route?

The 0-payment plan is the most likely place for losses, because no money changes hands to prove anything. Use maker–checker approval for staff grants, role-based permissions (only certain roles may grant, with per-person monthly caps), single-use expiring promo codes, alerts on unusual volumes (a staff member granting 200 seats in a day), and a regular review of active free subscriptions.

### 5) How do we keep the money records correct?

Use a **double-entry ledger**: every movement is recorded as entries that balance. For example, a user pays ₹12,000 upfront → debit *gateway receivable* ₹12,000, credit *deferred revenue* ₹12,000; when the gateway settles to our bank → debit *bank*, credit *gateway receivable*; each month of service delivered → debit *deferred revenue* ₹1,000, credit *revenue*. Never update balances in place. Daily **reconciliation** compares the ledger with each gateway's settlement report and the lender's statement, and flags mismatches for review.

### Final Design

```diagram Final Design
node user 0,1 box "User / App"
node subs 1.5,1 box "Subscription|Service"
node catalog 1.5,-0.3 circle "Plan Catalog"
node orch 3,1 box "Payment|Orchestrator"
node gws 4.6,0.3 box "Gateway Adapters|Razorpay · Stripe|PayU · Card"
node loan 1.5,2.4 box "Loan Service|lender adapter"
node sched 3,2.4 box "Billing|Scheduler"
node ledger 3,-0.3 circle "Payments DB|+ ledger"
node ent 0,2.4 box "Entitlement|Service"
node grants 0,-0.3 box "Grants|maker-checker"
edge user -> subs
edge subs -> catalog
edge subs -> orch
edge orch <-> gws "charges / webhooks"
edge orch -> ledger
edge subs -> loan
edge sched -> orch "due charges"
edge subs -> ent "access events"
edge grants -> subs
```

## Low-Level Design

If this is asked as a class-design round, start from what will **change**, not from a list of patterns:

| What will change | Design decision | Pattern name (say it last) |
|---|---|---|
| New plan types (annual, pay-per-use, family) | Each plan is a class behind one interface that returns a payment schedule | Strategy |
| New gateways, different SDKs and webhook formats | Each gateway is wrapped in a class behind one interface | Adapter |
| Choosing a gateway per payment | A router picks an adapter by method, currency and health | Strategy + registry (Factory) |
| Subscription lifecycle rules | Allowed transitions live in one place | State |
| Things that happen after activation (access, emails, analytics) | Publish an event; listeners react | Observer |
| Lenders | Same idea as gateways | Adapter |

What **doesn't** change: the checkout flow and the subscription lifecycle. Those are the stable core that the swappable parts plug into.

```diagram Class design
node checkout 1.5,0 box "CheckoutService|checkout(user, planId, gw)"
node plan 0,1.4 box "«interface» PaymentPlan|schedule(start)|Upfront · Monthly|FreeAccess · Loan"
node router 3,1.4 box "GatewayRouter|select(request)"
node gateway 3,2.8 box "«interface» PaymentGateway|createCheckout · fetchStatus|Razorpay · Stripe|PayU · CardProcessor"
node sub 1.5,2.8 box "Subscription|status · transitionTo()"
edge checkout -> plan "uses"
edge checkout -> router "uses"
edge router -> gateway "picks"
edge checkout -> sub "creates"
```

### The code (Java)

```java
// Interview skeleton: imports, repositories, SDK types and exceptions omitted.

// ---- Plans: Strategy ------------------------------------------------
enum PlanType { UPFRONT, MONTHLY, FREE, LOAN }
enum ChargePurpose { FULL, MONTHLY, ENTRY_FEE }

record Money(long minorUnits, String currency) {}

record ScheduledCharge(String id, Money amount, Instant dueAt,
                       ChargePurpose purpose) {
    static ScheduledCharge of(Money m, Instant at, ChargePurpose p) {
        return new ScheduledCharge(Ids.next(), m, at, p);
    }
}

interface PaymentPlan {
    PlanType type();
    /** Charges due when the subscription starts. Empty = nothing to pay. */
    List<ScheduledCharge> initialCharges(Instant start);
    default boolean requiresApproval() { return false; }
}

final class UpfrontPlan implements PaymentPlan {
    private final Money price;
    UpfrontPlan(Money price) { this.price = price; }
    public PlanType type() { return PlanType.UPFRONT; }
    public List<ScheduledCharge> initialCharges(Instant start) {
        return List.of(ScheduledCharge.of(price, start, ChargePurpose.FULL));
    }
}

final class MonthlyPlan implements PaymentPlan {
    private final Money monthly;
    MonthlyPlan(Money monthly) { this.monthly = monthly; }
    public PlanType type() { return PlanType.MONTHLY; }
    public List<ScheduledCharge> initialCharges(Instant start) {
        // later months: created by the billing scheduler after each renewal
        return List.of(ScheduledCharge.of(monthly, start, ChargePurpose.MONTHLY));
    }
}

final class FreeAccessPlan implements PaymentPlan {
    public PlanType type() { return PlanType.FREE; }
    public List<ScheduledCharge> initialCharges(Instant start) {
        return List.of();
    }
    @Override public boolean requiresApproval() { return true; } // AccessGrant
}

final class LoanPlan implements PaymentPlan {
    private final Money entryFee;
    LoanPlan(Money entryFee) { this.entryFee = entryFee; }
    public PlanType type() { return PlanType.LOAN; }
    public List<ScheduledCharge> initialCharges(Instant start) {
        // the lender pays the rest; installments are owed to the lender
        return List.of(ScheduledCharge.of(entryFee, start, ChargePurpose.ENTRY_FEE));
    }
}

// ---- Gateways: Adapter ----------------------------------------------
record ChargeRequest(String idempotencyKey, Money amount, String userId) {}
record CheckoutSession(String gatewayRef, String redirectUrl) {}
enum PaymentStatus { PENDING, SUCCEEDED, FAILED, UNKNOWN }

interface PaymentGateway {
    String name();
    boolean supports(Money amount);
    CheckoutSession createCheckout(ChargeRequest request);
    PaymentStatus fetchStatus(String gatewayRef);
}

final class RazorpayGateway implements PaymentGateway {
    private final RazorpayClient client;   // vendor SDK hidden behind the adapter
    RazorpayGateway(RazorpayClient client) { this.client = client; }

    public String name() { return "razorpay"; }
    public boolean supports(Money m) { return m.currency().equals("INR"); }

    public CheckoutSession createCheckout(ChargeRequest r) {
        var order = client.orders().create(
            r.amount().minorUnits(), r.amount().currency(), r.idempotencyKey());
        return new CheckoutSession(order.id(), order.checkoutUrl());
    }

    public PaymentStatus fetchStatus(String ref) {
        return switch (client.orders().fetch(ref).status()) {
            case "paid" -> PaymentStatus.SUCCEEDED;
            case "attempted" -> PaymentStatus.PENDING;
            default -> PaymentStatus.FAILED;
        };
    }
}
// StripeGateway, PayUGateway, CardProcessorGateway follow the same shape.

final class GatewayRouter {
    private final Map<String, PaymentGateway> byName;   // registry
    private final Map<String, CircuitBreaker> breakers;

    GatewayRouter(List<PaymentGateway> all, Map<String, CircuitBreaker> breakers) {
        this.byName = all.stream()
            .collect(Collectors.toMap(PaymentGateway::name, g -> g));
        this.breakers = breakers;
    }

    PaymentGateway select(Money amount, Optional<String> preferred) {
        return preferred.map(byName::get)
            .filter(g -> usable(g, amount))
            .or(() -> byName.values().stream()
                .filter(g -> usable(g, amount)).findFirst())
            .orElseThrow(() -> new NoGatewayAvailableException(amount));
    }

    private boolean usable(PaymentGateway g, Money amount) {
        return g.supports(amount) && breakers.get(g.name()).allowsRequests();
    }
}

// ---- Subscription lifecycle: State -----------------------------------
enum SubscriptionStatus {
    PENDING, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED;

    private static final Map<SubscriptionStatus, Set<SubscriptionStatus>>
        ALLOWED = Map.of(
            PENDING,   Set.of(ACTIVE, CANCELLED),
            ACTIVE,    Set.of(PAST_DUE, CANCELLED, EXPIRED),
            PAST_DUE,  Set.of(ACTIVE, SUSPENDED, CANCELLED),
            SUSPENDED, Set.of(ACTIVE, CANCELLED),
            CANCELLED, Set.of(),
            EXPIRED,   Set.of());

    boolean canMoveTo(SubscriptionStatus next) {
        return ALLOWED.get(this).contains(next);
    }
}

final class Subscription {
    private final String id, userId;
    private final PlanType planType;
    private SubscriptionStatus status = SubscriptionStatus.PENDING;

    Subscription(String id, String userId, PlanType planType) {
        this.id = id; this.userId = userId; this.planType = planType;
    }

    void transitionTo(SubscriptionStatus next) {
        if (status == next) return;                           // idempotent
        if (!status.canMoveTo(next)) {
            throw new IllegalStateException(status + " -> " + next);
        }
        status = next;
    }

    String id() { return id; }
    PlanType planType() { return planType; }
    SubscriptionStatus status() { return status; }
}

// ---- Orchestration ---------------------------------------------------
record CheckoutResult(String subscriptionId, SubscriptionStatus status,
                      Optional<String> redirectUrl) {}

final class CheckoutService {
    private final Map<String, PaymentPlan> plans;   // planId -> strategy
    private final GatewayRouter router;
    private final SubscriptionRepository subscriptions;
    private final PaymentAttemptRepository attempts;
    private final GrantService grants;
    private final LoanService loans;               // lender behind its own adapter
    private final EventPublisher events;           // Observer: access, emails
    // constructor omitted

    CheckoutResult checkout(String userId, String planId,
                            Optional<String> gateway, String idempotencyKey) {
        var existing = subscriptions.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) return resultFor(existing.get());  // safe retry

        PaymentPlan plan = plans.get(planId);
        var sub = new Subscription(Ids.next(), userId, plan.type());
        subscriptions.save(sub, idempotencyKey);

        List<ScheduledCharge> dueNow = plan.initialCharges(Instant.now());
        if (dueNow.isEmpty()) {
            if (plan.requiresApproval() && !grants.hasApproved(userId, planId)) {
                throw new NotAuthorizedException("needs an approved grant");
            }
            activate(sub);
            return resultFor(sub);
        }

        ScheduledCharge charge = dueNow.get(0);
        PaymentGateway gw = router.select(charge.amount(), gateway);
        // the scheduled charge id doubles as the gateway idempotency key
        var request = new ChargeRequest(charge.id(), charge.amount(), userId);
        var session = gw.createCheckout(request);
        attempts.save(new PaymentAttempt(
            charge.id(), sub.id(), gw.name(), session.gatewayRef()));
        return new CheckoutResult(sub.id(), sub.status(),
                                  Optional.of(session.redirectUrl()));
    }

    /** From the verified webhook (via the outbox); may arrive more than once. */
    void onPaymentSucceeded(String subscriptionId) {
        var sub = subscriptions.get(subscriptionId);
        if (sub.status() == SubscriptionStatus.ACTIVE) return;  // duplicate
        if (sub.planType() == PlanType.LOAN) {
            loans.applyOnce(sub);  // entry fee paid: apply to the lender
            return;                // access starts on the DISBURSED webhook
        }
        activate(sub);
    }

    void onLoanDisbursed(String subscriptionId) {
        var sub = subscriptions.get(subscriptionId);
        if (sub.status() != SubscriptionStatus.ACTIVE) activate(sub);
    }

    private void activate(Subscription sub) {
        sub.transitionTo(SubscriptionStatus.ACTIVE);
        subscriptions.update(sub);
        events.publish(new SubscriptionActivated(sub.id()));
    }

    private CheckoutResult resultFor(Subscription s) {
        return new CheckoutResult(s.id(), s.status(), Optional.empty());
    }
}
```

### Extending it

| Change | What you touch |
|---|---|
| Add a 5th gateway (e.g. PayPal) | One new `PaymentGateway` class + register it. Checkout is untouched. |
| Add an annual plan or a 3-month free trial | One new `PaymentPlan` class + catalog entry. |
| New rule: suspend after 2 failed renewals instead of 3 | Dunning policy config; the state machine stays the same. |
| Send a welcome email on activation | A new listener for `SubscriptionActivated`. |

## Which Standard Problems This Maps To

| Standard problem | What you borrow | What's different here |
|---|---|---|
| [Subscription Management](/learn/system-design/problem-breakdowns/subscription-management) | Renewals, dunning, entitlements | Four plan types, including free and loan-financed |
| [Payment System](/learn/system-design/problem-breakdowns/payment-system) | Idempotency, payment states, timeouts, ledger | You're the *client* of several gateways, not the gateway |
| [E-commerce Checkout](/learn/system-design/problem-breakdowns/ecommerce-checkout) | Checkout orchestration, saga with compensation | Ongoing access instead of a one-time order |
| [Digital Wallet](/learn/system-design/problem-breakdowns/digital-wallet) | Double-entry ledger, reconciliation | — |
| [Job Scheduler](/learn/system-design/problem-breakdowns/job-scheduler) | Due-charge workers, `SKIP LOCKED`, retries | Each job moves money, so idempotency is mandatory |
| [Webhook System](/learn/system-design/problem-breakdowns/webhook-system) | Signed, retried, de-duplicated webhooks | You *receive* webhooks from four providers |
| [Multi-step Processes](/learn/system-design/patterns/multi-step-processes) | Sagas and state machines | The loan flow is a saga across you, the gateway and the lender |

## What's Different From the Textbook Version

- **Multiple gateways.** Textbook payment questions have one processor. Here, routing, failover and "timeout = unknown" across providers are the interesting parts.
- **Free and financed plans.** A plan with no payment needs authorization controls; a loan plan adds a third party and a saga.
- **It doubles as an LLD question.** The four plans and four gateways are a textbook Strategy + Adapter setup — the interviewer may want classes, not boxes.

## Follow-up Questions You May Get

| Follow-up question | Short answer | Read more |
|---|---|---|
| The user double-clicks Pay. What happens? | Idempotency key on checkout; the same subscription and attempt are returned | [Q23: idempotency](/learn/system-design/questions/distributed-systems#q-23) |
| The gateway timed out — did the user pay? | Unknown: query the status (or wait for the webhook) before retrying anywhere | [Payment Failure Scenarios](/learn/system-design/tips/payment-failure-scenarios) |
| Money was deducted but the subscription isn't active | Webhook + outbox + reconciliation repair it; idempotent activation | [Q88: deducted but not credited](/learn/system-design/questions/scenarios#q-88) |
| The same webhook arrives three times | Unique event id; forward-only state transitions make repeats no-ops | [Q68: webhooks](/learn/system-design/questions/apis#q-68) |
| Razorpay is down during a sale | Circuit breaker; route new checkouts to another gateway | [Q75: circuit breaker](/learn/system-design/questions/architecture#q-75) |
| The lender rejects the loan after the entry fee was paid | Compensating refund (or keep per terms) — a saga step | [Q20: saga pattern](/learn/system-design/questions/distributed-systems#q-20) |
| Do you store card numbers for monthly billing? | No — store the gateway's token/mandate; card data stays with the PCI-compliant gateway | [Q78: encryption at rest vs in transit](/learn/system-design/questions/security#q-78) |
| Can a renewal run twice? | The scheduled charge id is the idempotency key, and workers claim rows with `SKIP LOCKED` | [Q24: delivery semantics](/learn/system-design/questions/distributed-systems#q-24) |
| A user upgrades from monthly to upfront mid-month | Prorate: credit unused days of the current period against the upfront price, then switch the schedule | — |
| Different currencies or international users? | Price per currency in the catalog; route to gateways that support the currency | — |
| How do you add PayPal next month? | One new adapter class + registration — show it in the LLD | — |
| How do you prevent staff from giving away free access? | Maker–checker approval, caps per role, audit log, anomaly alerts | — |

## Tips & Tricks for This Question

- **Reframe the four plans as payment schedules** in the first few minutes. It turns a messy list of cases into one model, and interviewers notice.
- **Ask early: HLD or LLD?** "Would you like me to focus on the services and data flow, or on the class design?" Then spend your time on the right thing.
- **Treat "backdoor" carefully.** Say what you think it means (complimentary access) and immediately add controls — a 0-payment path without approval and audit is a red flag.
- **Clarify who lends.** "I'll assume a partner lender pays us and collects installments" removes the whole credit-risk problem from your design, and shows judgment.
- **Name "timeout = unknown"** whenever gateways come up. It's the single most important idea in payment interviews.
- **In LLD, explain the force before the pattern:** "Gateways will keep changing, so each one sits behind an adapter" beats "I'll use the Adapter pattern".
- **Don't** build your own card storage, let the client send the amount, or activate access from the success redirect.

Ready to try it yourself? [Practice this question on the whiteboard](/practice/subscription-payment-plans).

```quiz
[
  {
    "question": "What's the cleanest way to model the four payment plans?",
    "options": ["Four separate checkout services", "A big if/else on plan type everywhere", "Each plan produces a payment schedule behind one interface", "Store everything as monthly payments"],
    "answer": 2,
    "explanation": "Once every plan is a schedule of charges, checkout, billing and access don't need to know which plan it is."
  },
  {
    "question": "Razorpay times out while charging a user. What should happen next?",
    "options": ["Immediately charge the user on Stripe", "Mark it failed and ask the user to pay again", "Treat it as unknown and query Razorpay's status (or wait for the webhook) first", "Activate access anyway"],
    "answer": 2,
    "explanation": "A timeout may hide a successful charge; switching gateways right away risks charging twice."
  },
  {
    "question": "When should a subscription become ACTIVE after an online payment?",
    "options": ["When the browser reaches the success page", "When the gateway's signed webhook (or a server-side status check) confirms success", "As soon as checkout starts", "After the first renewal"],
    "answer": 1,
    "explanation": "Redirects can be forged or lost; only the gateway's confirmation is trustworthy."
  },
  {
    "question": "In the class design, which pattern lets you add a fifth gateway without touching checkout?",
    "options": ["Singleton", "Adapter behind a PaymentGateway interface", "Builder", "Decorator on Subscription"],
    "answer": 1,
    "explanation": "Each provider's SDK is wrapped in an adapter implementing the same interface; checkout only knows the interface."
  }
]
```
