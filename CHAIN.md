# caleb-chain

caleb-chain is a minievm rollup built on Initia. it settles to `initiation-2` (Initia testnet) and exists for one reason: to give the caleb trading agent a dedicated chain for its audit trail, without spamming the shared testnet.

the chain runs `minitiad` on a DigitalOcean VPS in Bangalore. it's been running continuously since the hackathon started.

---

## why a dedicated chain

the agent commits a session every time something meaningful happens — a trade, a blocked gate, or a 60s heartbeat. that's potentially hundreds of transactions per day. on a shared testnet that's noise. on a dedicated chain it's the whole point.

it also means full control over gas pricing and block times, which matters for a 2s tick loop.

---

## public endpoints

| service | url |
|---|---|
| EVM JSON-RPC | `http://64.227.139.172:8545` |
| Tendermint RPC | `http://64.227.139.172:26657` |
| Cosmos REST | `http://64.227.139.172:1317` |
| agent API | `http://64.227.139.172:4000` |

you can connect MetaMask or any ethers.js/viem client to the EVM RPC directly.

---

## chain details

| | |
|---|---|
| chain ID | `caleb-chain` |
| EVM chain ID | `1043515499963059` |
| settles to | `initiation-2` |
| bridge ID | `1726` |
| `DecisionLog.sol` | `0x22679adc7475B922901137F22D120404c074044f` |
| agent wallet | `0x772a1f0c3e3856645FF9019Af5B077B08AA1AFa3` |

---

## the contract

`DecisionLog.sol` is the trust anchor. it stores keccak256 hashes of every agent decision in an immutable, ordered log.

```solidity
startSession(sessionId)
commitStep(sessionId, stepKind, dataHash)   // enforces POLICY → MARKET → DECISION → CHECK → EXECUTION order
finalizeSession(sessionId)                  // locks it — no modifications after this
attest(sessionId)                           // any address can record independent verification
```

steps must arrive in order. the contract rejects anything out of sequence. once finalized, the session is frozen.

the `StepCommitted` event includes the full payload as a string — so even if the off-chain JSON files are lost, the data can be recovered from chain events. the api-server does this automatically on startup via `autoRecover()`.

---

## verify a session

```bash
# re-hashes all step payloads locally and compares to on-chain
curl http://64.227.139.172:4000/api/verify/<sessionId>

# query a tx directly via Tendermint RPC
curl http://64.227.139.172:26657/tx?hash=<txHash>

# list recent sessions
curl http://64.227.139.172:4000/api/sessions
```

---

## connect your wallet

add caleb-chain to MetaMask manually:

- network name: `caleb-chain`
- RPC URL: `http://64.227.139.172:8545`
- chain ID: `1043515499963059`
- currency: `INIT`

or use the dashboard at [app.caleb.sandpark.co](https://app.caleb.sandpark.co) — InterwovenKit handles it automatically.
