/**
 * @file strategies/mean-revert.js
 * Mean-reversion strategy using a rolling z-score.
 *
 * Logic:
 *   - Compute the rolling mean and standard deviation over the last LOOKBACK ticks.
 *   - Z-score = (currentPrice - mean) / stddev
 *   - BUY  when z-score < -Z_THRESHOLD (price is unusually far below its mean)
 *   - SELL when z-score >  Z_THRESHOLD (price is unusually far above its mean)
 *   - SKIP otherwise.
 *
 * A z-score of ±2 means the price is 2 standard deviations away from its
 * recent mean — statistically unusual and likely to revert.
 *
 * Confidence is the absolute z-score normalised against Z_THRESHOLD, capped at 1.
 */

const LOOKBACK    = parseInt(process.env.MEANREV_LOOKBACK    || "30");  // ticks
const Z_THRESHOLD = parseFloat(process.env.MEANREV_Z_THRESHOLD || "1.5"); // stddevs

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr, avg) {
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

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
    confidence: 0, signal: 0, reason, strategy: "mean-revert",
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (!price || price <= 0)       return skip("no price available");
  if (history.length < LOOKBACK)  return skip(`warming up — need ${LOOKBACK} ticks, have ${history.length}`);

  const window = history.slice(-LOOKBACK);
  const avg    = mean(window);
  const sd     = stddev(window, avg);

  // Flat market — avoid division by near-zero stddev
  if (sd < avg * 0.0001) return skip("market too flat — stddev near zero");

  const z = (price - avg) / sd;

  if (z < -Z_THRESHOLD) {
    const confidence = Math.min(1, Math.abs(z) / (Z_THRESHOLD * 2));
    return {
      verdict:    "BUY",
      token,
      side:       "BUY",
      amountUsd:  policy.maxSpendUsd * confidence,
      confidence,
      signal:     z,
      reason:     `z-score ${z.toFixed(2)} < -${Z_THRESHOLD} (price $${price.toFixed(4)} vs mean $${avg.toFixed(4)}) — oversold, expect reversion`,
      strategy:   "mean-revert",
      timestamp:  Math.floor(Date.now() / 1000),
    };
  }

  if (z > Z_THRESHOLD && position) {
    const confidence = Math.min(1, Math.abs(z) / (Z_THRESHOLD * 2));
    return {
      verdict:    "SELL",
      token,
      side:       "SELL",
      amountUsd:  position.sizeUsd * confidence,
      confidence,
      signal:     z,
      reason:     `z-score ${z.toFixed(2)} > ${Z_THRESHOLD} (price $${price.toFixed(4)} vs mean $${avg.toFixed(4)}) — overbought, expect reversion`,
      strategy:   "mean-revert",
      timestamp:  Math.floor(Date.now() / 1000),
    };
  }

  return skip(`z-score ${z.toFixed(2)} within ±${Z_THRESHOLD} — no reversion signal`);
}
