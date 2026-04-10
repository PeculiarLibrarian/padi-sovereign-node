# ⚓ PADI Sovereign Node v1.9.7c

**Deterministic. Verifiable. Single-writer secure.**

PADI Sovereign Node is a **cryptographically verifiable, append-only ledger system** with **strict leader control**, **epoch-based safety**, and **deterministic state transitions**.

This system is designed for **production-grade integrity**, not experimentation.

---

# 🧠 Core Principles

- **Determinism First** — identical inputs always yield identical state
- **Single Writer** — enforced via Redis-backed leader election
- **Tamper Evidence** — full-chain hashing + canonicalization
- **Strict Validation** — JSON Schema + SHACL constraints
- **Crash Consistency** — POSIX `fsync` durability
- **Replay Immunity** — nonce enforcement across canonical chain
- **Epoch Safety** — prevents state regression under failure

---

# 🏗️ Architecture Overview

```

```
            ┌──────────────┐
            │  Public Node │  ← LEADER_ELIGIBLE=true
            │  (Ingress)   │
            └──────┬───────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
```

┌────────────┐ ┌────────────┐ ┌────────────┐
│ Private    │ │ Private    │ │ Private    │
│ Node       │ │ Node       │ │ Node       │
│ READ_ONLY  │ │ READ_ONLY  │ │ READ_ONLY  │
└────────────┘ └────────────┘ └────────────┘

```

---

# 🔐 Security Model

## Enforced Guarantees

- **Authenticated Writes**
  - Ed25519 signature verification
  - Public keys anchored in RDF graph

- **Replay Protection**
  - Nonce tracking across canonical ledger

- **Leader Exclusivity**
  - Redis lease (`NX PX`)
  - Epoch fencing

- **State Integrity**
  - Canonical JSON hashing
  - Full ledger verification on boot

- **Schema Enforcement**
  - AJV (strict mode)
  - SHACL constraints

- **Epoch Monotonicity**
  - Prevents rollback even if Redis resets

---

## Explicit Non-Goals

- Byzantine fault tolerance
- Anonymous / trustless operation
- DoS resistance at network edge
- Key compromise protection

---

# 📦 Project Structure

```

.
├── api/
│   └── server.js          # HTTP interface
├── core/
│   ├── engine.js          # Ledger + validation engine
│   └── lib.js             # Canonicalization + crypto
├── cluster/
│   ├── cluster.js         # Leader election (Redis)
│   └── replicator.js      # Peer synchronization
├── schemas/
│   ├── schema.json        # JSON schema
│   └── padi.ttl           # SHACL + key registry
├── scripts/
│   └── setup.js           # Keygen + genesis
├── data/                  # Ledger + snapshots (runtime)
├── Dockerfile
├── package.json
└── .gitignore

````

---

# 🚀 Setup

## 1. Install Dependencies

```bash
npm install
````

## 2. Initialize System

```bash
npm run setup
```

This generates:

* `padi_private.pem`
* `padi_public.pem`
* `data/ledger.log` (genesis block)

---

## 3. Configure Environment

```bash
export REDIS_URL=redis://localhost:6379
export NODE_ID=node-1
export LEADER_ELIGIBLE=true
export READ_ONLY=false
export PEERS='["http://node-2:3000","http://node-3:3000"]'
```

---

## 4. Start Node

```bash
npm start
```

---

# 🌐 API Reference

## Health

```
GET /health
```

**Response**

```json
{
  "status": "OK",
  "leader": true,
  "h": 42,
  "tip": "abc123..."
}
```

---

## Submit Payload

```
POST /api/ingest
Headers:
  x-padi-signature: <base64>
```

**Body**

```json
{
  "timestamp": 1700000000000,
  "nonce": "unique-value",
  "verifiedBy": "node",
  "epoch": 5,
  "v": "1.9.7",
  "context": "StructuralShape",
  "gridScore": 100,
  "invisibilityCoefficient": 0.5
}
```

---

## Get Tip

```
GET /ledger/tip
```

---

## Get Block

```
GET /ledger/block/:hash
```

---

## Stream From Hash

```
GET /ledger/since/:hash
```

---

# ⚙️ Deployment Model

## Node Roles

| Role             | Config                         | Capability        |
| ---------------- | ------------------------------ | ----------------- |
| Leader Candidate | `LEADER_ELIGIBLE=true`         | Can become leader |
| Ingress Node     | `LEADER_ELIGIBLE=true`, public | Accepts writes    |
| Replica Node     | `READ_ONLY=true`               | Sync only         |

---

## Recommended Topology

* **1 Public Leader Node**
* **N Private Replica Nodes**
* **Shared Redis Instance**

---

# 🔁 Replication

* Pull-based synchronization

* Canonical chain selection:

  * Highest height wins
  * Tie-break: lowest hash

* Backfill limit: **500 blocks per sync**

---

# 💾 Persistence Model

* Append-only log: `data/ledger.log`
* Snapshot every **1000 blocks**
* Full `fsync` on every write

---

# ⚠️ Operational Constraints

* Redis must be **highly available**
* System clock drift must be **<5 seconds**
* Keys must be **securely stored**
* Disk must support **fsync guarantees**

---

# 🔍 Failure Behavior

| Failure         | Outcome                                    |
| --------------- | ------------------------------------------ |
| Node crash      | Safe recovery via ledger replay            |
| Redis reset     | Epoch monotonicity prevents rollback       |
| Leader loss     | New leader elected                         |
| Network split   | Temporary divergence, eventual convergence |
| Invalid payload | Rejected deterministically                 |

---

# 🧪 Invariants

The system enforces:

* No duplicate nonce in canonical chain
* No block with invalid hash
* No unsigned payload accepted
* No epoch regression
* No multi-parent chain (strict linearity)

---

# 🐳 Docker

```bash
docker build -t padi-node .
docker run -p 3000:3000 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e NODE_ID=node-1 \
  -e LEADER_ELIGIBLE=true \
  padi-node
```

---

# 🏁 Final Statement

PADI Sovereign Node v1.9.7c is:

> A **deterministic, leader-based, cryptographically verifiable ledger system** with **strict validation and bounded failure modes**.

It is **production-ready**, **operationally stable**, and **architecturally complete**.

No further structural changes are required.

```
```
