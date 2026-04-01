/**
 * @file engine/runner.js
 * HFT strategy runner — the tight decision loop.
 *
 * Replaces the one-shot agent/index.js for high-frequency strategies.
 * Runs a configurable tick loop, applies a rule-based strategy on each tick,
 * and commits to the chain only when something noteworthy happens.
 *
 * Selective logging rule (to avoid chain spam):
 *   - Trade executed         → full 5-step session committed
 *   - Gate blocked a trade   → full 5-step session committed (risk audit trail)
 *   - Every HEARTBEAT_S secs → lightweight session committed (liveness proof)
 *   - SKIP tick (no signal)  → nothing committed
 *
 * Usage:
 *   STRATEGY=momentum node src/engine/runner.js
 *   STRATEGY=mean-revert TICK_MS=1000 node src/engine/runner.js
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

import { ChainClient, STEP_KIND } from "../chain/client.js";
import { PriceCache }             from "../market/cache.js";
import { executeSwap }            from "../market/swap.js";
import { runPolicyCheck }         from "../policy/index.js";
import { loadStrategy }           from "../strategies/index.js";
import { PositionTracker }        from "./position.js";
import { PortfolioManager }       from "./portfolio.js";
import { DEFAULT_POLICY }         from "../agent/policy.js";

const __dirname    = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, "../../sessions");

// ─── Config ──────────────────────────────────────────────────────────────────

const STRATEGY_NAME  = process.env.STRATEGY    || "momentum";
const TICK_MS        = parseInt(process.env.TICK_MS        || "2000");
const HISTORY_SIZE   = parseInt(process.env.HISTORY_SIZE   || "50");
const HEARTBEAT_S    = parseInt(process.env.HEARTBEAT_S    || "60");
const MIN_HISTORY    = parseInt(process.env.MIN_HISTORY    || "5");  // ticks before first signal

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(label, msg, color = chalk.white) {
  console.log(`${chalk.gray(new Date().toISOString())}  ${color(label.padEnd(12))}  ${msg}`);
}

function saveSession(sessionId, record) {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
  const path = join(SESSIONS_DIR, `${sessionId}.json`);
  writeFileSync(path, JSON.stringify(record, null, 2));
}

// ─── On-chain session commit ──────────────────────────────────────────────────

/**
 * Commit a full 5-step session to the chain and save it locally.
 * Called only on executions, gate-blocks, and heartbeats.
 */
