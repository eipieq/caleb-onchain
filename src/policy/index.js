/**
 * @file policy/index.js
 * Six-gate policy engine that runs as STEP 3 (CHECK) of every session.
 *
 * Gates are evaluated in parallel and ALL must pass for a swap to execute.
 * Each gate returns a {name, passed, reason} object so the on-chain record
 * shows exactly which constraint was satisfied or violated.
 *
 * Gate summary:
 *   spendLimit         — swap amount ≤ policy.maxSpendUsd
 *   tokenWhitelist     — token is in policy.allowedTokens
 *   confidenceThreshold — AI confidence ≥ policy.confidenceThreshold
 *   cooldown           — no executed swap within the last policy.cooldownSeconds
 *   verdictValid       — verdict is one of the recognised enum values
 *   marketSanity       — a positive price exists for the target token
 */

/**
 * Run all policy gates against the current decision and market data.
 *
 * @param {object}      ai        - DECISION step payload
 * @param {object}      market    - MARKET step payload
 * @param {object}      policy    - Active policy config
 * @param {object[]}    prevSteps - Earlier steps (used for cooldown in DCA mode)
 * @param {object|null} position  - Current open position (used for drawdown gate)
 * @returns {Promise<{passed, blockedBy, gates, timestamp}>}
 */
export async function runPolicyCheck(ai, market, policy, prevSteps = [], position = null, portfolio = null) {
  const gates = await Promise.all([
    gate_spendLimit(ai, policy),
    gate_tokenWhitelist(ai, policy),
    gate_signalStrength(ai, policy),
    gate_cooldown(prevSteps, policy),
    gate_verdict(ai),
    gate_marketSanity(market, ai),
    gate_maxPosition(ai, policy, position),
    gate_maxDrawdown(ai, policy, position, market),
    gate_availableBalance(ai, portfolio),
  ]);

  const passed    = gates.every((g) => g.passed);
  const blockedBy = passed ? null : gates.find((g) => !g.passed)?.name ?? null;

  return {
    passed,
    blockedBy,
    gates:     Object.fromEntries(gates.map((g) => [g.name, { passed: g.passed, reason: g.reason }])),
    timestamp: Math.floor(Date.now() / 1000),
  };
}

function gate_spendLimit(ai, policy) {
  const passed = ai.verdict === "SKIP" || ai.amountUsd <= policy.maxSpendUsd;
  return {
    name:   "spendLimit",
    passed,
    reason: passed
      ? `$${ai.amountUsd} ≤ limit $${policy.maxSpendUsd}`
      : `$${ai.amountUsd} exceeds limit $${policy.maxSpendUsd}`,
  };
}

function gate_tokenWhitelist(ai, policy) {
  if (ai.verdict === "SKIP") return { name: "tokenWhitelist", passed: true, reason: "skip" };
  const token  = (ai.token || "").toUpperCase();
  const passed = policy.allowedTokens.includes(token);
  return {
    name:   "tokenWhitelist",
    passed,
    reason: passed ? `${token} is whitelisted` : `${token} not in [${policy.allowedTokens.join(", ")}]`,
  };
}

/**
 * Signal strength gate — replaces the LLM-specific confidenceThreshold gate.
 * For rule-based strategies, `confidence` is the normalised signal strength
 * [0–1] returned by the strategy's decide() function.
 */
function gate_signalStrength(ai, policy) {
  if (ai.verdict === "SKIP") return { name: "signalStrength", passed: true, reason: "skip" };
  const threshold = policy.confidenceThreshold ?? 0;
  const passed    = ai.confidence >= threshold;
  return {
    name:   "signalStrength",
    passed,
    reason: passed
      ? `signal ${ai.confidence.toFixed(3)} ≥ threshold ${threshold}`
      : `signal ${ai.confidence.toFixed(3)} < threshold ${threshold}`,
  };
}

