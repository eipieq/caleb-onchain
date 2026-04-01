/**
 * @file market/index.js
 * Fetches price and portfolio data for the agent's market snapshot (STEP 1).
 *
 * Price sources, in priority order:
 *   1. Initia on-chain oracle  — authoritative for INIT pairs, fast, no rate-limit
 *   2. CoinGecko public API    — fallback for tokens not yet listed on the oracle
 *
 * The merged price map always prefers the on-chain value when both sources have
 * data for the same symbol, so oracle manipulation would need to compromise
 * the Initia validator set rather than just the CoinGecko feed.
 */

const INITIA_API = "https://rest.testnet.initia.xyz";

// coingecko ids for fallback pricing
const CG_IDS = {
  INIT: "initia",
  ETH:  "ethereum",
  USDC: "usd-coin",
  BTC:  "bitcoin",
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
  const [initia, cg, portfolio] = await Promise.all([
    fetchInitiaPrices(allowedTokens),
    fetchCgPrices(allowedTokens),
    fetchPortfolio(process.env.WALLET_ADDRESS),
  ]);

  // initia on-chain prices win; coingecko fills gaps
  const prices = { ...cg, ...initia };

  return {
    prices,
    portfolio,
    allowedTokens,
    fetchedAt: Math.floor(Date.now() / 1000),
    sources: { initia: Object.keys(initia), coingecko: Object.keys(cg) },
  };
}
