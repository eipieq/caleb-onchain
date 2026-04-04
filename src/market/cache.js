/**
 * @file market/cache.js
 * In-memory price cache that refreshes independently of the decision loop.
 *
 * The runner ticks every TICK_MS (e.g. 2000ms). Fetching prices on every tick
 * would block the loop on HTTP latency. Instead, the cache refreshes on its
 * own interval (default 500ms) and the runner reads synchronously from memory.
 *
 * If the cache has never been populated (e.g. first tick fires before the
 * first refresh completes), get() returns null so the runner can skip the tick.
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
   * Start the background refresh loop.
   * Fires immediately, then repeats every REFRESH_MS.
   */
  start() {
    const refresh = async () => {
      try {
        // always use real prices; SIMULATE only controls whether swaps actually execute
        const result = await fetchMarketData(this.tokens);
        // only update if we got prices back (avoid overwriting good data with empty)
        if (Object.keys(result.prices ?? {}).length > 0) {
          this.data   = result;
          this.errors = 0;
        }
      } catch (err) {
        this.errors++;
        // on failure, fall back to simulated so the runner keeps ticking
        if (!this.data) this.data = getSimulatedPrices(this.tokens);
      }
    };

    refresh(); // populate immediately before first tick
    this.timer = setInterval(refresh, REFRESH_MS);
    return this;
  }

  /** Stop the background refresh loop. */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Return the latest cached market data, or null if not yet populated.
   * @returns {object|null}
   */
  get() {
    return this.data;
  }

  /**
   * Convenience: return just the price for a single token.
   * @param {string} token
   * @returns {number|null}
   */
  price(token) {
    return this.data?.prices?.[token] ?? null;
  }
}
