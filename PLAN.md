# Caleb — Build Plan

**Deadline:** April 16, 2026
**Chain:** caleb-chain (EVM rollup on Initia)
**Stack:** Solidity + Node.js agent + React (InterwovenKit) + DigitalOcean

---

## Status

| Area | Status |
|---|---|
| Local chain (caleb-1) | ✅ Running |
| DecisionLog.sol | ✅ Deployed |
| Agent (5-step cycle) | ✅ Working |
| On-chain verification | ✅ Passing |
| Indexer | ✅ Running |
| VPS / hosted chain | ✅ Live at 64.227.139.172 |
| InterwovenKit frontend | ❌ Not started |
| Autosign (native feature) | ❌ Not started |
| submission.json | ❌ Not started |
| README | ❌ Not started |
| Demo video | ❌ Not started |

---

## Phase 1 — VPS + Chain Migration
**Goal:** Get `caleb-chain` running on a public server with a stable IP

- [ ] Provision DigitalOcean droplet (2 vCPU, 2GB RAM, Ubuntu 24.04)
- [ ] Install dependencies on VPS: Docker, Weave, initiad, Foundry, Node.js
- [ ] Update `launch_config.json` — change `chain_id` from `caleb-1` to `caleb-chain`
- [ ] Launch `caleb-chain` on VPS via Weave
- [ ] Fund bridge executor from L1 faucet
- [ ] Deploy `DecisionLog.sol` to `caleb-chain`
- [ ] Update `.env` with VPS endpoints + new contract address
- [ ] Start indexer on VPS (`weave rollup indexer start`)
- [ ] Deploy agent on VPS (run on cron every hour)
- [ ] Verify agent cycle works end-to-end on VPS
- [ ] Note all public endpoints (RPC, REST, JSON-RPC, indexer)

---

## Phase 2 — InterwovenKit Frontend
**Goal:** React dashboard that satisfies the InterwovenKit eligibility requirement and looks good for the demo

**Tech:** React + Vite + `@initia/interwovenkit-react` + Tailwind
**Hosted on:** Vercel (free)

### Pages / Views

**Home — Live Agent Feed**
- List of sessions (most recent first)
- Each session shows: timestamp, verdict (BUY/SKIP), confidence, token
- Click to expand full 5-step breakdown with hashes

**Session Detail**
- All 5 steps: POLICY → MARKET → DECISION → CHECK → EXECUTION
- Each step: hash, tx link, timestamp
- AI reasoning text
- "Verify on-chain" button — checks hash against contract

**Strategy Setup**
- User configures their DCA strategy:
  - Max spend per cycle ($ input)
  - Confidence threshold slider (0.0 – 1.0)
  - Allowed tokens (INIT, ETH, USDC toggles)
  - Cooldown between cycles (hours)
  - Enable / pause agent toggle
- Settings saved on-chain (or signed locally and passed to agent)
- This is the onboarding flow — user sets strategy, then autosigns, then walks away

**Wallet Connect**
- InterwovenKit wallet connection
- Show connected wallet's session history

**Autosign (native feature)**
- User approves autosign once for `caleb-chain`
- Agent can then run cycles without interrupting the user
- This is the core product story: *set it and forget it DCA — configure once, agent runs autonomously*

### Implementation steps
- [ ] `npm create vite@latest caleb-dashboard -- --template react-ts`
- [ ] Install `@initia/interwovenkit-react`, Tailwind, React Router
- [ ] Set up `InterwovenKitProvider` with `caleb-chain` config
- [ ] Build session list component (reads from indexer API)
- [ ] Build session detail component
- [ ] Add wallet connect button
- [ ] Implement autosign flow
- [ ] Deploy to Vercel

---

## Phase 3 — Submission
**Goal:** Pass eligibility gate, score well on all 5 criteria

- [ ] Create `.initia/submission.json`
- [ ] Write `README.md` — clear enough for judges to verify in 5 minutes
- [ ] Record demo video (2-3 min): launch agent → transactions hit chain → dashboard shows session → verify hash
- [ ] Submit on DoraHacks before April 16

---

## Infrastructure

| Service | Provider | Cost |
|---|---|---|
| Chain + agent | DigitalOcean ($12/mo droplet) | ~$6 until April 16 |
| Frontend | Vercel | Free |
| AI (Venice) | Venice API | Pay-as-you-go |

---

## Public Endpoints

