# Initia Developer Experience Report
**Date:** 2026-03-28
**Context:** INITIATE Season 1 Hackathon — EVM appchain track
**Goal:** Launch a local EVM rollup (`caleb-1`) settling to `initiation-2`, deploy a Solidity contract, run an ethers.js agent against it
**Environment:** macOS Darwin 24.6.0, Apple Silicon (arm64)

---

## Summary

We spent the majority of our session fighting infrastructure rather than building. The agent, smart contract, and business logic were straightforward. The rollup launch process hit ~8 distinct blockers across tooling, documentation, binary distribution, and a critical undocumented protocol behavior. Every single one required digging through source code, GitHub issues, or trial and error to resolve. None had a clear error message or documentation page pointing to the fix.

This report is written to help your team tighten the developer experience for future hackathon participants.

---

## Bug #1 — `install-tools.sh` downloads nonexistent binary version

**Severity:** High — complete blocker for getting started
**Component:** `install-tools.sh`, initiad binary distribution

The install script targeted `initiad v1.3.0`, but that version does not exist on the GitHub releases page. The script silently failed after a 404 curl download.

Additionally, the script constructed the asset filename using arch suffix `arm64`, but the actual GitHub release asset uses `aarch64` on Apple Silicon. The correct asset was:

```
initia_v1.4.0_Darwin_aarch64.tar.gz
```

The script would have tried to download:
```
initia_v1.3.0_Darwin_arm64.tar.gz  ← both version and suffix wrong
```

**Fix applied manually:** Queried GitHub releases API, identified correct version and filename, downloaded directly.

**Recommendation:** Pin to an actually-released version, add a GitHub API check to verify the asset exists before attempting download, and use `uname -m` output directly rather than remapping `arm64` → `arm64` (which was wrong anyway).

---

## Bug #2 — `initiad` binary on macOS has hardcoded build machine rpath for `libmovevm.dylib`

**Severity:** High — binary is completely unusable out of the box on macOS
**Component:** initiad binary distribution (macOS)

After downloading and extracting `initiad`, running any command immediately failed:

```
dyld[...]: Library not loaded: /root/go/pkg/mod/github.com/...
```

The binary was built on a Linux machine and has an absolute rpath pointing to the Go module cache on that build machine's filesystem. On any other machine the dylib is not found.

**Fix applied manually:**
```bash
install_name_tool -add_rpath "$HOME/.local/bin" ~/.local/bin/initiad-bin
```

Plus a wrapper script to ensure `DYLD_LIBRARY_PATH` is set at runtime:
```bash
#!/usr/bin/env bash
DYLD_LIBRARY_PATH="$HOME/.local/bin${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" exec "$(dirname "$0")/initiad-bin" "$@"
```

**Recommendation:** Either fix the rpath at build time for Darwin releases (`-rpath @executable_path`), or ship a `postinstall` script that patches the rpath. This is a known macOS distribution pattern — standard for any binary that bundles a dylib.

---

## Bug #3 — `weave rollup launch --force` leaves stale genesis state

**Severity:** High — causes cryptic failures on re-launch
**Component:** Weave CLI, `--force` flag behavior

When re-launching with `--force`, Weave correctly wipes `~/.minitia/artifacts` but does **not** remove `~/.minitia/config/genesis.json`. The stale genesis from the previous run causes the new chain to fail to start, with no clear error message indicating the genesis file was the problem.

**Fix applied manually:**
```bash
rm -rf ~/.minitia
```

**Recommendation:** `--force` should fully wipe `~/.minitia` (or at minimum `~/.minitia/config/genesis.json`). The intent of `--force` is clearly "start fresh" — partial cleanup defeats the purpose and causes hard-to-debug failures.

---

## Bug #4 — GitHub API rate limit during rollup launch breaks the process mid-flight

**Severity:** Medium — blocks launch with no actionable error
**Component:** Weave CLI, binary download during launch

During `weave rollup launch`, Weave fetches binaries from GitHub at runtime. On a machine that has been doing active development (many API calls), GitHub's unauthenticated rate limit (60 req/hour) is exhausted, and the download silently returns a rate limit JSON error instead of a binary. The launch process then fails with a confusing error.

**Fix applied manually:** Set `GITHUB_TOKEN` environment variable before running Weave.

**Recommendation:**
1. Detect rate limit responses (HTTP 403 + `X-RateLimit-Remaining: 0`) and print a clear message: "GitHub API rate limited. Set GITHUB_TOKEN=... to continue."
2. Weave should natively support `GITHUB_TOKEN` passthrough for all GitHub API calls, and document this in the CLI help output.

---

## Bug #5 — `rapid-relayer` Docker image requires authentication to pull

**Severity:** Medium — blocks IBC step with no clear instructions
**Component:** Weave CLI, IBC relayer setup (Step 5)

The IBC relayer image `ghcr.io/initia-labs/rapid-relayer:v1.0.8` is hosted on GitHub Container Registry and requires authentication even for pull. During launch, Docker fails to pull it and the error is a generic Docker permission error — nothing in the Weave output explains that you need to `docker login ghcr.io` first.

**Fix applied manually:**
```bash
docker login ghcr.io  # authenticate with GitHub PAT
docker pull ghcr.io/initia-labs/rapid-relayer:v1.0.8
```

