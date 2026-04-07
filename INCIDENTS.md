# incidents & fixes

running log of production issues on the VPS. add new entries at the top.

---

## 2026-04-07 — sessions lost to nonce mismatch (open / unresolved)

**symptoms:**
- trade appears in portfolio history with a `proof →` link
- clicking the link gives 404
- session not found on chain either

**what happened:**
the runner sends multiple transactions per session (startSession + 5 commitStep + finalizeSession = 7 txs). when two sessions overlap or the chain is under load, the nonce gets out of sync — the chain rejects the tx with `account sequence mismatch, expected N, got N-1`. the affected session never lands on chain, the local file is never saved, but the trade outcome is already written to `portfolio.json`. so the P&L is real but the audit trail is gone.

example: session `0x9983a08966ebfd...` (SELL ETH $20.97, -$0.10, Apr 7 11:31 UTC)

```
2026-04-07T11:31:52Z  COMMIT ERR  account sequence mismatch, expected 23354, got 23353
```

**why it matters:**
this is a core integrity issue. the whole point of caleb is that every decision has an on-chain proof. a trade that happened but has no verifiable session is exactly what we're trying to prevent. it's not data loss from a crash — it's a gap in the audit trail caused by a nonce race condition.

**options being considered:**

1. **re-fetch nonce before every tx** (easiest fix)
   instead of incrementing nonce locally, call `eth_getTransactionCount` before each tx. eliminates the race entirely. downside: one extra RPC call per tx, slight latency increase.

2. **save session file before chain commit** (defense in depth)
   write the session JSON to disk as soon as the decision is made, before any chain tx fires. if the commit fails, the data is still there — the session shows up in the dashboard without on-chain hashes. honest about what failed, nothing is hidden.

3. **retry failed txs with corrected nonce** (most robust)
   on a sequence mismatch error, re-fetch nonce and resubmit. keeps the audit trail intact without manual intervention. slightly more complex — need to avoid double-submitting.

4. **serialize all chain commits through a queue** (cleanest long-term)
   one tx at a time, no concurrency. eliminates nonce races entirely. adds latency but guarantees ordering.

**recommended approach:**
options 1 + 2 together. re-fetch nonce before every tx (fixes the cause) and save session file before committing (fixes the symptom). option 3 adds resilience on top if needed. option 4 is the right architecture for a production system but overkill for the hackathon window.

**fix applied:**
- `src/chain/client.js` — added `getNonce()` that calls `eth_getTransactionCount(..., "pending")` and passes the result as an explicit override to every `startSession`, `commitStep`, and `finalizeSession` call. eliminates the local nonce cache.
- `src/engine/runner.js` — moved sessionId generation out of `commitSession` into the tick loop. saves a preliminary session file (with all payloads, `committed: false`) before any chain tx fires. `commitSession` overwrites it with the full record (including txHashes) on success. if chain commit fails, the file still exists — session shows in the dashboard without on-chain hashes, honest about what happened.

**status:** resolved

---

## 2026-04-06 — api server down, hash mismatches on cron sessions

**symptoms:**
- dashboard showing no new sessions
- hash mismatch on sessions from around Apr 5

**what happened:**
a cron job (`0 * * * *`) was running `src/agent/index.js` every hour. that script runs one full agent cycle but doesn't exit cleanly when a chain call hangs — so each hourly spawn just sat there forever. after ~24 hours there were 50+ zombie node processes each using ~40MB, totaling 2GB+ on a 4GB machine. the OS killed processes to free memory and `api-server.js` was one of them. `runner.js` survived because it started earlier.

the hash mismatches were on sessions committed by `src/agent/index.js`, which adds extra fields (`sessionId`, `timestamp`) to the policy payload before hashing — slightly different from `runner.js`'s payload shape. the verify endpoint expects the runner format so those sessions always fail verification.

**fix:**
```bash
# killed all zombie processes
pkill -f "src/agent/index.js"

# restarted the api server
cd /root/caleb-onchain
SIMULATE=true nohup node src/scripts/api-server.js >> /var/log/caleb-api.log 2>&1 &

# removed the cron job permanently
crontab -r
```

**prevention:**
- cron job removed. `runner.js` handles the agent loop — `src/agent/index.js` is redundant on the VPS.
- if api server needs to be kept alive, use a proper process manager (pm2 or systemd) instead of nohup.

---

## how to diagnose api being down

```bash
# check what's running
ps aux | grep node

# check if api is responding
curl http://localhost:4000/api/sessions | head -c 100

# check runner logs
tail -50 /var/log/caleb-runner.log

# check api logs
tail -50 /var/log/caleb-api.log
```

## how to restart services

```bash
cd /root/caleb-onchain

# api server (if down)
SIMULATE=true nohup node src/scripts/api-server.js >> /var/log/caleb-api.log 2>&1 &

# runner (if down)
SIMULATE=true STRATEGY=momentum MOMENTUM_THRESHOLD=0.001 POLICY_ALLOWED_TOKENS=ETH,INIT,USDC nohup node src/engine/runner.js >> /var/log/caleb-runner.log 2>&1 &
```
