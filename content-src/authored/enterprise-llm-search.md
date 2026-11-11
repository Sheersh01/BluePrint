---
title: Enterprise LLM Search
seoTitle: Design an LLM-Powered Enterprise Search System
description: Design an LLM-powered enterprise search system — connectors to company tools, chunking and embedding documents, hybrid retrieval, permission-aware results, grounded answers with citations, and evaluation.
tags: Scaling Reads, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🔎 What is Enterprise LLM Search?
Enterprise LLM search (Glean, or "ask our docs" assistants) lets employees ask questions in plain language — "What's our parental leave policy in Germany?" — and get a direct answer drawn from the company's own documents, wikis, tickets and chats, with links to the sources. It combines a search engine over many internal tools with a large language model that writes the answer (**retrieval-augmented generation**, or RAG), and it must never show someone a document they aren't allowed to see.
:::

### Functional Requirements

**Core Requirements**

1. The system should index content from company tools (docs, wikis, email, tickets, chat) through connectors.
2. Users should be able to search with keywords or natural-language questions.
3. The system should return a generated answer with **citations** to the source documents, plus a ranked result list.
4. Results and answers must respect each user's permissions in the source systems.
5. Users can give feedback (thumbs up/down) on answers.

**Below the line (out of scope):**

- Agents that take actions in tools.
- Training or fine-tuning our own LLM.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Never leak content across permissions — the most important requirement.
2. Fresh: edits and new documents searchable within minutes; permission changes applied within minutes.
3. Answer latency: first tokens in < 2 s, results list in < 500 ms.
4. Grounded: answers come from retrieved sources, with citations, and say "I don't know" otherwise.
5. Scale to large companies: ~100M documents per tenant, thousands of queries per minute, strict tenant isolation.

**Below the line (out of scope):**

- Perfect answer quality on every query.

```sketch Enterprise Search Requirements
Functional
- connectors to company tools
- keyword + natural-language search
- generated answers with citations
- permission-aware
- feedback

Non-functional
- never leak across permissions
- fresh within minutes
- first token < 2s
- grounded, admits "don't know"
- 100M docs per tenant
```

## The Set Up

### Defining the Core Entities

1. **Source connector**: integration with a tool, credentials, sync cursor.
2. **Document**: tenant, source, URL, title, content, author, updated at, **ACL** (users and groups allowed).
3. **Chunk**: a passage of a document (~300-800 tokens) with its embedding and inherited ACL.
4. **Identity mapping**: a user's identities and group memberships across tools.
5. **Query log**: query, retrieved chunks, answer, feedback.

### API or System Interface

```
POST /search { query, filters? } -> { results: [{ doc, snippet, score }] }
POST /answer { query, conversationId? } -> stream { tokens, citations: [{ docId, chunkId }] }
POST /answer/:id/feedback { rating, comment }
(connectors) push via webhooks or pull incremental changes
```

## High-Level Design

### 1) Ingesting content

**Connectors** for each tool sync documents incrementally (webhooks where available, polling with cursors otherwise), including each document's **permissions**. An ingestion pipeline extracts text, splits it into **chunks**, computes **embeddings**, and writes to two indexes: a keyword index (BM25) and a **vector index**, both storing the ACL on every chunk.

```diagram Ingestion
node tools 0,1 box "Company Tools"
node conn 1.5,1 box "Connectors|content + ACLs"
node pipe 3,1 box "Pipeline|extract · chunk · embed"
node kw 4.5,0 circle "Keyword Index"
node vec 4.5,2 circle "Vector Index"
edge tools -> conn
edge conn -> pipe
edge pipe -> kw
edge pipe -> vec
```

### 2) Searching

A query is run against **both** indexes (hybrid retrieval): keyword search catches exact names and codes, vector search catches paraphrases. Both are filtered by the user's permissions, results are merged, and a **re-ranker** model reorders the top ~50 candidates by relevance, freshness and authority.

### 3) Generating answers

The top chunks are placed in a prompt with instructions to answer **only from the provided sources** and cite them. The LLM's answer is streamed to the user with citation markers linking to the source documents. If retrieval found nothing relevant, the assistant says it couldn't find an answer.

### 4) Feedback and evaluation