async function commitSession(chain, policy, market, signal, check, exec) {
  const now       = Math.floor(Date.now() / 1000);
  const sessionId = ChainClient.makeSessionId(chain.address, now);
  const record    = { sessionId, agent: chain.address, startedAt: now, strategy: STRATEGY_NAME, steps: [] };

  try {
    await chain.startSession(sessionId);

    const step0 = await chain.commitStep(sessionId, STEP_KIND.POLICY, { ...policy, sessionId, timestamp: now });
    record.steps.push({ kind: "POLICY", payload: { ...policy, sessionId, timestamp: now }, ...step0 });

    const step1 = await chain.commitStep(sessionId, STEP_KIND.MARKET, market);
    record.steps.push({ kind: "MARKET", payload: market, ...step1 });

    const step2 = await chain.commitStep(sessionId, STEP_KIND.DECISION, signal);
    record.steps.push({ kind: "DECISION", payload: signal, ...step2 });

    const step3 = await chain.commitStep(sessionId, STEP_KIND.CHECK, check);
    record.steps.push({ kind: "CHECK", payload: check, ...step3 });

    const step4 = await chain.commitStep(sessionId, STEP_KIND.EXECUTION, exec);
    record.steps.push({ kind: "EXECUTION", payload: exec, ...step4 });

    const finalizeTx = await chain.finalizeSession(sessionId);
    record.finalized   = true;
    record.finalizedAt = Math.floor(Date.now() / 1000);
    record.finalizeTx  = finalizeTx.txHash;

    saveSession(sessionId, record);
    log("COMMITTED", `session ${sessionId.slice(0, 18)}… — ${finalizeTx.txHash.slice(0, 18)}…`, chalk.green);
  } catch (err) {
    log("COMMIT ERR", err.message, chalk.red);
  }

  return record;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const policy    = { ...DEFAULT_POLICY, cooldownSeconds: 0 }; // HFT: no cooldown
  const strategy  = loadStrategy(STRATEGY_NAME);
  const position  = new PositionTracker();
  const portfolio = new PortfolioManager().load();

  const chain = new ChainClient({
    rpcUrl:          process.env.INITIA_RPC_URL,
    privateKey:      process.env.PRIVATE_KEY,
    contractAddress: process.env.DECISION_LOG_ADDRESS,
  });

  const cache = new PriceCache(policy.allowedTokens).start();

  /** Rolling price history for the primary token (newest last). */
  const history = [];

  let tickCount      = 0;
  let lastHeartbeat  = 0;
  let tradesExecuted = 0;
  let gatesBlocked   = 0;

  const snap = portfolio.get();
  log("RUNNER", `starting — strategy=${STRATEGY_NAME}  tick=${TICK_MS}ms  balance=$${snap.usdcBalance.toFixed(2)}`, chalk.cyan);

  async function tick() {
    tickCount++;
    const now    = Math.floor(Date.now() / 1000);
    const market = cache.get();

    if (!market) {
      log("TICK", "waiting for first price fetch…", chalk.gray);
      return;
    }

    // maintain rolling price history for primary token
    // history is passed to decide() BEFORE pushing the current price so that
    // strategies compare current price against *past* prices, not themselves
    const token = policy.allowedTokens.find((t) => t !== "USDC") ?? "INIT";
    const price = market.prices[token];

    if (history.length < MIN_HISTORY) {
      if (price > 0) { history.push(price); if (history.length > HISTORY_SIZE) history.shift(); }
      log("TICK", `warming up (${history.length}/${MIN_HISTORY} ticks)`, chalk.gray);
      return;
    }

    // ── strategy decision (uses history of past prices, not current) ──
    const signal = strategy.decide(market.prices, history, position.get(), policy);

    // push current price after decision so next tick's history is up-to-date
    if (price > 0) { history.push(price); if (history.length > HISTORY_SIZE) history.shift(); }

    // ── policy check ──
    const check  = await runPolicyCheck(signal, market, policy, [], position.get(), portfolio);

    // ── determine if this tick should be committed ──
    const isHeartbeat = (now - lastHeartbeat) >= HEARTBEAT_S;
    const isExecution = signal.verdict !== "SKIP" && check.passed;
    const isBlocked   = signal.verdict !== "SKIP" && !check.passed;
    const shouldCommit = isExecution || isBlocked || isHeartbeat;

    // ── execute swap if gates passed ──
    let exec = {
      executed:  false,
      reason:    signal.verdict === "SKIP" ? "strategy returned SKIP" : null,
      verdict:   signal.verdict,
      timestamp: now,
    };

    if (isExecution) {
      exec = await executeSwap(signal, check, market, policy);

      if (exec.executed) {
        tradesExecuted++;
        let portfolioAfter;

        if (signal.verdict === "BUY") {
          position.open(signal.token, signal.amountUsd, price);
          portfolioAfter = portfolio.applyBuy(signal.token, signal.amountUsd, price, "pending");
        } else if (signal.verdict === "SELL") {
          portfolioAfter = portfolio.applySell(signal.token, signal.amountUsd, price, "pending");
          position.close();
        }

        // embed portfolio snapshot into the execution record so it's committed on-chain
        exec.portfolioAfter = portfolioAfter;

        const pnl = portfolio.get(market.prices);
        log("EXECUTE", chalk.green(`${signal.verdict} ${signal.token} $${signal.amountUsd.toFixed(2)} @ $${price.toFixed(4)}`));
        log("PORTFOLIO", `value=$${pnl.totalValueUsd.toFixed(2)}  P&L=${pnl.totalPnlUsd >= 0 ? "+" : ""}$${pnl.totalPnlUsd.toFixed(2)} (${pnl.totalPnlPct >= 0 ? "+" : ""}${pnl.totalPnlPct}%)`, pnl.totalPnlUsd >= 0 ? chalk.green : chalk.red);
      }
    }

    if (isBlocked) {
      gatesBlocked++;
      log("BLOCKED", `${signal.verdict} blocked by ${check.blockedBy}`, chalk.yellow);
    }

    // ── heartbeat log ──
    if (!isExecution && !isBlocked && isHeartbeat) {
      const pnl = portfolio.get(market.prices);
      log("HEARTBEAT", `tick=${tickCount}  trades=${tradesExecuted}  value=$${pnl.totalValueUsd.toFixed(2)}  P&L=${pnl.totalPnlUsd >= 0 ? "+" : ""}$${pnl.totalPnlUsd.toFixed(2)}`, chalk.gray);
    }

    // ── commit to chain (selective) ──
    if (shouldCommit) {
      // update lastHeartbeat eagerly so the next tick doesn't also fire a heartbeat
      // while the async commit is in flight
      if (isHeartbeat) lastHeartbeat = now;
      await commitSession(chain, policy, market, signal, check, exec);
    }

    // ── skip log (no spam, just occasional) ──
    if (!shouldCommit && tickCount % 10 === 0) {
      log("SKIP", `${signal.reason ?? "no signal"}  (tick ${tickCount})`, chalk.gray);
    }
  }

  // run immediately then on interval
  await tick();
  setInterval(tick, TICK_MS);
}

main().catch((err) => {
  console.error(chalk.red("runner failed:"), err);
  process.exitCode = 1;
});
