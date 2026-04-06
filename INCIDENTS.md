# incidents & fixes

running log of production issues on the VPS. add new entries at the top.

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
