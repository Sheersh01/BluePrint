---
title: Data Warehouse
seoTitle: Design a Data Warehouse for Business Intelligence
description: Design a data warehouse for business intelligence — ingesting from operational databases and events, ELT into layered models, columnar storage and partitioning, a semantic layer for consistent metrics, and fast BI dashboards.
tags: Scaling Reads, Managing Long Running Tasks
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🏛️ What is a Data Warehouse?
A data warehouse (Snowflake, BigQuery, Redshift, or one built on a lakehouse) is where a company brings together data from all its systems — orders, payments, marketing, product events — to answer business questions: "revenue by region last quarter", "conversion by acquisition channel". BI tools like Looker or Tableau query it for dashboards. It's built for scanning and aggregating billions of rows, not for serving individual app requests.
:::

### Functional Requirements

**Core Requirements**

1. Ingest data from operational databases, SaaS tools and event streams.
2. Transform raw data into clean, modelled tables (facts and dimensions) on a schedule.
3. Analysts and BI dashboards should run SQL queries over years of history.
4. Business metrics ("active customer", "net revenue") should have one consistent definition everywhere.
5. Access should be controlled down to tables, columns and rows.

**Below the line (out of scope):**

- Real-time operational analytics (seconds-fresh; see Ad Click Aggregator).
- ML feature pipelines (see ML Platform).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Freshness: most data within an hour; daily for some sources.
2. Dashboards load in a few seconds; ad-hoc queries over billions of rows in tens of seconds.
3. Correct and trustworthy: data quality checks catch broken pipelines before dashboards show wrong numbers.
4. Scale to petabytes and hundreds of concurrent users without one heavy query slowing everyone.
5. Cost-aware: storage is cheap, compute is not.

**Below the line (out of scope):**

- Transactional consistency with source systems at every instant.

```sketch Warehouse Requirements
Functional
- ingest DBs, SaaS, events
- transform into facts + dimensions
- SQL over years of history
- consistent metric definitions
- fine-grained access

Non-functional
- fresh within ~1 hour
- dashboards in seconds
- quality-checked
- petabytes, many users
- cost-aware compute
```

## The Set Up

### Defining the Core Entities

1. **Source**: an operational system or stream feeding the warehouse.
2. **Raw table**: data as ingested, append-only, partitioned by load time.
3. **Model**: a transformation (SQL) producing a cleaned table, with dependencies on other tables.
4. **Fact table**: events or transactions (orders, payments) with keys and measures.
5. **Dimension table**: descriptive attributes (customer, product, date), possibly versioned over time.
6. **Metric**: a named, governed definition (e.g. `net_revenue = sum(amount) - refunds`).

### API or System Interface

```
(ingestion) CDC from databases; connectors for SaaS APIs; Kafka -> object storage
(transform) models as SQL in version control, run by a scheduler/DAG
(query)     SQL endpoint (JDBC/ODBC) for BI tools and analysts
(semantic)  GET /metrics/net_revenue?by=region&from=&to=
```

## High-Level Design

### 1) Ingesting data

Operational databases are replicated with **change data capture** (reading the database log) rather than nightly full dumps, so ingestion is incremental and doesn't load the source. SaaS sources are pulled by connectors; product events stream through Kafka. Everything lands in a **raw layer** in columnar files on object storage, unchanged.

### 2) Transforming in layers (ELT)

Transformations run **inside the warehouse** (ELT) as SQL models in version control: **staging** (clean types, rename, dedupe), **core** (facts and dimensions in a star schema), and **marts** (aggregates for specific teams). A DAG scheduler (Airflow, dbt) runs models in dependency order, incrementally where possible.

```diagram Data flow
node src 0,1 box "Sources|DBs · SaaS · events"
node raw 1.6,1 circle "Raw Layer"
node stage 3.2,1 box "Staging Models"
node core 4.8,1 box "Core|facts + dimensions"
node marts 6.4,1 box "Marts"
node bi 6.4,2.3 box "BI Dashboards"
edge src -> raw "CDC / connectors"
edge raw -> stage
edge stage -> core
edge core -> marts
edge marts -> bi
```

### 3) Querying

