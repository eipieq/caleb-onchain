# caleb — build log

## what we're making
AI agent that buys tokens on Initia on your behalf.
Every decision it makes gets saved to the blockchain so you can prove it followed the rules.

---

## done
- [x] `DecisionLog.sol` — smart contract that stores decision hashes on-chain
- [x] deploy script — pushes contract to Initia testnet
- [x] chain client — JS wrapper to talk to the contract
- [x] market data — fetches live token prices (Initia oracle + CoinGecko fallback)
- [x] Venice AI — sends market data to LLM, gets back BUY/SKIP + reasoning
- [x] policy engine — 6 rules the agent must pass before any swap runs
- [x] swap execution — runs the actual trade on Initia DEX (or simulates it)
- [x] agent cycle — ties all 5 steps together, saves session to disk
- [x] verify script — re-hashes session file, checks each hash against chain
- [x] frontend — React dashboard: session list, step timeline, verify button, policy editor
- [x] API server — bridge between frontend and sessions/chain

---

## next
- [ ] fill in real Initia DEX contract addresses in `swap.js`
- [ ] test full cycle on testnet with `SIMULATE=true`
- [ ] deploy contract + run live agent cycle end to end
- [ ] confirm verify catches a tampered session (demo proof)
- [ ] hook up frontend to live API server
- [ ] polish demo script (90-sec walkthrough for judges)


> caleb-onchain@0.1.0 deploy
> node src/scripts/deploy.js --network initia_testnet

Deploying DecisionLog to hardhat ...
DecisionLog deployed to: 0x5FbDB2315678afecb367f032d93F642f64180aa3

Add this to your .env:
DECISION_LOG_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3