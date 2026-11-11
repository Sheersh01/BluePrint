---
title: Dependency Injection Framework
seoTitle: Design an IoC / Dependency Injection Framework
description: Design an inversion-of-control container — registering bindings, resolving dependency graphs, lifetimes and scopes, cycle detection, and fast resolution.
tags: Multi-step Processes
difficulty: hard
author: Editorial Team
published: Nov 10, 2026
askedAt: ADP | 0
---

## Understanding the Problem

:::definition 🧩 What is a Dependency Injection Framework?
A dependency injection (DI) container builds objects for you. Instead of classes creating their own dependencies, they declare what they need, and the container constructs and wires them — think Spring, Guice, or .NET's built-in container.
:::

### Functional Requirements

**Core Requirements**

1. Developers should be able to register bindings: an interface → an implementation (or a factory, or an instance).
2. The container should resolve an object by constructing it and all its dependencies recursively.
3. Bindings should support lifetimes: transient (new each time), singleton (one per container), and scoped (one per request/scope).
4. The container should report clear errors for missing bindings and circular dependencies.

**Below the line (out of scope):**

- Aspect-oriented proxies and interceptors.
- Configuration file formats.

:::tryit First Question
What are the non-functional requirements for this framework?
:::

### Non-Functional Requirements

**Core Requirements**

1. Resolution must be fast — it may run on every request in a web server.
2. Thread-safe: concurrent resolution must never create two singletons.
3. Fail fast: configuration errors should surface at startup, not in production traffic.
4. Small, predictable API that's easy to test with.

**Below the line (out of scope):**

- Hot-reloading bindings at runtime.

```sketch DI Framework Requirements
Functional
- register bindings
- resolve recursively
- transient / singleton / scoped
- errors: missing, cycles

Non-functional
- fast resolution
- thread-safe singletons
- fail fast at startup
- small API
```

## The Set Up

### Defining the Core Entities

1. **Binding**: service key (type/token) → provider (class, factory, or instance) + lifetime.
2. **Container**: holds bindings and singleton instances; builds objects.
3. **Scope**: a child container holding scoped instances (e.g. per HTTP request).
4. **Resolution plan**: a precompiled recipe for constructing a type.

### API or System Interface

```
const c = new Container();
c.bind(Logger).to(ConsoleLogger).singleton();
c.bind(UserRepo).to(SqlUserRepo).scoped();
c.bind(Config).toInstance(loadConfig());
c.bind(Clock).toFactory(() => new SystemClock());

c.validate();                     // fail fast at startup
const scope = c.createScope();    // per request
const svc = scope.resolve(UserService);
scope.dispose();                  // disposes scoped instances
```

## High-Level Design

### 1) Register bindings

`bind()` records a Binding in a map keyed by the service token. Dependencies of each implementation are discovered from constructor metadata (type annotations / decorators, or an explicit `inject` list), so the container knows what each class needs.

### 2) Resolve objects recursively

```diagram Resolving a dependency graph
node us 0,1 box "UserService"
node repo 1.5,0.3 box "UserRepo"
node log 1.5,1.7 box "Logger|(singleton)"
node db 3,0.3 box "DbPool|(singleton)"
node cfg 4.5,1 box "Config|(instance)"
edge us -> repo "needs"
edge us -> log "needs"
edge repo -> db "needs"
edge repo -> log
edge db -> cfg "needs"
```

`resolve(T)` looks up T's binding, resolves each constructor dependency first (depth-first), then constructs T. The result is a directed acyclic graph of objects.

### 3) Lifetimes

- **Transient**: construct a new instance every time.
- **Singleton**: construct once, cache in the root container, reuse forever.
- **Scoped**: construct once per scope (stored in the scope's cache), disposed when the scope ends.

A scope delegates singleton lookups to its root, so singletons are shared while scoped instances stay per-request.

### 4) Report errors

Missing bindings throw with the full resolution path ("UserService → UserRepo → DbPool: no binding for Config"). Cycles are detected by tracking the stack of types currently being resolved.

## Potential Deep Dives

### 1) How do we detect configuration errors early?

:::solution bad Discover errors at first resolve
#### Approach

Only fail when a request happens to need a broken binding.

#### Challenges

Errors appear in production, possibly hours after deploy.
:::

:::solution great Validate the whole graph at startup
#### Approach

`validate()` walks every registered binding's dependency graph without constructing objects, checking that every dependency has a binding, detecting cycles (DFS with a "visiting" set), and flagging **captive dependencies** — a singleton depending on a scoped service, which would leak one request's object into all requests.

#### Challenges

Factories are opaque; require them to declare their dependencies so they can be validated too.
:::

### 2) How do we make resolution fast?

:::solution good Reflect on every resolve
#### Approach

Inspect constructor metadata each time an object is built.

#### Challenges

Reflection is slow when repeated on hot paths.
:::

:::solution great Compile resolution plans
#### Approach

On first use (or at validation), compile each binding into a **resolution plan** — effectively a generated factory function that calls dependency factories directly. Cache plans by type; subsequent resolves are just function calls and cache lookups.

#### Challenges

Plans must be invalidated if bindings change, which is why bindings are frozen after startup.
:::

### 3) How do we keep singletons thread-safe?

Use double-checked locking (or a per-binding lazy initializer) so only one thread constructs a singleton and others wait for it. Avoid holding a global lock during construction — a singleton's constructor might resolve other singletons, and a global lock would deadlock or serialise everything.

### Final Design

```diagram Final Design
node app 0,1.2 box "Application"
node root 1.5,1.2 box "Root Container|- bindings (frozen)|- singleton cache"
node val 1.5,0 box "Validator|- missing / cycles|- captive deps"
node plans 3,0 circle "Compiled Plans"
node scope 3,2.5 box "Request Scope|- scoped cache|- dispose()"
edge app -> root "bind + validate"
edge root -> val
edge val -> plans "compile"
edge root -> scope "createScope"
edge scope -> plans "resolve"
edge app <-> scope "resolve per request"
```

```quiz
[
  {
    "question": "What is a captive dependency?",
    "options": ["A missing binding", "A longer-lived service (singleton) holding a shorter-lived one (scoped)", "A cycle", "A private constructor"],
    "answer": 1,
    "explanation": "The scoped object would leak across requests."
  },
  {
    "question": "How are circular dependencies detected?",
    "options": ["They can't be", "Tracking types currently being resolved and erroring if one repeats", "Timeouts", "Random sampling"],
    "answer": 1,
    "explanation": "A type appearing twice on the resolution stack means a cycle."
  },
  {
    "question": "Why validate the container at startup?",
    "options": ["To warm caches only", "So configuration errors fail the deploy instead of production requests", "It's required by the language", "To speed up builds"],
    "answer": 1,
    "explanation": "Fail fast before taking traffic."
  },
  {
    "question": "What makes repeated resolution fast?",
    "options": ["More reflection", "Compiled, cached resolution plans", "Bigger heaps", "Disabling singletons"],
    "answer": 1,
    "explanation": "Plans turn resolution into direct function calls."
  }
]
```
