/**
 * @file strategies/momentum.js
 * breakout momentum strategy.
 *
 * BUY when price breaks above the LOOKBACK-tick high by more than THRESHOLD%.
 * SELL when price breaks below the low by the same margin.
 * SKIP otherwise.
 *
 * confidence is how far past the breakout level the price is, normalised and
 * capped at 1.0. 0.5 = half a threshold beyond; 1.0 = two thresholds or more.
 */

const LOOKBACK  = parseInt(process.env.MOMENTUM_LOOKBACK  || "20");  // ticks
const THRESHOLD = parseFloat(process.env.MOMENTUM_THRESHOLD || "0.005"); // 0.5%

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