| Endpoint | URL |
|---|---|
| JSON-RPC | http://64.227.139.172:8545 |
| REST API | http://64.227.139.172:1317 |
| RPC | http://64.227.139.172:26657 |
| Indexer | http://64.227.139.172:6767 |
| Agent API | http://64.227.139.172:4000 |
| Frontend | TBD (Vercel) |
| Contract | 0xE58fbB625cF096d2747198Da8c0Fb8f40B30bE39 |

**EVM Chain ID:** 1043515499963059
**VPS:** 64.227.139.172 (DigitalOcean, blr1)

---

## Scoring Self-Assessment

| Criterion | Weight | Current | Target |
|---|---|---|---|
| Originality & Track Fit | 20% | Strong — verifiable AI agent is fresh | ✅ |
| Technical Execution & Initia Integration | 30% | Good chain + contract + agent, needs autosign | needs autosign |
| Product Value & UX | 20% | No frontend yet | needs dashboard |
| Working Demo & Completeness | 20% | Agent works, no public demo | needs hosted chain |
| Market Understanding | 10% | Not written up yet | needs README section |

---

## Phase 4 — HFT Strategy Platform (pivot)

> **Why:** Initia's 100ms blocks make HFT latency meaningful. A strategy marketplace with live fee visibility hits every judge criterion: technical depth, Initia moat, product value, and working demo.

### What we're building

Users subscribe to autonomous trading strategies. Each strategy runs a tight decision loop and every executed trade is cryptographically committed on-chain — so the performance record is tamper-proof.

The 5-step pipeline stays: **POLICY → MARKET → DECISION → CHECK → EXECUTION**. We run it faster and lighter.

---

### Decision loop

```
setInterval(tick, TICK_MS)        // default 2000ms, configurable per strategy

tick():
  prices  = priceCache.get()      // in-memory, refreshed every 500ms independently
  signal  = strategy.decide(prices, history, position, policy)
  check   = runPolicyCheck(signal, policy)
  if (shouldLog(signal, check)) commitSteps()
  if (check.passed && signal.verdict !== "SKIP") executeSwap()
```

---

### Strategy interface

Every strategy exports a single `decide` function:

```js
// returns { verdict: "BUY"|"SELL"|"SKIP", token, side, amountUsd, signal, reason }
export function decide(prices, history, position, policy) { ... }
```

Strategies to build:
- **momentum** — buy when price breaks above N-bar high, sell when it breaks below
- **mean-revert** — fade moves back to rolling average (VWAP-style)

---

### Logging rule (no chain spam)

At 2s ticks that's ~43k commits/day if we log everything. Instead:

| Event | Log to chain? |
|---|---|
| Trade executed | Yes — full 5-step session |
| Gate blocked execution | Yes — risk audit trail |
| SKIP (no signal) | No |
| Heartbeat | Yes — every 60s to prove liveness |

---

### Policy gate changes

| Gate | Change | Notes |
|---|---|---|
| `spendLimit` | Keep | per-trade USD cap |
| `tokenWhitelist` | Keep | allowed symbols |
| `marketSanity` | Keep | price > 0 required |
| `confidenceThreshold` | Drop | LLM concept, N/A for rule-based |
| `cooldown` | Drop | LLM concept, N/A for rule-based |
| `maxPositionUsd` | Add | don't over-expose to one token |
| `minSignalStrength` | Add | strategy-specific threshold |
| `maxDrawdown` | Add | halt if position down > X% |

---

### New files

```
src/engine/runner.js          tight loop (replaces one-shot for HFT mode)
src/engine/position.js        track open positions per strategy
src/strategies/index.js       registry — load strategy by name from env
src/strategies/momentum.js    breakout strategy
src/strategies/mean-revert.js mean-reversion strategy
src/market/cache.js           in-memory price cache with independent refresh
```

Files that don't change: `chain/client.js`, `market/swap.js`, `verify/index.js`.

---

### Frontend priorities

1. **Fee counter** — "fees earned today: $X" running total. The money shot for judges.
2. **Live trade feed** — WebSocket push from runner, trades appear in near-real-time.
3. **Strategy cards** — P&L%, trade count, win rate, max drawdown.
4. **Portfolio view** — aggregate across subscribed strategies.

---

### Build order

- [ ] `src/strategies/momentum.js`
- [ ] `src/strategies/mean-revert.js`
- [ ] `src/strategies/index.js`
- [ ] `src/market/cache.js`
- [ ] `src/engine/runner.js`
- [ ] `src/engine/position.js`
- [ ] Update `src/policy/index.js` — swap gates
- [ ] Frontend: `fee-counter.tsx`, `live-feed.tsx`
- [ ] Frontend: extend strategy cards with perf stats
- [ ] Frontend: portfolio page