Queries, retrieved chunks, answers and feedback are logged. An **evaluation set** of real questions with known answers is re-run when prompts, models or ranking change, measuring retrieval recall, answer correctness and citation accuracy.

## Potential Deep Dives

### 1) How do we enforce permissions?

:::solution bad Filter the answer after generation
#### Approach

Retrieve from all documents, generate an answer, then hide citations the user can't open.

#### Challenges

The answer text itself may already contain confidential information from documents the user can't see.
:::

:::solution good Post-filter retrieved results
#### Approach

Retrieve candidates, then drop chunks the user can't access before building the prompt.

#### Challenges

If most top results are restricted, few relevant chunks remain, and relevance suffers.
:::

:::solution great ACL filtering inside retrieval + fresh permission sync
#### Approach

Store each chunk's **allowed principals** (users and groups) in both indexes and pass the user's **expanded group memberships** as a filter **during retrieval**, so only permitted chunks are ever candidates. Sync permission changes from sources quickly (and treat "unknown permissions" as private). For highly sensitive sources, **re-check access** against the source API at query time before showing results.

#### Challenges

Group expansion for large organisations can be big; cache it per user and refresh on change events.
:::

### 2) How do we keep answers grounded and useful?

Retrieval quality drives answer quality. Good chunking keeps headings with their text; hybrid retrieval plus a re-ranker raises recall; including document titles, dates and authors in the prompt helps the model prefer recent, authoritative sources. Prompts require citations for every claim, and a lightweight check verifies that cited chunks actually support the answer. When sources conflict (an old policy page versus a new one), the answer says so and cites both.

:::tip
Mention cost and latency: answer generation is the most expensive step. Cache answers for identical questions per permission set, use a smaller model for simple queries, and stream tokens to make latency feel shorter.
:::

### 3) How do we isolate tenants and scale indexing?

Each customer's data lives in **separate indexes** (or strictly partitioned ones) with tenant-specific encryption keys, and queries can never cross tenants. Ingestion is a queue-based pipeline that scales workers per tenant; initial syncs of millions of documents are throttled to respect source API rate limits, while incremental updates take priority so fresh edits appear quickly. Embeddings are recomputed only for changed chunks.

### Final Design

```diagram Final Design
node tools 0,1 box "Company Tools"
node conn 1.4,1 box "Connectors"
node pipe 2.8,1 box "Ingestion Pipeline"
node idx 4.2,1 circle "Hybrid Index|ACL per chunk"
node ids 4.2,-0.3 circle "Identities"
node api 5.6,1 box "Search / Answer API"
node rr 5.6,-0.3 box "Re-ranker"
node llm 7,1 box "LLM|grounded prompt"
node user 5.6,2.3 box "Employees"
node eval 7,2.3 box "Logs + Evaluation"
edge tools -> conn
edge conn -> pipe
edge pipe -> idx
edge conn -> ids "permissions"
edge api <-> idx "filtered retrieval"
edge api <-> ids
edge api <-> rr
edge api <-> llm
edge user <-> api
edge api -> eval
```

```quiz
[
  {
    "question": "Why combine keyword and vector search?",
    "options": ["It's cheaper", "Keywords catch exact terms; vectors catch paraphrases — together they improve recall", "Vector search is illegal alone", "To reduce storage"],
    "answer": 1,
    "explanation": "Hybrid retrieval covers both exact and semantic matches."
  },
  {
    "question": "Where should permission filtering happen?",
    "options": ["After the answer is generated", "Inside retrieval, using ACLs stored on every chunk", "In the browser", "Nowhere"],
    "answer": 1,
    "explanation": "Restricted content must never reach the prompt."
  },
  {
    "question": "What makes an answer grounded?",
    "options": ["A larger model", "It's written only from retrieved sources and cites them", "It's longer", "It uses the internet"],
    "answer": 1,
    "explanation": "Citations let users verify; no sources means 'I don't know'."
  },
  {
    "question": "How do we check that changes to prompts or models don't make things worse?",
    "options": ["Ask one user", "Re-run an evaluation set of real questions with known answers", "Wait for complaints", "Increase temperature"],
    "answer": 1,
    "explanation": "Offline evaluation catches regressions before rollout."
  }
]
```
