---
title: Anomaly Detection
seoTitle: Design a System to Detect Anomalies in Data
description: Design an anomaly detection system for metrics and business data — streaming ingestion, seasonal baselines per series, scoring, alert deduplication and routing, feedback loops, and scaling to millions of time series.
tags: Scaling Writes, Real-time Updates
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 📉 What is an Anomaly Detection System?
An anomaly detection system watches streams of numbers — orders per minute, error rates, sign-ups by country, payment failures — and raises an alert when something behaves unusually, without anyone setting a fixed threshold for each one. "Unusual" depends on context: 100 orders a minute is normal at 8 p.m. and alarming at 3 a.m. The hard parts are learning what's normal for millions of series and alerting without flooding people with false alarms.
:::

### Functional Requirements

**Core Requirements**

1. Ingest time-series data points from many sources (metrics, events aggregated into counts).
2. Learn a normal pattern per series, including daily and weekly seasonality and trends.
3. Detect anomalies (spikes, drops, level shifts) in near real time and score their severity.
4. Group related anomalies and send alerts to the right owners.
5. Users can mark alerts as true or false to tune detection.

**Below the line (out of scope):**

- Automatic root-cause analysis (mentioned briefly).
- Dashboards (see Metrics Monitoring).

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Detection within ~1-2 minutes of the data arriving.
2. Scale to ~10M time series at one-minute resolution (~170k points per second).
3. Low false-positive rate — noisy alerts get ignored.
4. Robust to missing and late data and to holidays or planned events.

**Below the line (out of scope):**

- Sub-second detection.

```sketch Anomaly Detection Requirements
Functional
- ingest time series
- learn seasonal baselines
- detect + score anomalies
- group + route alerts
- feedback

Non-functional
- detect in 1-2 min
- 10M series, 170k pts/s
- few false positives
- robust to gaps + holidays
```

## The Set Up

### Defining the Core Entities

1. **Series**: metric name plus dimensions (e.g. `orders{country=DE, app=ios}`), owner, sensitivity.
2. **Data point**: series, timestamp, value.
3. **Baseline model**: per series — expected value and spread for each time slot, updated over time.
4. **Anomaly**: series, time, observed, expected, score, direction.
5. **Incident**: a group of related anomalies with status and feedback.

### API or System Interface

```
POST /points [{ series, ts, value }]           (or consume from Kafka)
PUT  /series/:id/config { sensitivity, minVolume, owners, mute windows }
GET  /anomalies?from=&to=&owner=
POST /incidents/:id/feedback { label: true_positive|false_positive }
```

## High-Level Design

### 1) Ingestion

Points flow into **Kafka**, partitioned by series ID, so each series' points are processed in order by one consumer. Raw points are also stored in a time-series database for history and model training.

### 2) Baselines

For each series, a **baseline model** captures the expected value at each point in the week. A practical approach is **seasonal decomposition**: the trend plus a daily and weekly profile, with robust statistics (median and median absolute deviation) so past anomalies don't distort the baseline. Models are retrained daily in a batch job from the last few weeks of history and loaded into the scorer.

### 3) Scoring in the stream

A **stream processor** (Flink) keeps each series' baseline in state. For each new point it computes how far the value is from the expected value relative to normal spread (a z-score-like measure), and requires the deviation to persist for a few points before declaring an anomaly, to filter out one-off noise.

```diagram Detection pipeline
node src 0,1 box "Sources"
node kafka 1.5,1 box "Kafka|by series"
node score 3,1 box "Stream Scorer|baseline in state"
node tsdb 1.5,2.3 circle "Time-series DB"
node train 3,2.3 box "Baseline Training|daily batch"
node alerts 4.5,1 box "Alert Manager"
edge src -> kafka
edge kafka -> score
edge kafka -> tsdb
edge tsdb -> train
edge train -> score "models"
edge score -> alerts "anomalies"
```

### 4) Alerting and feedback

Anomalies go to an **alert manager** that groups related ones (same metric across many dimensions, or same time and service) into one **incident**, routes it to the series owner (Slack, pager, email by severity), and suppresses repeats. Feedback on incidents adjusts per-series sensitivity.

