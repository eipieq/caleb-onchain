# Caleb — VPS Reference

**Provider:** DigitalOcean
**Region:** Bangalore (blr1)
**Droplet:** 2 vCPU / 4 GB RAM / Ubuntu 24.04
**IP:** 64.227.139.172
**SSH:** `ssh -i ~/.ssh/id_ed25519 root@64.227.139.172`

---

## Public Endpoints

| Service | URL | Purpose |
|---|---|---|
| EVM JSON-RPC | `http://64.227.139.172:8545` | MetaMask, ethers.js, cast |
| Tendermint RPC | `http://64.227.139.172:26657` | Chain status, tx broadcast |
| Cosmos REST API | `http://64.227.139.172:1317` | Balances, opchild params |
| gRPC | `http://64.227.139.172:9090` | Proto clients |
| Rollytics Indexer | `http://64.227.139.172:6767` | EVM tx history |
| Agent API | `http://64.227.139.172:4000` | Sessions, verify, policy |

### Useful indexer paths
```
GET /indexer/tx/v1/evm-txs?limit=20       — recent EVM transactions
GET /indexer/tx/v1/evm-txs/{tx_hash}      — single transaction
GET /indexer/block/v1/blocks              — recent blocks
GET /swagger/doc.json                     — full API schema
```

### Useful agent API paths
```
GET  /api/sessions            — all sessions (sorted newest first)
GET  /api/sessions/{id}       — single session
GET  /api/verify/{id}         — verify all 5 hashes on-chain
GET  /api/attestations/{id}   — on-chain attestations for a session
POST /api/recover/{id}        — recover session JSON from chain events (if file was lost)
GET  /api/policy              — current agent policy
POST /api/policy              — update agent policy (JSON body)
```

---

## Chain Details

| Field | Value |
|---|---|
| Chain ID | `caleb-chain` |
| EVM Chain ID | `1043515499963059` |
| L1 | `initiation-2` (Initia testnet) |
| Bridge ID | `1726` |
| Bridge address (L1) | `init1efcmmxnlp6jyqvm3zqzpmp70c0pg9fxjd4rqu8437dfgxga23yqq367sdj` |
| DecisionLog contract | `0x22679adc7475B922901137F22D120404c074044f` |
| Agent wallet (EVM) | `0x772a1f0c3e3856645FF9019Af5B077B08AA1AFa3` |
| Agent wallet (Cosmos) | `init1wu4p7rp78ptxghleqxd0tvrhkz92rtarhfejuy` |

---

## Installed Software

| Package | Version |
|---|---|
| Ubuntu | 24.04 LTS |
| Kernel | 6.8.0-106-generic |
| Docker | 28.2.2 |
| docker-compose-v2 | 2.37.1 |
| Node.js | 18.19.1 |
| npm | 9.2.0 |
| Weave CLI | v0.3.8 |
| minitiad (minievm) | v1.2.15 |
| Foundry (forge/cast) | 1.5.1-stable |

---

## Services

### caleb-chain (minitiad)
Launched via `weave rollup launch --with-config ~/.weave/launch_config.json --vm evm`

Process runs as a background daemon:
```bash
ps aux | grep minitiad
# /root/.weave/data/minievm@v1.2.15/minitiad start --home /root/.minitia
```

Chain data: `/root/.minitia/`
Config: `/root/.minitia/config/`
Logs: `journalctl -u minitiad` or check process output

**To restart chain after reboot:**
```bash
/root/.weave/data/minievm@v1.2.15/minitiad start --home /root/.minitia &
```

### Rollytics Indexer (Docker)
```bash
weave rollup indexer start    # start
weave rollup indexer stop     # stop
weave rollup indexer log      # logs (wrong command — use below)
docker logs rollytics-api     # API logs
docker logs rollytics-indexer # indexer logs
```

### Agent API (systemd)
```bash
systemctl status caleb-api
systemctl restart caleb-api
journalctl -u caleb-api -f
```
Service file: `/etc/systemd/system/caleb-api.service`
Runs: `node src/scripts/api-server.js` in `/root/caleb-onchain`
Port: 4000

### Agent Cron (hourly)
```bash
crontab -l
# 0 * * * * cd /root/caleb-onchain && node src/agent/index.js >> /root/caleb-agent.log 2>&1

tail -f /root/caleb-agent.log    # watch live
```

---

## Firewall (UFW)

| Port | Service |
|---|---|
| 22 | SSH |
| 8545 | EVM JSON-RPC |
| 26657 | Tendermint RPC |
| 1317 | Cosmos REST API |
| 9090 | gRPC |
| 6767 | Rollytics Indexer |
| 4000 | Agent API |

---

## Project on VPS

Location: `/root/caleb-onchain`
Synced from local via:
```bash
rsync -av -e "ssh -i ~/.ssh/id_ed25519" \
  --exclude='.git' --exclude='node_modules' \
  /Users/zap/Documents/caleb-onchain/ root@64.227.139.172:/root/caleb-onchain/
```

`.env` on VPS has public endpoints (not localhost). Local `.env` still points to localhost.

---

## Key System Keys (launch_config.json)

| Role | Cosmos Address |
|---|---|
| Validator | `init1hnrcv2krfw6gjfj9pm2gyfxt62gyd6huj0atsy` |
| Bridge Executor | `init1uah5azj2s9w38g8gfmh0vzrvxfc74482p530er` |
| Output Submitter | `init1d85hgs0mdslykm0lwvgj7sml4yvjfnpqhfy4hj` |
| Challenger | `init1rry9hyrz5f8mzdjxuyhkepv68xfxyfqtczlgsz` |

Config file: `/root/.weave/launch_config.json`
Mnemonics for all keys: stored in `launch_config.json` (keep private)

---

## What We Had to Fix During Setup

1. **lz4 not installed** — `apt install lz4` before running weave launch
2. **Weave has no `--non-interactive` flag** — use `--with-config` instead
3. **Foundry not in PATH** — added `export PATH="$PATH:/root/.foundry/bin"` to `.bashrc`
4. **Indexer API root returns `Cannot GET /`** — normal, root has no route; use `/indexer/tx/v1/evm-txs`
5. **docker-compose-plugin not found on Ubuntu 24.04** — install `docker-compose-v2` instead

---

## After Reboot Checklist

If the VPS reboots, run these:

```bash
# 1. Start the chain
/root/.weave/data/minievm@v1.2.15/minitiad start --home /root/.minitia &

# 2. Start the indexer
weave rollup indexer start

# 3. API server restarts automatically (systemd)
systemctl status caleb-api

# 4. Cron restarts automatically

# 5. Verify chain is producing blocks
curl http://localhost:26657/status | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['sync_info']['latest_block_height'])"
```

> Note: minitiad does not have a systemd service yet — it will not auto-start on reboot. Consider adding one if uptime matters before April 16.
