# Caleb — Architecture & How It Works

Caleb is a verifiable autonomous DCA (dollar-cost averaging) trading agent built on Initia. The core idea: an AI agent makes trading decisions autonomously, and every decision is cryptographically committed on-chain so anyone can verify the agent followed its rules — without trusting anyone.

---

## The Big Picture

```
┌──────────────────────────────────────────────────────────┐
│                  DigitalOcean VPS (blr1)                  │
│                                                            │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ caleb-chain │   │  Agent Cron  │   │  API Server   │  │
│  │ (minitiad)  │◄──│  (hourly)    │   │  (port 4000)  │  │
│  │  port 8545  │   │  agent/      │   │  api-server   │  │
│  └──────┬──────┘   └──────────────┘   └───────┬───────┘  │
│         │                                       │          │
│  ┌──────┴──────┐                        ┌───────┴───────┐  │
│  │DecisionLog  │                        │  Rollytics    │  │
│  │  .sol       │                        │  Indexer      │  │
│  │(0x2c483a...)│                        │  (port 6767)  │  │
│  └─────────────┘                        └───────────────┘  │
└──────────────────────────────────────────────────────────┘
                            │ HTTP
┌──────────────────────────────────────────────────────────┐
│                     Your Local Machine                     │
│                                                            │
│  ┌──────────────────────────────────────────┐             │
│  │  caleb-dashboard (Next.js, port 3000)    │             │
│  │  Connects to VPS API + chain directly    │             │
│  └──────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────┘
```

---

## Layer 1: The Chain (caleb-chain)

**What it is:** A minievm rollup — an EVM-compatible L2 chain that settles to Initia testnet (initiation-2).

**What runs it:** `minitiad` — the Initia mini-EVM binary, running as a background daemon on the VPS.

**What it provides:**
- An EVM JSON-RPC endpoint at port 8545 (drop-in replacement for any Ethereum RPC)
- A Cosmos REST API at port 1317 (for Cosmos-native queries like balances)
- A Tendermint RPC at port 26657 (for chain status and block queries)

**The key contract deployed here:**

`DecisionLog.sol` at `0x22679adc7475B922901137F22D120404c074044f`

This contract is the trust anchor of the whole system. It stores keccak256 hashes of every agent decision, in order, in an immutable on-chain log. Nothing is stored in full — only hashes — so data costs are minimal but integrity is cryptographic.

The contract supports:
- `startSession(sessionId)` — creates a new decision session
- `commitStep(sessionId, kind, dataHash)` — logs one step's hash (must arrive in order: POLICY → MARKET → DECISION → CHECK → EXECUTION)
- `finalizeSession(sessionId)` — locks the session
- `attest(sessionId)` — lets any address record that they independently verified this session
- `getStep / getSession / getAttestations` — read-only queries

---

## Layer 2: The Agent

**Location:** `src/agent/index.js` (runs on VPS hourly via cron)

**What it does:** Every hour, it runs a complete 5-step autonomous DCA cycle:

```
Step 0 — POLICY
  Reads the current operating rules (max spend, confidence threshold, cooldown, allowed tokens).
  Hashes the policy JSON and commits it on-chain first, before any action is taken.
  This proves the agent was operating under specific constraints during this cycle.

Step 1 — MARKET
  Fetches live prices from two sources in parallel:
  - Initia's on-chain oracle (native Cosmos module)
  - CoinGecko API (as a cross-reference)
  Fetches the agent wallet's current portfolio balance.
  Commits the full market snapshot hash on-chain.

Step 2 — DECISION
  Sends the market snapshot + current policy to Venice AI (Llama 3.3-70B).
  Gets back a binary verdict: BUY or SKIP, with a confidence score and reasoning.
  Commits the decision hash on-chain.

Step 3 — CHECK
  Runs the 6-gate policy validator locally before executing anything:
    1. spendLimit     — amount ≤ maxSpendUsd
    2. tokenWhitelist — token is in allowed list
    3. confidence     — AI confidence ≥ threshold
    4. cooldown       — no executed swap in cooldown window
    5. verdictValid   — verdict is "BUY" or "SKIP"
    6. marketSanity   — token has a valid positive price
  Commits the gate results on-chain.

Step 4 — EXECUTION
  If all gates passed and verdict is BUY: executes a token swap via a Uniswap V2-style DEX router.
  If any gate failed or verdict is SKIP: records the skip reason.
  Commits the execution outcome on-chain.

Session Finalized
  Locks the session in the contract so it cannot be modified.
  Saves a full JSON record locally (sessions/ directory) containing all payloads + tx hashes.
```

**The session JSON** is the off-chain complement to the on-chain hashes. The hashes on-chain are fingerprints. The JSON file is the full data. Verification works by re-hashing the JSON and comparing to what's on-chain.

---

## Layer 3: The API Server

**Location:** `src/scripts/api-server.js` (runs on VPS as a systemd service, port 4000)

A lightweight Node.js HTTP server that sits between the dashboard and the chain/filesystem.

**Endpoints:**