## Potential Deep Dives

### 1) How do we model "normal"?

:::solution bad Static thresholds
#### Approach

Alert when a value crosses a fixed number set by a human.

#### Challenges

Impossible to maintain for millions of series and blind to seasonality: a quiet night triggers false alarms, and a drop at peak time goes unnoticed.
:::

:::solution good Rolling mean and standard deviation
#### Approach

Compare each point with the mean and standard deviation of the last hour or day.

#### Challenges

Ignores daily and weekly patterns, and a big spike inflates the deviation, hiding the next anomaly.
:::

:::solution great Seasonal, robust baselines with forecasting
#### Approach

Model each series with **seasonal decomposition** (or a forecasting model like Holt-Winters or Prophet for important series): the expected value for this minute is based on the same time in previous days and weeks, adjusted by recent trend. Use **robust** statistics so anomalies don't pollute the baseline, and apply **holiday calendars and mute windows** for known events. Sensitivity and minimum-volume rules per series avoid alerts on tiny counts where noise dominates.

#### Challenges

Per-series models at 10M series must be cheap — reserve heavy models for high-value series and use simple seasonal profiles for the long tail.
:::

### 2) How do we avoid alert floods?

A single outage can make thousands of series anomalous at once (every country's orders drop). The alert manager **groups by time window and dimension hierarchy** — reporting "orders dropped globally" instead of 200 per-country alerts — and applies **deduplication** (one open incident per group), **rate limits** per owner and **severity ranking** by business impact (absolute deviation × importance of the metric).

:::tip
Mention precision over recall: an alerting system people trust with fewer, more meaningful alerts beats one that catches everything but is muted by its users.
:::

### 3) How do we handle late and missing data?

Points can arrive late or not at all. The stream processor uses **event time** with a short allowed lateness, and distinguishes "value is zero" from "no data": a missing data stream is its own alert type (the pipeline may be broken) rather than an anomalous drop. When late data arrives, scores are recomputed and anomalies are retracted if no longer valid.

### Final Design

```diagram Final Design
node src 0,1 box "Metrics + Events"
node kafka 1.5,1 box "Kafka"
node scorer 3,1 box "Stream Scorer|event time"
node state 3,-0.3 circle "Baseline State"
node tsdb 1.5,2.3 circle "Time-series DB"
node train 3,2.3 box "Training Jobs|seasonal + holidays"
node am 4.5,1 box "Alert Manager|group · dedupe · rank"
node route 6,1 box "Slack / Pager / Email"
node fb 4.5,2.3 box "Feedback"
edge src -> kafka
edge kafka -> scorer
edge scorer <-> state
edge kafka -> tsdb
edge tsdb -> train
edge train -> scorer "models"
edge scorer -> am
edge am -> route
edge fb -> train "tune sensitivity"
```

```quiz
[
  {
    "question": "Why are static thresholds a poor fit for most series?",
    "options": ["They're too fast", "They ignore daily and weekly patterns and can't be maintained for millions of series", "They're encrypted", "They're illegal"],
    "answer": 1,
    "explanation": "Normal depends on the time of day and week."
  },
  {
    "question": "Why use robust statistics like the median for baselines?",
    "options": ["They're faster", "Past anomalies don't distort what's considered normal", "They're required by Kafka", "They use less memory"],
    "answer": 1,
    "explanation": "Means and standard deviations are pulled by outliers."
  },
  {
    "question": "How do we avoid hundreds of alerts during one outage?",
    "options": ["Disable alerting", "Group related anomalies by time and dimension into one incident", "Send them all", "Delay alerts by a day"],
    "answer": 1,
    "explanation": "One incident summarising the impact is more useful."
  },
  {
    "question": "How should missing data be treated?",
    "options": ["As zero", "As its own signal that the data pipeline may be broken", "Ignored forever", "As the previous value"],
    "answer": 1,
    "explanation": "A silent series is different from a series that dropped to zero."
  }
]
```