Tables are stored in a **columnar** format (Parquet or the warehouse's native format) compressed per column, and **partitioned** (by date) and **clustered** (by common filter columns) so queries read only the needed columns and partitions. A **massively parallel** query engine splits each query across many workers.

### 4) Consistent metrics

A **semantic layer** defines metrics and dimensions once ("net revenue", "region"), and BI tools query through it, so every dashboard computes revenue the same way.

## Potential Deep Dives

### 1) How do we make BI queries fast?

:::solution bad Query the operational database
#### Approach

Run analytics directly on the production Postgres replica.

#### Challenges

Row-oriented storage scans whole rows; big queries take minutes and compete with the app.
:::

:::solution good Columnar warehouse with partitioning
#### Approach

Store data in columnar, compressed tables partitioned by date and processed by an MPP engine.

#### Challenges

Popular dashboards still re-scan large fact tables on every load.
:::

:::solution great Columnar + pre-aggregation + workload isolation
#### Approach

Add **pre-aggregated** tables or materialised views for common dashboard queries (daily revenue by region), refreshed incrementally; enable **result caching** for repeated queries; and separate **compute clusters** per workload (BI dashboards, ad-hoc analysts, heavy transformations) over the same shared storage, so a giant analyst query can't slow down executive dashboards. Compute scales up and down with demand to control cost.

#### Challenges

Pre-aggregates must be kept consistent with the underlying facts — derive them in the same DAG.
:::

### 2) How do we keep data trustworthy?

Every model has **tests**: uniqueness of keys, non-null columns, referential integrity, and row-count and freshness checks against expectations. Failing tests stop downstream models and alert owners, so dashboards show "data delayed" rather than wrong numbers. **Lineage** (which tables feed which dashboards) lets teams see the impact of a broken source, and **data contracts** with source teams catch breaking schema changes before they ship.

:::tip
Mention slowly changing dimensions: when a customer moves region, decide whether past orders report under the old or new region — keep history with versioned dimension rows (SCD type 2).
:::

### 3) How do we control access?

Sensitive columns (emails, payment details) are **masked** or tokenised for most roles; **row-level security** restricts, for example, regional managers to their region. Access is granted to roles, not individuals, and every query is logged for audits. Personal data deletion requests (GDPR) propagate through raw and modelled layers by key.

### Final Design

```diagram Final Design
node src 0,1 box "Operational DBs|+ SaaS + events"
node cdc 1.5,1 box "CDC + Connectors"
node lake 3,1 circle "Object Storage|columnar tables"
node dag 3,-0.3 box "Transform DAG|SQL models + tests"
node bi 4.5,-0.3 box "BI Compute"
node adhoc 4.5,1 box "Ad-hoc Compute"
node sem 6,-0.3 box "Semantic Layer"
node dash 6,1 box "Dashboards + Analysts"
node gov 3,2.3 box "Catalog · Lineage · Access"
edge src -> cdc
edge cdc -> lake
edge dag <-> lake
edge bi <-> lake
edge adhoc <-> lake
edge sem <-> bi
edge dash <-> sem
edge dash <-> adhoc
edge gov -> lake
```

```quiz
[
  {
    "question": "Why use columnar storage for analytics?",
    "options": ["It's easier to update rows", "Queries read only the columns they need, and columns compress well", "It's required by SQL", "For encryption"],
    "answer": 1,
    "explanation": "Analytical queries scan few columns across many rows."
  },
  {
    "question": "What does CDC provide for ingestion?",
    "options": ["Dashboards", "Incremental changes from the database log without heavy full dumps", "Data masking", "Faster queries"],
    "answer": 1,
    "explanation": "Reading the log captures every change with low source impact."
  },
  {
    "question": "What is the semantic layer for?",
    "options": ["Storage", "Defining metrics once so every dashboard calculates them the same way", "Ingestion", "Backups"],
    "answer": 1,
    "explanation": "Consistent definitions build trust in numbers."
  },
  {
    "question": "Why separate compute clusters per workload?",
    "options": ["Cheaper storage", "So heavy ad-hoc queries don't slow dashboards or transformations", "Required by Parquet", "For security only"],
    "answer": 1,
    "explanation": "Shared storage with isolated compute avoids noisy neighbours."
  }
]
```
