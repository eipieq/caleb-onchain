/**
 * @file market/index.js
 * Fetches price and portfolio data for the agent's market snapshot (STEP 1).
 *
 * Price sources, in priority order:
 *   1. Initia on-chain oracle  — authoritative for INIT pairs, fast, no rate-limit
 *   2. Binance public API      — real-time spot prices, no API key required
 *   3. CoinGecko public API    — fallback for tokens not on Binance (e.g. INIT)
 *
 * The merged price map prefers oracle > binance > coingecko per token.
 */

const INITIA_API = "https://rest.testnet.initia.xyz";

// coingecko ids for fallback pricing
const CG_IDS = {
  INIT: "initia",
  ETH:  "ethereum",
  USDC: "usd-coin",
  BTC:  "bitcoin",
};

// binance symbols (only tokens listed on Binance spot)
const BINANCE_SYMBOLS = {
  ETH:  "ETHUSDT",
  BTC:  "BTCUSDT",
  USDC: "USDCUSDT",
};

/**
 * Fetch JSON from a URL with a hard timeout. Returns the parsed body or throws.
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchInitiaPrices(tokens) {
  try {
    const data = await fetchJson(`${INITIA_API}/initia/oracle/v1/prices`);
    const prices = {};
    for (const entry of data?.prices ?? []) {
      const symbol = entry.pair_id?.toUpperCase().replace("/USD", "").replace("USD/", "");
      if (symbol && tokens.includes(symbol)) prices[symbol] = parseFloat(entry.price);
    }
    return prices;
  } catch {
    return {};
  }
}

async function fetchBinancePrices(tokens) {
  const relevant = tokens.filter((t) => BINANCE_SYMBOLS[t]);
  if (relevant.length === 0) return {};
  try {
    const symbols = JSON.stringify(relevant.map((t) => BINANCE_SYMBOLS[t]));
    const data = await fetchJson(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`
    );
    const prices = {};
    for (const entry of data) {
      const token = Object.keys(BINANCE_SYMBOLS).find((t) => BINANCE_SYMBOLS[t] === entry.symbol);
      if (token) prices[token] = parseFloat(entry.price);
    }
    return prices;
  } catch {
    return {};
  }
}

async function fetchCgPrices(tokens) {
  const ids = tokens.map((t) => CG_IDS[t]).filter(Boolean).join(",");
  if (!ids) return {};
  try {
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    const prices = {};
    for (const token of tokens) {
      const id = CG_IDS[token];
      if (id && data[id]?.usd) prices[token] = data[id].usd;
    }
    return prices;
  } catch {
    return {};
  }
}

async function fetchPortfolio(address) {
  if (!address) return {};
  try {
    const data = await fetchJson(
      `${INITIA_API}/cosmos/bank/v1beta1/balances/${address}`
    );
    const balances = {};
    for (const coin of data?.balances ?? []) balances[coin.denom] = coin.amount;
    return balances;
  } catch {
    return {};
  }
}

/**
 * Build a market snapshot for the current cycle.
 * Fires all three fetches in parallel to minimise latency.
 *
 * @param {string[]} allowedTokens - e.g. ["INIT", "ETH", "USDC"]
 * @returns {Promise<{prices, portfolio, allowedTokens, fetchedAt, sources}>}
 */
export async function fetchMarketData(allowedTokens) {
  const [initia, binance, cg, portfolio] = await Promise.all([
    fetchInitiaPrices(allowedTokens),
    fetchBinancePrices(allowedTokens),
    fetchCgPrices(allowedTokens),
    fetchPortfolio(process.env.WALLET_ADDRESS),
  ]);

  // oracle wins; binance fills gaps; coingecko is last resort
  const prices = { ...cg, ...binance, ...initia };

  return {
    prices,
    portfolio,
    allowedTokens,
    fetchedAt: Math.floor(Date.now() / 1000),
    sources: { initia: Object.keys(initia), binance: Object.keys(binance), coingecko: Object.keys(cg) },
  };
}
