---
title: ML Platform
seoTitle: Design a Machine Learning Platform and ML Data Pipeline
description: Design an internal machine learning platform — data pipelines and a feature store, distributed training jobs, experiment tracking, a model registry, and online serving with monitoring.
tags: Managing Long Running Tasks, Scaling Reads
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition 🧠 What is an ML Platform?
An ML platform (like Uber's Michelangelo or the tooling behind SageMaker and Vertex AI) gives data scientists one paved road from raw data to a model in production: pipelines that turn data into features, infrastructure to train models, a registry to version them, and serving to make predictions — with monitoring to catch when models go stale. This page also covers designing the **data pipeline for an ML application**, which is the first half of the platform.
:::

### Functional Requirements

**Core Requirements**

1. Teams should be able to define features once and use them for both training and online prediction.
2. Teams should be able to launch training jobs on CPUs/GPUs and track experiments (parameters, metrics, artefacts).
3. Trained models should be versioned in a registry and promoted to production.
4. Production services should get low-latency online predictions; batch predictions should also be supported.
5. Models should be monitored for data drift and prediction quality.

**Below the line (out of scope):**

- Labelling tools.
- LLM fine-tuning specifics (mentioned briefly).
- AutoML.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. No training/serving skew: a feature has the same value logic offline and online.
2. Online prediction latency < 20 ms p99 including feature lookup.
3. Reproducibility: any model can be traced to its exact data, code and parameters.
4. Efficient use of expensive GPUs across many teams.
5. Scale to hundreds of models and ~100k predictions per second.

**Below the line (out of scope):**

- Multi-cloud training.

```sketch ML Platform Requirements
Functional
- define features once
- training jobs + experiment tracking
- model registry + promotion
- online + batch predictions
- drift monitoring

Non-functional
- no training/serving skew
- predictions < 20ms p99
- reproducible models
- share GPUs efficiently
```

## The Set Up

### Defining the Core Entities

1. **Feature**: a named, versioned transformation (e.g. `user_orders_7d`) with an entity key.
2. **Dataset**: a point-in-time snapshot of features and labels used for training.
3. **Training run**: code version, data snapshot, hyperparameters, metrics, artefacts.
4. **Model version**: a registered artefact with lineage and stage (`staging`, `production`).
5. **Endpoint**: a deployed model serving predictions.

### API or System Interface

```
feature_store.register(feature_definition)
feature_store.get_training_data(entity_df, features, as_of)
POST /training-jobs { image, datasetId, resources: { gpus: 8 }, params }
POST /models/:name/versions/:v/promote { stage: production }
POST /endpoints/:name/predict { entityId, inputs } -> { prediction, modelVersion }
```

## High-Level Design

### 1) Data pipelines and the feature store

Raw data arrives from service databases (via CDC) and event streams into a **data lake**. Feature pipelines — **batch** (Spark) for slow-moving features and **streaming** (Flink) for fresh ones — compute features from one shared definition. Results go to two stores: an **offline store** (the lake, keeping full history for training) and an **online store** (Redis/DynamoDB, latest value per entity for serving).

```diagram Feature pipelines
node src 0,1 box "Service DBs|+ event streams"
node lake 1.5,1 circle "Data Lake"
node batch 3,0 box "Batch Pipelines|Spark"
node stream 3,2 box "Stream Pipelines|Flink"
node offline 4.5,0 circle "Offline Store"
node online 4.5,2 circle "Online Store"
edge src -> lake
edge lake -> batch
edge src -> stream
edge batch -> offline
edge stream -> online
edge stream -> offline
```

### 2) Training and experiment tracking

A data scientist requests a training dataset with **point-in-time joins** (feature values as they were at each label's timestamp, never from the future). The **training service** schedules the job on a GPU cluster (Kubernetes with a batch scheduler), and the run logs parameters, metrics and artefacts to an **experiment tracker**.

### 3) Model registry

The best run is registered as a **model version** with full lineage: code commit, dataset snapshot, feature versions and metrics. Promotion to production requires passing evaluation gates.

### 4) Serving and monitoring

The **model server** loads the production version. For each request it fetches the entity's features from the online store, runs the model, and returns the prediction. Every prediction and its features are **logged**, so monitoring can compare live feature distributions to training data (drift) and join predictions with later outcomes to measure accuracy.

## Potential Deep Dives

### 1) How do we prevent training/serving skew?

:::solution bad Separate code for training and serving
#### Approach

Data scientists compute features in notebooks; engineers reimplement them in the serving service.

#### Challenges

The two implementations drift apart, and the model silently performs worse in production than offline.
:::

:::solution good Shared feature definitions
#### Approach

Features are defined once in the feature store and the same definition generates both the offline backfill and the online pipeline.

#### Challenges

Still possible to leak future data into training if joins aren't time-aware.
:::

:::solution great Point-in-time correctness + logged features
#### Approach

Training datasets use **point-in-time joins** against the offline store's history, so each training example sees only what would have been known then. In addition, the serving layer **logs the exact features it used** for each prediction; future training data can be built from these logs, guaranteeing training matches serving exactly.

#### Challenges

Logging every feature vector is a large data volume — sample for high-traffic models.
:::

### 2) How do we share GPUs across teams?

GPUs are scarce and expensive. A **cluster scheduler** with per-team **quotas** and **priority** classes runs jobs; low-priority jobs can borrow idle capacity and are **preempted** when owners need it, so training code must **checkpoint** regularly. Gang scheduling makes sure a distributed job gets all its GPUs at once rather than holding half of them idle.

:::tip
Mention that checkpointing turns preemption from a disaster into a minor delay — the job resumes from its last checkpoint.
:::

### 3) How do we deploy models safely?

Promotion goes through **shadow mode** (the new model scores live traffic but its predictions aren't used), then a **canary** taking a small share of traffic with metrics compared against the current model, then full rollout. Rollback is switching the endpoint back to the previous version, which stays loaded for a while.

### Final Design

```diagram Final Design
node src 0,1 box "Data Sources"
node pipes 1.5,1 box "Feature Pipelines|batch + stream"
node offline 3,0 circle "Offline Store"
node online 3,2 circle "Online Store"
node train 4.5,0 box "Training Service|GPU scheduler"
node reg 6,0 circle "Model Registry"
node serve 4.5,2 box "Model Server"
node mon 6,2 box "Prediction Logs|+ drift monitor"
edge src -> pipes
edge pipes -> offline
edge pipes -> online
edge offline -> train "point-in-time data"
edge train -> reg
edge reg -> serve "deploy"
edge online -> serve
edge serve -> mon
```

```quiz
[
  {
    "question": "What is training/serving skew?",
    "options": ["Slow training", "Features computed differently in training and production, degrading the live model", "GPU shortages", "Large models"],
    "answer": 1,
    "explanation": "Shared definitions and logged features prevent it."
  },
  {
    "question": "Why use point-in-time joins for training data?",
    "options": ["They're faster", "So each example only sees feature values known at that time, avoiding leakage", "To reduce storage", "To encrypt data"],
    "answer": 1,
    "explanation": "Future information in training makes offline metrics misleadingly good."
  },
  {
    "question": "Why does a feature store have both offline and online stores?",
    "options": ["Redundancy", "Training needs full history; serving needs the latest value in milliseconds", "Regulations", "Cost only"],
    "answer": 1,
    "explanation": "Different access patterns need different storage."
  },
  {
    "question": "What makes GPU preemption tolerable for training jobs?",
    "options": ["Smaller models", "Regular checkpoints so jobs resume where they left off", "Faster GPUs", "No preemption"],
    "answer": 1,
    "explanation": "Checkpointing lets the scheduler share GPUs aggressively."
  }
]
```
