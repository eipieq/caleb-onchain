/**
 * @file market/cache.js
 * in-memory price cache that refreshes independently of the decision loop.
 *
 * fetching prices on every tick would block on HTTP latency, so the cache
 * runs its own interval (default 500ms) and the runner reads from memory.
 *
 * if the cache isn't populated yet (e.g. first tick fires before the first
 * refresh), get() returns null and the runner skips that tick.
 */

import { fetchMarketData }    from "./index.js";
import { getSimulatedPrices } from "./mock.js";

const REFRESH_MS = parseInt(process.env.CACHE_REFRESH_MS || "500");
const SIMULATED  = process.env.SIMULATE === "true";

export class PriceCache {
  constructor(tokens) {
    this.tokens  = tokens;
    this.data    = null;   // latest fetchMarketData result
    this.timer   = null;
    this.errors  = 0;
  }

  /**
   * start the background refresh loop.
   * fires immediately, then repeats every REFRESH_MS.
   */
  start() {
    const refresh = async () => {
      try {
        // SIMULATE only controls whether swaps actually execute, not price fetching
        const result = await fetchMarketData(this.tokens);
        // only update if we got prices — avoid overwriting good data with empty
        if (Object.keys(result.prices ?? {}).length > 0) {
          this.data   = result;
          this.errors = 0;
        }
      } catch (err) {
        this.errors++;
        // fall back to simulated so the runner keeps ticking
        if (!this.data) this.data = getSimulatedPrices(this.tokens);
      }
    };

    refresh(); // populate before the first tick hits
    this.timer = setInterval(refresh, REFRESH_MS);
    return this;
  }

  /** stop the background refresh loop. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** latest cached market data, or null if not yet populated. */
  get() {
    return this.data;
  }

  /** price for a single token, or null. */
  price(token) {
    return this.data?.prices?.[token] ?? null;
  }
}
