---
title: Search & Recommendations
subtitle: Indexing, inverted indexes, relevance ranking, filtering approaches and the cold-start problem.
seoTitle: System Design Interview Questions — Search & Recommendation Concepts
section: questions
category: Questions
author: Editorial Team
published: Nov 10, 2026
---

:::qa 81 | Define | B | What is indexing in search engines and why is it important?
Indexing is processing documents ahead of time into data structures that make search fast. Without an index, every query would scan every document — impossible at millions or billions of documents.

The pipeline: parse documents, **tokenise** text into terms, **normalise** (lowercase, stemming, removing stop words), and build an inverted index plus per-document data (fields, scores) used for filtering and ranking. Indexes are updated as documents change, often in near-real time.

**In the interview:** "Posts are indexed asynchronously via CDC into Elasticsearch, so search reads an index rather than scanning the database."

**Go deeper:** [Elasticsearch](/learn/system-design/deep-dives/elasticsearch) · [Web Search Engine](/learn/system-design/problem-breakdowns/search-engine)
:::

:::qa 82 | Define | I | What are inverted indexes and how are they used in search?
An inverted index maps each **term** to a **posting list** — the documents containing it, often with term frequencies and positions. It's "inverted" because instead of document → words, it stores word → documents.

To answer "hiking boots", the engine fetches the posting lists for `hiking` and `boots`, intersects them to find documents containing both, and scores the matches. Positions enable phrase queries; compressed posting lists (delta encoding) keep the index small enough for memory.

**In the interview:** "Search is posting-list intersection plus scoring; the index is sharded by document so each shard answers locally."

**Go deeper:** [FB Post Search](/learn/system-design/problem-breakdowns/fb-post-search)
:::

:::qa 83 | Define | B | What is relevance ranking and why does it matter?
Relevance ranking orders matching results by how well they answer the query. Users rarely look past the first few results, so ranking quality *is* search quality.

Signals include **text relevance** (TF-IDF, BM25: how often query terms appear, weighted by how rare they are), **field boosts** (title matches count more), **quality and popularity** (PageRank, ratings, clicks), **freshness**, and **personal context** (location, history). Production systems rank in stages: a cheap score on many candidates, then a machine-learned model on the top few hundred.

**In the interview:** "BM25 plus freshness for first-pass ranking, then a learned re-ranker on the top 200 using click signals."
:::

:::qa 84 | Compare | I | Collaborative filtering vs content-based filtering.
**Collaborative filtering** recommends based on **behaviour patterns across users**: "people who liked what you liked also liked X". It discovers surprising connections without understanding the items, but suffers from cold start (new users/items have no interactions) and popularity bias.

**Content-based filtering** recommends items **similar in attributes** to what the user engaged with (genre, tags, text embeddings). It works for new items and is explainable, but tends to over-specialise ("more of the same").

Modern systems are **hybrid**, often learning user and item embeddings that combine both signals.

**In the interview:** "Collaborative signals for users with history, content features to place new items, blended in a single ranking model."

**Go deeper:** [Recommendation Engine](/learn/system-design/problem-breakdowns/recommendation-engine)
:::

:::qa 85 | Define | I | What is the cold start problem in recommendation systems? Solutions?
Cold start is the difficulty of recommending when there's little or no interaction data:

- **New users**: no history. Use popular/trending items, onboarding questions (pick genres), and context (location, device, referrer); adapt quickly from the first few interactions.
- **New items**: no one has engaged yet. Use **content features** (metadata, text/image embeddings) to place them near similar items, and reserve some **exploration** traffic to gather signal.
- **New system**: start with editorial curation and simple popularity until data accumulates.

**In the interview:** "New users get trending-by-region plus onboarding picks; new items get content embeddings and a small exploration budget."
:::
