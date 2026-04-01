/**
 * @file strategies/momentum.js
 * Breakout momentum strategy.
 *
 * Logic:
 *   - BUY  when the current price breaks above the highest price in the last
 *     LOOKBACK ticks by more than THRESHOLD%. The move suggests continuation.
 *   - SELL when the current price breaks below the lowest price in the last
 *     LOOKBACK ticks by more than THRESHOLD%. Same logic inverted.
 *   - SKIP otherwise — no meaningful breakout detected.
 *
 * Signal strength (returned as `confidence`) is the normalised distance
 * beyond the breakout level, capped at 1.0. A confidence of 0.5 means the
 * price has moved 0.5× the threshold beyond the level; 1.0 means it has
 * moved 2× the threshold or more.
 */

const LOOKBACK  = parseInt(process.env.MOMENTUM_LOOKBACK  || "20");  // ticks
const THRESHOLD = parseFloat(process.env.MOMENTUM_THRESHOLD || "0.005"); // 0.5%

/**
 * @param {object}   prices  - Current price map { TOKEN: number }
 * @param {number[]} history - Recent mid-prices, newest last (same token)
 * @param {object|null} position - Current open position or null
 * @param {object}   policy  - Active policy config
 * @returns {{ verdict, token, side, amountUsd, confidence, signal, reason }}
 */
export function decide(prices, history, position, policy) {
  const token = policy.allowedTokens.find((t) => t !== "USDC") ?? "INIT";
  const price = prices[token];

  const skip = (reason) => ({
    verdict: "SKIP", token, side: null, amountUsd: 0,
    confidence: 0, signal: 0, reason, strategy: "momentum",
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (!price || price <= 0)       return skip("no price available");
  if (history.length < LOOKBACK)  return skip(`warming up — need ${LOOKBACK} ticks, have ${history.length}`);

  const window = history.slice(-LOOKBACK);
  const high   = Math.max(...window);
  const low    = Math.min(...window);

  const breakoutUp   = (price - high) / high;   // positive = above high
  const breakoutDown = (low - price) / low;      // positive = below low

  if (breakoutUp >= THRESHOLD) {
    const confidence = Math.min(1, breakoutUp / (THRESHOLD * 2));
    return {
      verdict:    "BUY",
      token,
      side:       "BUY",
      amountUsd:  policy.maxSpendUsd * confidence,
      confidence,
      signal:     breakoutUp,
      reason:     `price $${price.toFixed(4)} broke above ${LOOKBACK}-tick high $${high.toFixed(4)} (+${(breakoutUp * 100).toFixed(2)}%)`,
      strategy:   "momentum",
      timestamp:  Math.floor(Date.now() / 1000),
    };
  }

  if (breakoutDown >= THRESHOLD && position) {
    const confidence = Math.min(1, breakoutDown / (THRESHOLD * 2));
    return {
      verdict:    "SELL",
      token,
      side:       "SELL",
      amountUsd:  position.sizeUsd * confidence,
      confidence,
      signal:     -breakoutDown,
      reason:     `price $${price.toFixed(4)} broke below ${LOOKBACK}-tick low $${low.toFixed(4)} (-${(breakoutDown * 100).toFixed(2)}%)`,
      strategy:   "momentum",
      timestamp:  Math.floor(Date.now() / 1000),
    };
  }

  return skip(
    `no breakout — price $${price.toFixed(4)} within range [$${low.toFixed(4)}, $${high.toFixed(4)}]`
  );
}