**Recommendation:** Either make the image public, or add a pre-flight check in `weave rollup launch` that verifies Docker can pull the relayer image and prints actionable instructions if it cannot. The current UX sends users into a Docker error with no path forward.

---

## Bug #6 — Genesis account funding with `"1GAS"` = 1 wei, not 1 token

**Severity:** High — critical footgun, completely undocumented
**Component:** Genesis config documentation, `launch_config.json` defaults

The `generate-system-keys` script populates `genesis_accounts` with `"1GAS"` per address as the default for EVM track. This looks like "1 GAS token" but is actually 1 base unit — equivalent to 1 wei (10⁻¹⁸ of a full token). Every system key and the agent wallet was funded with an amount so small it cannot pay for a single transaction.

There is no documentation anywhere that explains the denomination relationship. The agent deployed and ran but immediately failed with:

```
fee payer address: insufficient funds
```

**Fix applied manually:** Updated genesis to `"1000000000000000000GAS"` (1 full token) for system keys and `"10000000000000000000000GAS"` (10,000 tokens) for the agent.

**Recommendation:**
1. The default in the key generation script should be something useful like `"10000000000000000000GAS"` (10 tokens) — enough to actually do things.
2. The docs and `SKILL.md` / `launch_config.json` comments should clearly state: **"GAS is denominated in wei (10⁻¹⁸). To fund an account with N tokens, use N×10¹⁸GAS."**
3. Consider validating genesis account balances during launch and warning if any funded address has less than a transaction's worth of gas.

---

## Bug #7 — Cosmos address ≠ Ethereum address for the same private key (completely undocumented)

**Severity:** Critical — invisible footgun that breaks EVM agents
**Component:** minievm documentation, address derivation

This was the hardest bug to find and the most impactful.

In Initia minievm, the same private key produces **two completely different addresses**:

| Derivation | Method | Result (example) |
|---|---|---|
| Cosmos | `bech32(RIPEMD160(SHA256(compressed_pubkey)))` | `init1wu4p7rp78ptx...` |
| Ethereum / ethers.js | `keccak256(uncompressed_pubkey)[12:]` | `0x772a1f0c3e385664...` |

When the agent uses `ethers.js` to sign and submit transactions, it uses the Ethereum-derived address (`0x772a...`) as the fee payer. But genesis funding was applied to the Cosmos-derived address (`init1wu4...`). These are **different addresses with different balances**. The Ethereum address had zero funds.

The error was:
```
fee payer address: init1...does not exist: unknown address
```

There is nothing in the Weave documentation, the minievm documentation, or any error message that explains this. We discovered it by inspecting ethers.js internals and the Cosmos BIP44 derivation spec side by side.

**Fix applied manually:**
1. Derived the agent's keccak256 bech32 address from its private key
2. Added that address directly to `genesis_accounts` in `launch_config.json`
3. Re-launched the chain

**Recommendation:**
1. **This needs prominent documentation.** Any developer using ethers.js, viem, or any standard EVM library against minievm will hit this. The FAQ / "getting started with EVM" guide must explain that you need to fund the **Ethereum-derived** address, not the Cosmos-derived one.
2. The Weave `generate-system-keys` tool should either output both addresses per key, or output the Ethereum address when `--vm evm` is specified.
3. Ideally, provide a small utility: `weave address from-key <private-key> --evm` that outputs the correct address for funding.

---

## Bug #8 — Bridge executor requires L1 funding but this is not surfaced before launch starts

**Severity:** Medium — causes mid-launch failure after significant wait time
**Component:** Weave CLI, launch pre-flight checks

The bridge executor key (`init1uah5azj2s9w38g8gfmh0vzrvxfc74482p530er`) requires funded INIT on L1 (`initiation-2`) to operate. Weave does not check this before starting the launch sequence. Instead, it gets through ~4 steps of multi-minute operations and then stalls at Step 5 (IBC) with no clear message about what's wrong or which address needs funding.

**Fix applied manually:** Used the Initia faucet to fund the bridge executor address, then re-ran launch.

**Recommendation:** Add a pre-flight check at the start of `weave rollup launch` that:
1. Queries L1 balances for all system keys that require L1 funds
2. Lists any that are unfunded with their addresses and the faucet URL
3. Asks the user to confirm before proceeding

This saves 10–15 minutes of waiting for steps 1–4 to complete before hitting the avoidable failure.

---

## Overall DX Observations

**What works well:**
- The concept of Weave as a one-command rollup launcher is excellent
- The `launch_config.json` structure is clean and readable
- The rollup, once running, was stable and EVM JSON-RPC was fully compatible with standard ethers.js

**What needs the most attention:**
1. The Cosmos/Ethereum address duality is a critical, invisible footgun for every EVM developer. It needs a dedicated documentation page and tooling support.
2. Genesis denomination (wei vs token) needs a clear callout wherever genesis accounts are configured.
3. The macOS binary distribution for initiad needs to be fixed at the build level — the rpath issue is a standard macOS packaging problem with a standard solution.
4. The `--force` flag should mean "clean slate" and actually deliver that.

Happy to provide more detail on any of these. The project is `caleb-1` — a verifiable AI DCA agent with on-chain decision logging, built for INITIATE S1.
