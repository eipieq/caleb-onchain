/**
 * @file market/mock.js
 * Simulated price feed for demo / CI use when SIMULATE=true.
 *
 * Generates a realistic random walk for each token seeded from approximate
 * real-world prices. Each call to getSimulatedPrices() advances the walk by
 * one step, so calling it repeatedly produces a plausible price series that
 * the strategy logic can react to.
 */

const SEEDS = {
  INIT:  { price: 2.40,    volatility: 0.008 },
  ETH:   { price: 3200.00, volatility: 0.005 },
  USDC:  { price: 1.00,    volatility: 0.0001 },
  BTC:   { price: 65000.0, volatility: 0.006 },
};

// mutable state — persists across calls within the same process
const state = {};

function initState(tokens) {
  for (const token of tokens) {
    if (!state[token]) {
      const seed = SEEDS[token] ?? { price: 1.0, volatility: 0.005 };
      state[token] = { price: seed.price, volatility: seed.volatility };
    }
  }
}

/**
 * Advance the random walk one step and return the new prices.
 * @param {string[]} tokens
 * @returns {{ prices: object, fetchedAt: number, simulated: true }}
 */
export function getSimulatedPrices(tokens) {
  initState(tokens);

  const prices = {};
  for (const token of tokens) {
    const s   = state[token];
    // geometric brownian motion step
    const dW  = (Math.random() - 0.5) * 2;  // [-1, 1]
    s.price   = s.price * (1 + s.volatility * dW);
    s.price   = Math.max(s.price, 0.0001);   // floor at near-zero
    prices[token] = parseFloat(s.price.toFixed(6));
  }

  return {
    prices,
    portfolio:     {},
    allowedTokens: tokens,
    fetchedAt:     Math.floor(Date.now() / 1000),
    simulated:     true,
    sources:       { mock: tokens },
  };
}
