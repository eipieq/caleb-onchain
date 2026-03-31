# Caleb Dev Log

## 2026-03-28 — Environment Setup & Rollup Launch

### What we did
- Set up EVM track environment: installed Weave, initiad v1.4.0, Foundry
- Generated system keys (validator, bridge_executor, output_submitter, batch_submitter, challenger)
- Launched a local EVM L2 rollup (`caleb-1`) settling to Initia testnet (`initiation-2`)
- Deployed `DecisionLog.sol` — the on-chain audit log for the agent's 5-step DCA cycle
- Wired the deployed contract address into the agent via `.env`

### Why it took a long time

All of the below compounded:

**1. The task itself is genuinely complex.**
Launching your own L2 from scratch involves: generating validator keys, submitting L1 registration transactions, setting up IBC channels, running a relayer, configuring a bridge. That's real infrastructure work.

**2. Initia's tooling is immature.**
Weave is supposed to abstract all of this into one command, but we hit:
- Docker auth issues with their private registry (ghcr.io/initia-labs/rapid-relayer)
- GitHub API rate limit during binary download
- `--force` flag that didn't fully clean up state (had to `rm -rf ~/.minitia` manually)
- Binary download URLs that didn't match the install script's assumptions (v1.3.0 didn't exist, arch suffix was `aarch64` not `arm64`)

**3. Several non-obvious bugs compounded.**
- `initiad` on macOS had a hardcoded build machine rpath for `libmovevm.dylib` — needed `install_name_tool` + a wrapper script to fix
- Genesis funding: `"1GAS"` = 1 base unit = 1 wei, not 1 ETH. All system keys were funded with dust. Fixed by updating genesis to `"1000000000000000000GAS"` per key
- Cosmos vs Ethereum address derivation: same private key → two completely different addresses. Cosmos uses `RIPEMD160(SHA256(pubkey))`, Ethereum uses `keccak256(uncompressed_pubkey)[12:]`. The agent (ethers.js) derived its keccak256 address, but genesis only funded the Cosmos-derived address → "fee payer address does not exist" error. Fixed by adding the agent's keccak256 bech32 address to genesis

**4. We were doing it right.**
The easy alternative was deploying to a public testnet — no chain setup, no relayer, no genesis config. But running your own rollup is the whole point: it shows you understand the stack, not just that you can call a public API.

**Short version:** new ecosystem + real infra complexity + a few unlucky bugs. The agent code was ~20% of the session; the other 80% was infrastructure. That ratio is normal for blockchain work.

---

### Completed
- [x] Re-launched chain with correct genesis funding
- [x] Re-deployed `DecisionLog.sol` → `0xE58fbB625cF096d2747198Da8c0Fb8f40B30bE39`
- [x] Full 5-step agent cycle ran and committed on-chain
- [x] On-chain hashes verified — all match local session data ✓

### Next
- [ ] Fix market data feed — agent returned empty data, SKIPped with confidence 0
- [ ] Get a full BUY cycle running end-to-end
- [ ] React dashboard
