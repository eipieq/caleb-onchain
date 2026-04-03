# Caleb — Verifiable Autonomous Trading Agent on Initia

Caleb is an autonomous HFT trading agent that runs a momentum/mean-reversion strategy against live market prices and commits a cryptographic audit trail of every decision to an EVM minitia chain on Initia.

**The core idea:** you shouldn't have to trust the agent operator. Every decision the agent makes — its policy, the market data it saw, the AI verdict, the risk gates it checked, and what it executed — is hashed and committed to chain *before* any trade executes. Anyone can verify the agent followed its rules, independently, without trusting anyone.

---

## Architecture

```
CoinGecko / Initia Oracle
         │  live prices
         ▼
┌─────────────────────┐      ┌──────────────────────────┐
│   Agent Runner      │─────▶│   DecisionLog.sol        │
│   2s tick loop      │      │   caleb-chain (minitia)  │
│   momentum strategy │      │   settles → initiation-2 │
└─────────────────────┘      └──────────────────────────┘
         │  session JSON                │  keccak256 hashes
         ▼                             ▼
┌─────────────────────┐      ┌──────────────────────────┐
│   API Server        │      │   Verification           │
│   port 4000         │      │   re-hash local JSON     │
│   sessions, verify  │      │   compare to on-chain    │
└─────────────────────┘      └──────────────────────────┘
         │
         ▼
┌─────────────────────┐
│   Dashboard         │
│   Next.js + wagmi   │
│   wallet login      │
│   live P&L          │
│   verify button     │
└─────────────────────┘
```

---

## How the Audit Trail Works

Every agent cycle commits a 5-step session to chain:

| Step | What | Why |
|------|------|-----|
| `POLICY` | Hash of operating rules (max spend, cooldown, token whitelist) | Proves the agent's constraints before it acted |
| `MARKET` | Hash of live price snapshot | Proves what data the agent saw |
| `DECISION` | Hash of AI verdict (BUY/SKIP, confidence, reasoning) | Proves what the agent decided |
| `CHECK` | Hash of 6-gate risk validation results | Proves each safety gate was evaluated |
| `EXECUTION` | Hash of trade outcome or skip reason | Proves what actually happened |

The `DecisionLog.sol` contract enforces ordering — steps must arrive POLICY → EXECUTION — and locks the session after finalization. Steps cannot be replayed or reordered.

**Verification:** the API server re-hashes each step payload from the local JSON file and compares to the on-chain hashes via `getStep()`. Any tampering with the JSON produces a hash mismatch. The dashboard exposes this as a one-click verify button.

**Attestation:** any wallet can call `attest(sessionId)` on the contract to record that they independently verified a session. Their address is permanently on-chain.

---

## The Contract

`DecisionLog.sol` — deployed at `0x22679adc7475B922901137F22D120404c074044f` on `caleb-chain`

Key functions:
- `startSession(sessionId)` — opens a new audit session
- `commitStep(sessionId, stepKind, dataHash)` — records one step hash (enforces ordering)
- `finalizeSession(sessionId)` — locks the session immutably
- `attest(sessionId)` — independent verification record
- `getStep / getSession / getAttestationCount` — read-only audit queries

---

## The Agent

**Runner** (`src/engine/runner.js`) — 2-second tick loop:
- Reads live prices from CoinGecko (cached every 500ms independently of the tick)
- Applies configurable strategy (momentum breakout or mean-reversion)
- Runs 6-gate policy check before any execution
- Commits to chain selectively: only on trades, blocked gates, or 60s heartbeats (not every tick — to avoid chain spam)
- Tracks portfolio P&L in `data/portfolio.json`

**Strategies** (`src/strategies/`):
- `momentum.js` — buy when price breaks out above rolling high, sell on reversal
- `mean-revert.js` — buy at oversold RSI, sell at overbought

**Policy gates** (all must pass before any trade):
1. Spend within `maxSpendUsd` limit
2. Token is in whitelist
3. AI confidence ≥ threshold
4. Cooldown period elapsed since last trade
5. Verdict is a valid value
6. Token has a positive live price

---

## The Dashboard

Live at: https://caleb-app.vercel.app

- Connect Initia wallet via InterwovenKit
- See your live INIT balance on Initia testnet
- Configure your own strategy (per-wallet policy stored on the backend)
- Watch agent decisions stream in with verdict, confidence, reasoning
- Click any session to see the full 5-step audit timeline with on-chain tx links
- One-click verify: re-hashes all steps and compares to chain
- Attest: sign a transaction to permanently record your verification on-chain

---

## Stack

| Layer | Tech |
|-------|------|
| Chain | Initia minitia (minievm), settles to `initiation-2` |
| Smart contract | Solidity (Hardhat), `DecisionLog.sol` |
| Agent | Node.js (ESM), ethers.js |
| Prices | CoinGecko API |
| API | Plain Node.js HTTP (no framework) |
| Dashboard | Next.js 14, wagmi, @tanstack/react-query |
| Wallet | `@initia/interwovenkit-react` |

---

## Running Locally

**Prerequisites:** Node.js 18+, a `.env` file (see `.env.example`)

```bash
# install
npm install

# run the agent (simulated swaps, real prices)
SIMULATE=true STRATEGY=momentum node src/engine/runner.js

# run the API server
SIMULATE=true node src/scripts/api-server.js
```

**Environment variables:**

```env
INITIA_RPC_URL=http://64.227.139.172:8545
PRIVATE_KEY=<agent wallet private key>
DECISION_LOG_ADDRESS=0x22679adc7475B922901137F22D120404c074044f
SIMULATE=true
STRATEGY=momentum
```

---

## Repo Structure

```
contracts/
  DecisionLog.sol          — on-chain audit log contract

src/
  engine/
    runner.js              — 2s tick loop, selective chain commits
    portfolio.js           — P&L tracking
    position.js            — position sizing
  strategies/
    momentum.js            — breakout strategy
    mean-revert.js         — RSI reversion strategy
  chain/
    client.js              — ethers.js wrapper for DecisionLog
  market/
    index.js               — CoinGecko price fetching
    cache.js               — 500ms background price cache
    mock.js                — GBM fallback (emergencies only)
  policy/
    index.js               — 6-gate risk validator
  scripts/
    api-server.js          — HTTP API for dashboard
    deploy.js              — contract deployment

sessions/                  — local session JSON files (audit records)
data/
  portfolio.json           — persistent P&L state
  policies/                — per-wallet strategy configs

frontend/ → see caleb-app/ (separate Next.js repo)
```

---

## Key Design Decisions

**Why a custom minitia instead of deploying on initiation-2 directly?**
The agent commits on every meaningful event (trades, blocked gates, 60s heartbeats). On a shared testnet this would be noise. A dedicated chain keeps the audit log clean and gives us full control over gas pricing.

**Why hash-only on chain instead of full payloads?**
Data costs. A full market snapshot is 2-5KB per step. At 2s ticks with selective logging, that's still potentially thousands of sessions. Hashes are 32 bytes, calldata is cheap. The full data lives in `sessions/` — the chain stores the fingerprints.

**Why selective chain commits (not every tick)?**
A 2s tick loop produces 43,000+ ticks/day. Most are SKIP — no signal, nothing happened. Committing every tick would spam the chain and make the audit log unreadable. Only ticks where something happened (trade, blocked gate, heartbeat) get committed.

**SIMULATE=true**
Swap execution is mocked — the agent makes real decisions based on real prices but doesn't call a DEX. All other components (policy, chain commits, portfolio tracking) run for real.
