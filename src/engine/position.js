/**
 * @file engine/position.js
 * in-memory position tracker for the HFT runner.
 *
 * tracks one open position per token. state is not persisted — restarting
 * the runner resets it to null. fine for the demo; a real system would
 * recover state from the chain.
 *
 * also computes unrealised P&L for the maxDrawdown policy gate.
 */

export class PositionTracker {
  constructor() {
    /** @type {{ token: string, sizeUsd: number, entryPrice: number, openedAt: number } | null} */
    this.position = null;
  }

  /** current open position, or null if flat. */
  get() {
    return this.position;
  }

  /** open a new position after a BUY execution. */
  open(token, sizeUsd, entryPrice) {
    this.position = {
      token,
      sizeUsd,
      entryPrice,
      openedAt: Math.floor(Date.now() / 1000),
    };
  }

  /** close the position. the runner always closes the full position on a SELL. */
  close() {
    this.position = null;
  }

  /**
   * unrealised P&L as a fraction of entry value (e.g. -0.03 = 3% loss).
   * returns 0 if no position is open.
   */
  unrealisedPnlPct(currentPrice) {
    if (!this.position) return 0;
    return (currentPrice - this.position.entryPrice) / this.position.entryPrice;
  }
}
