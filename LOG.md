# caleb — build log

## what we're making

Verifiable trading strategy platform on Initia. Users subscribe to on-chain strategies (momentum, mean-revert). Every decision the agent makes — buy, sell, skip, blocked — is cryptographically committed to the chain. The full P&L record is tamper-proof and auditable by anyone.

---

## session 1 — foundation

**built:** smart contract + one-shot DCA agent

- `DecisionLog.sol` — stores keccak256 hashes of each decision step on-chain
- deploy script — pushes contract to a custom caleb-chain (EVM minitia on VPS)
- chain client — JS wrapper around ethers to talk to the contract
- market data — Initia oracle + CoinGecko fallback for live prices
- Venice AI — sends market context to LLM, gets BUY/SKIP + reasoning back
- policy engine — 6 gates the agent must pass before any trade runs
- swap execution — simulated trade against Initia DEX
- agent cycle — 5-step session: POLICY → MARKET → DECISION → CHECK → EXECUTION
- verify script — re-hashes local session file, compares each hash against chain
- frontend (Vite/React) — session list, step timeline, verify button, policy editor
- API server — bridges frontend to session files and contract

**deployed:** `DecisionLog` at `0x22679aDC7475b922901137f22D120404c074044f` on caleb-chain (VPS `64.227.139.172`)

---

## session 2 — pivot to HFT + investment platform

**pivot:** hourly one-shot agent → tight 2s tick loop with selective chain logging

### strategy engine

- `src/strategies/momentum.js` — N-period breakout. BUY when price clears the rolling high by a threshold %, SELL when it breaks the low. Confidence = normalised distance beyond breakout.
- `src/strategies/mean-revert.js` — rolling z-score. BUY when oversold (z < -threshold), SELL when overbought (z > threshold).
- `src/strategies/index.js` — registry, `loadStrategy(name)` throws on unknown strategy.

### price cache

- `src/market/cache.js` — `PriceCache` refreshes independently of the decision loop (default 500ms) so the runner reads synchronously from memory.
- `src/market/mock.js` — geometric Brownian motion price walk seeded at realistic values (INIT $2.40, ETH $3200). Used when `SIMULATE=true`.

### HFT runner

- `src/engine/runner.js` — main tick loop. Selective logging rule:

  | event | committed to chain? |
  |-------|-------------------|
  | SKIP (no signal) | no |
  | trade executed | yes — full 5-step session |
  | signal blocked by gates | yes — risk audit trail |
  | every 60 seconds | yes — heartbeat / liveness proof |

- history is pushed AFTER `decide()` so strategies compare current price against past prices, not themselves (critical ordering fix)
- `lastHeartbeat` updated BEFORE the async commit to prevent double-heartbeat on slow blocks

### portfolio manager

- `src/engine/portfolio.js` — persistent `data/portfolio.json`. Tracks USDC balance, holdings (weighted avg entry), realised/unrealised P&L, full trade history.
- every trade record links to its `sessionId` — the on-chain proof of the decision that caused it
- `portfolioAfter` snapshot embedded in each EXECUTION step payload — portfolio state at every trade is committed to chain verbatim
- `backfillSessionId()` — replaces `"pending"` entries with the real sessionId after the chain commit resolves

### policy gates added

- `gate_signalStrength` — replaces `confidenceThreshold`, works for both BUY and SELL signals
- `gate_maxPosition` — caps total position size
- `gate_maxDrawdown` — halts trading if portfolio drops below drawdown limit
- `gate_availableBalance` — checks USDC balance, not just a static `maxSpendUsd`

### frontend (Next.js — `caleb-app/`)

- `components/stats-bar.tsx` — trades/volume/fees in last 24h
- `components/portfolio-card.tsx` — total value, P&L (realised + unrealised), open positions with per-position %, trade history (last 10) with "proof" links to sessions
- `components/session-card.tsx` — SELL badge, strategy name, signal label, trade amount
- `components/agent-status.tsx` — pulsing green dot if last session < 15s, auto-refresh every 5s
- `components/strategy-form.tsx` — strategy picker (momentum / mean-revert), min signal strength, max position, max drawdown fields
- page title: "Trade Feed" — revalidates every 5s

### API server additions

- `GET /api/portfolio` — reads `portfolio.json`, marks-to-market with live (or simulated) prices, returns full investment state

### infra

- caleb-chain running on VPS, chain height advancing continuously
- API server + HFT runner both running via `nohup` on VPS
- code sync via `rsync` (VPS was not a git repo initially)

---

## bugs fixed

| bug | fix |
|-----|-----|
| price cache always empty (`warming up 0/N`) | Initia oracle + CoinGecko both returned `{}`. Added GBM mock price feed for `SIMULATE=true` |
| breakout never fires | current price was pushed to history BEFORE `decide()` — `max(history)` always included current price, making `price > max` impossible. Push after. |
| double heartbeat on startup | `lastHeartbeat=0` made first tick fire immediately. Set `lastHeartbeat=now` before the async commit. |
| nonce sequence mismatch | transient EVM nonce issue against remote RPC, retries succeed. Acceptable in local→VPS dev. |
| `sessionId: "pending"` in trade history | added `backfillSessionId()` to portfolio, runner calls it after commit resolves |
| portfolio mark-to-market showing entry price | api-server was calling live oracle (fails in simulate mode). Now uses `getSimulatedPrices()` when `SIMULATE=true` |
| VPS not a git repo | code was uploaded manually. Switched to `rsync src/ package.json` for deploys |
| port 4000 already in use on restart | `kill $(lsof -ti:4000)` before restarting |

---

## what's next

- [ ] real prices — wire live Initia oracle even in simulate mode (prices are fake GBM right now)
- [ ] deploy caleb-app frontend to Vercel
- [ ] `submission.json` for hackathon eligibility
- [ ] demo script — 90-second walkthrough for judges
- [ ] mean-revert strategy live testing
- [ ] clean up `sessionId: "pending"` in existing portfolio history (backfill retroactively from session files)
