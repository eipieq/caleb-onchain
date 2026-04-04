/**
 * @file market/mock.js
 * simulated price feed for demo / CI when real prices aren't available.
 *
 * generates a random walk seeded from approximate real-world prices. each call
 * to getSimulatedPrices() advances the walk one step, producing a plausible
 * series the strategy can actually react to.
 */

const SEEDS = {
  INIT:  { price: 2.40,    volatility: 0.008 },
  ETH:   { price: 3200.00, volatility: 0.005 },
  USDC:  { price: 1.00,    volatility: 0.0001 },
  BTC:   { price: 65000.0, volatility: 0.006 },
};

// mutable state — persists across calls in the same process
const state = {};

function initState(tokens) {
  for (const token of tokens) {
    if (!state[token]) {
      const seed = SEEDS[token] ?? { price: 1.0, volatility: 0.005 };
      state[token] = { price: seed.price, volatility: seed.volatility };
    }
  }
}

/** advance the random walk one step and return the new prices. */
export function getSimulatedPrices(tokens) {
  initState(tokens);

  const prices = {};
  for (const token of tokens) {
    const s   = state[token];
    // geometric brownian motion step
    const dW  = (Math.random() - 0.5) * 2;  // [-1, 1]
    s.price   = s.price * (1 + s.volatility * dW);
    s.price   = Math.max(s.price, 0.0001);   // near-zero floor
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
