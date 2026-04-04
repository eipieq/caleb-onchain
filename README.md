# caleb — verifiable autonomous trading agent on Initia

caleb is an autonomous trading agent that runs a momentum strategy against live prices and commits a cryptographic audit trail of every decision to an EVM minitia on Initia. you shouldn't have to trust the agent operator. every decision — the policy it ran under, the market data it saw, the AI verdict, the risk gates it checked, and what it executed — is hashed and committed to chain before any trade happens. anyone can verify the agent followed its rules without trusting anyone.

**live:** [caleb.sandpark.co](https://caleb.sandpark.co) · [app.caleb.sandpark.co](https://app.caleb.sandpark.co)

**repos:** [caleb-onchain](https://github.com/eipieq/caleb-onchain) · [caleb-app](https://github.com/eipieq/caleb-app) · [caleb (landing)](https://github.com/eipieq/caleb)

---

## architecture

![architecture](./proof_of_agent_architecture.svg)

---

## how the audit trail works

every agent cycle commits 5 ordered steps to chain:

| step | what it stores | why it matters |
|------|----------------|----------------|
| `POLICY` | hash of operating rules (max spend, cooldown, whitelist) | proves the agent's constraints before it acted |
| `MARKET` | hash of live price snapshot | proves what data the agent saw |
| `DECISION` | hash of AI verdict (BUY/SKIP, confidence, reasoning) | proves what the agent decided |
| `CHECK` | hash of 6-gate risk validation results | proves each safety gate ran |
| `EXECUTION` | hash of trade outcome or skip reason | proves what actually happened |

`DecisionLog.sol` enforces ordering — steps must arrive POLICY → EXECUTION in sequence. the contract rejects anything out of order and locks the session after finalization.

**verification:** the API re-hashes each step payload from the local JSON and compares to on-chain hashes via `getStep()`. tamper with the JSON and the hashes won't match. the dashboard exposes this as a one-click verify button.

**attestation:** any wallet can call `attest(sessionId)` to permanently record on-chain that they independently verified a session.

---

## the contract

`DecisionLog.sol` at `0x22679adc7475B922901137F22D120404c074044f` on `caleb-chain`

- `startSession(sessionId)` — opens a new audit session
- `commitStep(sessionId, stepKind, dataHash)` — records one step hash, enforces ordering
- `finalizeSession(sessionId)` — locks the session permanently
- `attest(sessionId)` — independent verification record
- `getStep / getSession / getAttestationCount` — read-only audit queries

---

## the agent

**runner** (`src/engine/runner.js`) — 2-second tick loop. reads live prices from Binance and the Initia oracle, runs the strategy, calls Venice AI (Llama 3.3-70B) to confirm or override the signal, then runs 6 risk gates before any execution. commits to chain selectively: only on trades, blocked gates, or 60s heartbeats. not every tick — that would spam the chain and make the audit log useless.

**strategies:**
- `momentum.js` — buy when price breaks out above rolling high, sell on reversal
- `mean-revert.js` — buy at oversold RSI, sell at overbought

**policy gates** (all must pass before any trade):
1. spend within `maxSpendUsd`
2. token is in whitelist
3. AI confidence >= threshold
4. cooldown elapsed since last trade
5. verdict is a valid value
6. token has a positive live price

---

## the dashboard

live at [app.caleb.sandpark.co](https://app.caleb.sandpark.co)

- connect your Initia wallet via InterwovenKit
- watch agent decisions stream in with verdict, confidence, and AI reasoning
- click any session to see the full 5-step audit timeline
- one-click verify: re-hashes all steps and compares to chain
- attest: sign a transaction to permanently record your verification on-chain
- configure your own strategy (per-wallet policy, applied on every tick)

---

## stack

| layer | tech |
|-------|------|
| chain | Initia minitia (minievm), settles to `initiation-2` |
| smart contract | Solidity (Hardhat), `DecisionLog.sol` |
| agent | Node.js (ESM), ethers.js |
| AI | Venice AI, Llama 3.3-70B |
| prices | Binance API + Initia oracle |
| API | plain Node.js HTTP |
| dashboard | Next.js, wagmi, InterwovenKit |

---

## running locally

requires Node.js 18+ and a `.env` file (see `.env.example`).

```bash
npm install

# run the agent
SIMULATE=true STRATEGY=momentum node src/engine/runner.js

# run the API server
SIMULATE=true node src/scripts/api-server.js
```

```env
INITIA_RPC_URL=http://64.227.139.172:8545
PRIVATE_KEY=<agent wallet private key>
DECISION_LOG_ADDRESS=0x22679adc7475B922901137F22D120404c074044f
SIMULATE=true
STRATEGY=momentum
```

---

## repo structure

```
contracts/
  DecisionLog.sol          — on-chain audit log

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
    index.js               — Binance + Initia oracle price fetching
    cache.js               — 500ms background price cache
  policy/
    index.js               — 6-gate risk validator
  venice/
    index.js               — Venice AI decision layer
  scripts/
    api-server.js          — HTTP API for the dashboard
    deploy.js              — contract deployment

sessions/                  — local session JSON files
data/
  portfolio.json           — persistent P&L state
  policies/                — per-wallet strategy configs
```

---

## design decisions

**why a custom minitia instead of initiation-2 directly?** the agent commits on every meaningful event. on a shared testnet that's noise. a dedicated chain keeps the audit log clean and gives full control over gas pricing and block times.

**why hash-only on chain instead of full payloads?** a full market snapshot is 2-5KB per step. hashes are 32 bytes. the full data lives in `sessions/` — the chain stores the fingerprints. the `StepCommitted` event does include the full payload as a string, so data can be recovered from chain events even if the local files are lost.

**why selective commits (not every tick)?** a 2s loop produces 43,000+ ticks/day. most are SKIP. committing every tick would spam the chain and make the audit log unreadable.

**SIMULATE=true** — swap execution is mocked. the agent makes real decisions based on real prices but doesn't call a DEX. everything else (policy, chain commits, portfolio tracking, AI decisions) runs for real.
