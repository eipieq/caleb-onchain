const INITIA_API = "https://rest.testnet.initia.xyz";

// coingecko ids for fallback pricing
const CG_IDS = {
  INIT: "initia",
  ETH:  "ethereum",
  USDC: "usd-coin",
  BTC:  "bitcoin",
};

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
