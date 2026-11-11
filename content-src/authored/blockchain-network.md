---
title: Blockchain Network
seoTitle: Design a Blockchain Network
description: Design a blockchain network — peer-to-peer gossip of transactions and blocks, a mempool, consensus and finality, state storage with Merkle proofs, and light clients.
tags: Dealing with Contention, Scaling Writes
difficulty: hard
author: Editorial Team
published: Nov 11, 2026
---

## Understanding the Problem

:::definition ⛓️ What is a Blockchain Network?
A blockchain network is a set of independently operated nodes that agree on a single ordered history of transactions without trusting any one party. Transactions are grouped into **blocks**, each linked to the previous one by a cryptographic hash, and a **consensus** protocol decides which block comes next. The interesting design problem is agreement among nodes that may be faulty or malicious.
:::

### Functional Requirements

**Core Requirements**

1. Users should be able to submit signed transactions transferring value between accounts.
2. Nodes should agree on the order of transactions and on every account's balance.
3. Once a transaction is final, it should never be reversed.
4. Anyone should be able to run a node, and lightweight clients should be able to verify their balance without downloading everything.

**Below the line (out of scope):**

- Smart contract execution details (mentioned briefly).
- Token economics and fees policy.
- Wallet user experience.

:::tryit First Question
What are the non-functional requirements for this system?
:::

### Non-Functional Requirements

**Core Requirements**

1. Safety under Byzantine faults: correct as long as fewer than one third of validators (by stake) are malicious.
2. Finality in seconds, not hours.
3. Throughput of ~1,000+ transactions per second.
4. Open participation across thousands of nodes over the public internet.

**Below the line (out of scope):**

- Privacy of transaction contents.

```sketch Blockchain Requirements
Functional
- submit signed transactions
- agree on order + balances
- irreversible finality
- open nodes + light clients

Non-functional
- tolerate < 1/3 malicious
- finality in seconds
- 1,000+ TPS
- thousands of nodes
```

## The Set Up

### Defining the Core Entities

1. **Account**: address (derived from a public key), balance, nonce.
2. **Transaction**: from, to, amount, nonce, fee, signature.
3. **Block**: header (parent hash, height, state root, transactions root, proposer) and a list of transactions.
4. **Validator**: a node with stake that proposes and votes on blocks.
5. **State**: the map of all accounts, committed to by a Merkle root.

### API or System Interface

```
POST /tx { signedTx }                  -> txHash   (submitted to any node)
GET  /tx/:hash -> { status: pending|included|final, blockHeight }
GET  /accounts/:address?proof=true -> { balance, nonce, merkleProof }
P2P: gossip(tx), gossip(block), vote(blockHash, round)
```

## High-Level Design

### 1) Submitting transactions

A user signs a transaction with their private key and sends it to any node. The node checks the signature, the nonce (to prevent replays) and the balance, adds it to its **mempool** (pending transactions), and **gossips** it to peers, so it spreads across the network in seconds.

```diagram Gossip
node wallet 0,1 box "Wallet|signs tx"
node n1 1.5,1 circle "Node"
node n2 3,0 circle "Node"
node n3 3,2 circle "Node"
node v 4.5,1 circle "Validator"
edge wallet -> n1 "signed tx"
edge n1 -> n2 "gossip"
edge n1 -> n3 "gossip"
edge n2 -> v
edge n3 -> v
```

### 2) Proposing blocks

In each slot, one **validator** is chosen (by stake-weighted rotation) as **proposer**. It picks transactions from its mempool (highest fees first), executes them to compute the new **state root**, and broadcasts the block.

### 3) Reaching agreement

Validators verify the block (signatures, execution, state root) and **vote**. A BFT-style protocol (like Tendermint or HotStuff) commits the block once validators holding **more than two thirds of the stake** have voted in two rounds (prepare, then commit). Once committed, the block is **final**: no conflicting block can gather the same supermajority without at least a third of validators provably misbehaving.

