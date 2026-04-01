/**
 * @file engine/position.js
 * In-memory position tracker for the HFT runner.
 *
 * Tracks one open position at a time per token. State is not persisted to disk
 * — if the runner restarts, position resets to null. This is acceptable for
 * the hackathon demo; a production system would recover state from the chain.
 *
 * A position is opened on a BUY execution and closed on a SELL execution.
 * The tracker also computes unrealised P&L for the maxDrawdown policy gate.
 */

export class PositionTracker {
  constructor() {
    /** @type {{ token: string, sizeUsd: number, entryPrice: number, openedAt: number } | null} */
    this.position = null;
  }

  /** Return the current open position, or null if flat. */
  get() {
    return this.position;
  }

  /**
   * Open a new position after a BUY execution.
   * @param {string} token
   * @param {number} sizeUsd    - USD value of the purchase
   * @param {number} entryPrice - Price at fill
   */
  open(token, sizeUsd, entryPrice) {
    this.position = {
      token,
      sizeUsd,
      entryPrice,
      openedAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Close (or partially reduce) the position after a SELL execution.
   * For simplicity the runner always closes the full position on a SELL.
   */
  close() {
    this.position = null;
  }

  /**
   * Unrealised P&L as a percentage of entry value.
   * Returns 0 if no position is open.
   *
   * @param {number} currentPrice - Current market price of the held token
   * @returns {number} e.g. -0.03 = 3% loss
   */
  unrealisedPnlPct(currentPrice) {
    if (!this.position) return 0;
    return (currentPrice - this.position.entryPrice) / this.position.entryPrice;
  }
}
