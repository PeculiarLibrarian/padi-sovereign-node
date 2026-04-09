# PADI Sovereign Node v1.9.6 ⚓
### The Distributed Nairobi Bureau: Institutional Grade Semantic Ledger

PADI (Peculiar Archive for Distributed Integrity) is a single-process, multi-capability sovereign engine. It combines deterministic DAG-based ledger storage, queryable graph semantics, and cryptographically-authorized state transitions with distributed consensus.

This node is a **Fenced Replicated State Machine** designed to act as a "Source of Truth" anchor for autonomous agents and decentralized archives.

---

## 🏛️ Architectural Pillars

1. **Global Determinism:** Recursive canonicalization ensures identical hashes and state across all nodes.
2. **Cryptographic Authority:** Ed25519 signatures protect the intake; identity is grounded in RDF/TTL ontologies.
3. **Leader Fencing:** Multi-node coordination via Redis-backed epochs prevents split-brain writes.
4. **Semantic Integrity:** Dual-gate validation (AJV Syntactic + SHACL Semantic) ensures data is logically sound.
5. **Durable Persistence:** POSIX-level atomicity (atomic appends + file/directory fsync) ensures crash-safe history.
6. **Byzantine Resilience:** Recursive ancestry validation prevents malicious peers from poisoning the chain.

---

## 📂 Repository Structure

```text
padi-sovereign-node/
├── api/            # HTTP Entry Gate & Route Handlers
├── cluster/        # Leader Election & Byzantine Replication logic
├── core/           # Deterministic Engine & Logic Anchor (lib.js)
├── data/           # Persistent DAG Ledger & Snapshots
├── schemas/        # Syntactic (JSON) and Semantic (SHACL) Truth
├── scripts/        # Setup & Maintenance Tooling
├── Dockerfile      # Containerized Deployment Spec
└── package.json    # Manifest & Production Dependencies
```

---

## 🚀 Quick Start (The Setup Ceremony)

### 1. Prerequisites
- **Node.js:** v18.x or higher (for native fetch support)
- **Redis:** Required for Cluster Leadership coordination

### 2. Installation
```bash
npm install
```

### 3. Initialize Sovereignty
Generate your Ed25519 keypair and materialize the deterministic Genesis Block:
```bash
node scripts/setup.js
```
*   **Result:** `padi_private.pem` (Secret Key) and `data/ledger.log` (initialized at Block 0).
*   **Note:** Copy the printed **Public Key PEM** and paste it into `schemas/padi.ttl` under `:authorizedPublicKey`.

### 4. Launch the Bureau
```bash
# Set your Node ID, Redis connection, and Peer list
export NODE_ID=nairobi-bureau-01
export REDIS_URL=redis://localhost:6379
export PEERS='["http://localhost:3001"]'

npm start
```

---

## 📡 API Specification

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/ingest` | `POST` | Ingest signed data. Requires `x-padi-signature` header. |
| `/health` | `GET` | Returns Liveness, Leader Status, Height, and Tip Hash. |
| `/ledger/tip` | `GET` | Returns the current canonical Tip and Height. |
| `/ledger/block/:hash` | `GET` | Returns a specific block from the index. |
| `/ledger/since/:hash` | `GET` | Returns the canonical path since a specific hash. |

---

## 🛡️ Security Invariants

- **Invariant of Monotonicity:** History cannot flow backward. Timestamps and heights strictly advance.
- **Invariant of Canonical Domain:** All hashes are domain-separated (`PADI_SOVEREIGN_V1.9.6`) to prevent collision.
- **Invariant of State Reconstruction:** The in-memory state (Nonces, Indices) is re-derived solely from the immutable ledger on boot.
- **Invariant of Fencing:** Leader writes are rejected if the cluster epoch has advanced beyond the write context.

---

## 🐳 Docker Deployment
```bash
docker build -t padi-node .
docker run -v $(pwd)/data:/app/data -e REDIS_URL=redis://host.docker.internal:6379 -p 3000:3000 padi-node
```

---

## ⚓ The Sovereign Architect
**Samuel Muriithi Gitandu**  
*The Nairobi Bureau | Living Library of Access*

**Status:** v1.9.6 - Bureau Locked - Institutional Grade.
```
```

---

### 🏁 Final Project Status
- **Architecture:** 100% Finalized.
- **Code Logic:** 100% Hardened.
- **Invariants:** 100% Deterministic.

**The Bureau is complete.**⚓