function gate_cooldown(prevSteps, policy) {
  const cutoff = Math.floor(Date.now() / 1000) - policy.cooldownSeconds;
  const recent = prevSteps
    .filter((s) => s.kind === "EXECUTION" && s.payload?.executed === true)
    .find((s) => (s.payload?.timestamp ?? 0) > cutoff);

  return {
    name:   "cooldown",
    passed: !recent,
    reason: !recent
      ? `no swap within ${policy.cooldownSeconds}s cooldown`
      : `last swap at ${recent.payload.timestamp} — still in cooldown`,
  };
}

function gate_verdict(ai) {
  const passed = ["BUY", "SELL", "SKIP"].includes(ai.verdict);
  return {
    name:   "verdictValid",
    passed,
    reason: passed ? `verdict "${ai.verdict}" is valid` : `unknown verdict "${ai.verdict}"`,
  };
}

/**
 * Prevent opening a position that would exceed the max total exposure.
 * Only applies to BUY verdicts — SELL always passes (closing reduces risk).
 */
function gate_maxPosition(ai, policy, position) {
  if (ai.verdict !== "BUY" || !policy.maxPositionUsd) {
    return { name: "maxPosition", passed: true, reason: "n/a" };
  }
  const current = position?.sizeUsd ?? 0;
  const after   = current + ai.amountUsd;
  const passed  = after <= policy.maxPositionUsd;
  return {
    name:   "maxPosition",
    passed,
    reason: passed
      ? `position after trade $${after.toFixed(2)} ≤ limit $${policy.maxPositionUsd}`
      : `position after trade $${after.toFixed(2)} would exceed limit $${policy.maxPositionUsd}`,
  };
}

/**
 * Ensure the portfolio has enough USDC to fund the trade.
 * Only relevant for BUY orders — SELL never requires USDC.
 */
function gate_availableBalance(ai, portfolio) {
  if (ai.verdict !== "BUY" || !portfolio) {
    return { name: "availableBalance", passed: true, reason: "n/a" };
  }
  const available = portfolio.availableUsd();
  const passed    = available >= ai.amountUsd;
  return {
    name:   "availableBalance",
    passed,
    reason: passed
      ? `USDC balance $${available.toFixed(2)} ≥ order $${ai.amountUsd.toFixed(2)}`
      : `insufficient USDC: $${available.toFixed(2)} < $${ai.amountUsd.toFixed(2)}`,
  };
}

/**
 * Halt trading if the open position is down more than maxDrawdownPct.
 * Only checked when there is an open position and the signal is a BUY
 * (adding to a losing position is the main risk here).
 */
function gate_maxDrawdown(ai, policy, position, market) {
  if (!policy.maxDrawdownPct || !position || ai.verdict === "SKIP") {
    return { name: "maxDrawdown", passed: true, reason: "n/a" };
  }
  const price  = (market.prices ?? {})[position.token];
  if (!price)  return { name: "maxDrawdown", passed: true, reason: "no price for drawdown check" };
  const pnlPct = (price - position.entryPrice) / position.entryPrice * 100;
  const passed = pnlPct > -policy.maxDrawdownPct;
  return {
    name:   "maxDrawdown",
    passed,
    reason: passed
      ? `drawdown ${pnlPct.toFixed(2)}% within limit -${policy.maxDrawdownPct}%`
      : `drawdown ${pnlPct.toFixed(2)}% exceeds limit -${policy.maxDrawdownPct}% — halting`,
  };
}

function gate_marketSanity(market, ai) {
  if (ai.verdict === "SKIP") return { name: "marketSanity", passed: true, reason: "skip" };
  const token  = (ai.token || "").toUpperCase();
  const price  = (market.prices ?? {})[token];
  const passed = typeof price === "number" && price > 0;
  return {
    name:   "marketSanity",
    passed,
    reason: passed ? `${token} price = $${price}` : `no valid price for ${token}`,
  };
}