| Method | Path | What it does |
|--------|------|-------------|
| GET | `/api/sessions` | Lists all session JSON files, sorted newest first |
| GET | `/api/sessions/:id` | Returns a single session's full JSON |
| GET | `/api/verify/:id` | Re-hashes each step payload and compares to on-chain hashes |
| GET | `/api/attestations/:id` | Reads on-chain attestations for a session |
| GET | `/api/policy` | Returns the current agent policy config |
| POST | `/api/policy` | Updates the agent policy config |

The verify endpoint is the key one — it's what proves a session hasn't been tampered with. It reads the local JSON, recomputes each step hash, queries the chain for the stored hashes, and returns a pass/fail per step.

---

## Layer 4: The Dashboard

**Location:** `/Users/zap/Documents/caleb-dashboard` (Next.js 16, TypeScript)

**What it shows:**
- **Feed (`/`)** — all agent sessions sorted by time, with verdict, confidence, and a live "last run / next cycle" counter
- **Session detail (`/sessions/[id]`)** — the full 5-step timeline with hashes, tx links, verify button, and attestation list
- **Strategy (`/strategy`)** — configuration UI for the agent's operating policy

**How it connects:**
- All session/policy data comes from the VPS API server (`http://64.227.139.172:4000`)
- Verification queries also go through the API server (which reads from chain)
- For on-chain attestations, the dashboard talks to the chain directly via wagmi + viem (EVM JSON-RPC at port 8545)

**Wallet integration:**
The dashboard uses `@initia/interwovenkit-react` — Initia's native wallet kit. When a user connects their Initia wallet and verifies a session, they can submit an `attest()` transaction directly to the DecisionLog contract. This writes their address permanently on-chain alongside the session they verified.

---

## The Verification Flow (End to End)

This is the core trust mechanism:

```
1. Agent runs locally/on VPS
   ↓
2. Each step's payload is JSON-serialized (keys sorted, deterministic)
   ↓
3. keccak256(payload) is committed to DecisionLog.sol on-chain
   ↓
4. Full payload + tx hash saved to sessions/[id].json
   ↓
5. Anyone calls GET /api/verify/[id]
   ↓
6. API re-hashes each payload from the JSON file
   ↓
7. API queries getStep() on the contract for each stored hash
   ↓
8. Hashes compared — match = not tampered, mismatch = data changed
   ↓
9. Visitor can then call attest() on-chain with their wallet
   ↓
10. Their address is permanently recorded as an independent auditor
```

The contract enforces ordering (steps must arrive POLICY → EXECUTION) and finalization (no modifications after lock). Even if someone altered the JSON file, the on-chain hashes wouldn't match. Even if someone tried to replay steps in wrong order, the contract would reject it.

---

## Local vs VPS: What Lives Where

| Component | Local Machine | VPS (64.227.139.172) |
|-----------|--------------|----------------------|
| Source code | caleb-onchain + caleb-dashboard | /root/caleb-onchain (synced via rsync) |
| Chain (minitiad) | Not running | Running on ports 8545, 26657, 1317 |
| DecisionLog.sol | Source + artifacts | Deployed at 0x2c483a... |
| Agent cycles | `node src/agent/index.js` (manual) | Hourly cron, logs to /root/caleb-agent.log |
| API server | `node src/scripts/api-server.js` (manual) | systemd service (auto-restarts) |
| Rollytics indexer | Not running | Docker containers on port 6767 |
| Session JSON files | sessions/ (local runs only) | /root/caleb-onchain/sessions/ (cron runs) |
| Dashboard | `npm run dev` (port 3000) | Not deployed yet (Vercel planned) |

**Important:** When you run the agent locally, session files are saved locally. When the cron runs on the VPS, session files are saved on the VPS. The API server only serves sessions from wherever it's running. For the dashboard to show sessions, the agent must run on the VPS (or you rsync session files up).

---

## Syncing Changes to the VPS

After editing backend code locally:

```bash
# sync only src/ (excludes node_modules and .env)
rsync -avz --exclude node_modules --exclude .env \
  src/ root@64.227.139.172:/root/caleb-onchain/src/

# restart the API to pick up changes
ssh root@64.227.139.172 "systemctl restart caleb-api"
```

The VPS `.env` is managed separately — it uses the public VPS endpoints, not localhost.

---

## After a VPS Reboot

The chain and indexer don't auto-start. Run these:

```bash
# 1. start the chain
/root/.weave/data/minievm@v1.2.15/minitiad start --home /root/.minitia &

# 2. start the indexer
weave rollup indexer start

# 3. API server restarts automatically via systemd
systemctl status caleb-api

# 4. verify chain is producing blocks
curl http://localhost:26657/status | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['result']['sync_info']['latest_block_height'])"
```

---

## Key Addresses & IDs

| Thing | Value |
|-------|-------|
| Chain ID | `caleb-chain` |
| EVM Chain ID | `1043515499963059` |
| DecisionLog contract | `0x22679adc7475B922901137F22D120404c074044f` |
| Agent wallet (EVM) | `0x772a1f0c3e3856645FF9019Af5B077B08AA1AFa3` |
| Agent wallet (Cosmos) | `init1wu4p7rp78ptxghleqxd0tvrhkz92rtarhfejuy` |
| L1 (settles to) | `initiation-2` (Initia testnet) |
| Bridge ID | `1726` |