### 4) Storing state and serving light clients

Each node applies committed blocks to its **state database**, a Merkle tree (e.g. a Patricia trie) over accounts. The state root in each block header lets a **light client**, which only follows block headers, verify any balance with a short **Merkle proof** from a full node.

## Potential Deep Dives

### 1) Which consensus approach?

:::solution bad Longest-chain with no finality
#### Approach

Anyone can extend the chain; the longest chain wins.

#### Challenges

Forks mean transactions are only probabilistically final — users wait for many confirmations, and finality can take an hour.
:::

:::solution good Proof of work
#### Approach

Miners compete to solve a hash puzzle; the chain with the most cumulative work wins. Open participation without identities.

#### Challenges

Enormous energy use, low throughput (~7-15 TPS), and still only probabilistic finality.
:::

:::solution great Proof of stake with BFT finality
#### Approach

Validators lock up **stake**; proposers rotate, and blocks are finalised by a **two-thirds stake supermajority** of votes. Equivocation (voting for two conflicting blocks) is provable from signed votes and punished by **slashing** stake. This gives deterministic finality in seconds with tolerable energy use.

#### Challenges

BFT voting is O(n²) messages, so the active validator set is limited (hundreds) or votes are aggregated with signature schemes like BLS.
:::

### 2) How do we raise throughput?

Bigger and faster blocks increase throughput but also the bandwidth and hardware needed to run a node, which hurts decentralisation. Common techniques: **pipelining** consensus rounds, **parallel execution** of non-conflicting transactions, and moving most activity to **layer-2 rollups** that batch thousands of transactions and post compressed data plus proofs to the main chain.

:::tip
Name the trilemma: security, decentralisation and scalability pull against each other. Every design choice trades one for another.
:::

### 3) How do new nodes join?

A new node downloads block headers, verifies the chain of hashes and validator signatures, then **state-syncs**: fetches a recent state snapshot in chunks from peers, verifying each against the state root, and replays only recent blocks. Peer discovery uses a DHT plus seed nodes; nodes limit connections per IP range to resist **eclipse attacks**.

### Final Design

```diagram Final Design
node wallet 0,1 box "Wallets"
node rpc 1.5,1 box "RPC Nodes|validate + mempool"
node p2p 3,1 circle "P2P Gossip"
node vals 4.5,1 box "Validators|propose · vote"
node state 4.5,2.4 circle "State DB|Merkle trie"
node light 0,2.4 box "Light Clients"
node full 1.5,2.4 box "Full Nodes|proofs"
edge wallet -> rpc
edge rpc <-> p2p
edge p2p <-> vals "txs, blocks, votes"
edge vals -> state "commit"
edge light <-> full "headers + proofs"
edge full <-> p2p
```

```quiz
[
  {
    "question": "Why do transactions carry a nonce?",
    "options": ["For encryption", "To prevent the same signed transaction being replayed", "To pay fees", "To pick a validator"],
    "answer": 1,
    "explanation": "Each account's nonce must increase, so an old transaction can't be resubmitted."
  },
  {
    "question": "How many validators (by stake) must vote to finalise a block in BFT proof of stake?",
    "options": ["Any one", "More than two thirds", "Exactly half", "All of them"],
    "answer": 1,
    "explanation": "A two-thirds supermajority tolerates up to one third faulty validators."
  },
  {
    "question": "How does a light client verify its balance?",
    "options": ["Trust any node", "A Merkle proof checked against the state root in a block header", "Download all blocks", "Ask a validator for a password"],
    "answer": 1,
    "explanation": "Proofs are small and verifiable against headers."
  },
  {
    "question": "What is slashing?",
    "options": ["Cutting fees", "Destroying stake of validators who provably misbehave", "Removing old blocks", "Splitting the chain"],
    "answer": 1,
    "explanation": "It makes attacks costly and accountable."
  }
]
```
